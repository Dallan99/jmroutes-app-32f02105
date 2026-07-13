import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Boxes, ScanLine, Trash2, Download, Plus, FileText, X, CheckCircle2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { beepOk, beepWarn } from "@/lib/scanner-sound";
import { abrirRelatorio, baixarCSV } from "@/lib/relatorio";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/inventario")({
  head: () => ({ meta: [{ title: "Inventário de Base — JM Transportes" }] }),
  component: InventarioPage,
});

type InventarioLeitura = { id: string; codigo: string; hora: string };
type InventarioEstado = {
  leituras: InventarioLeitura[];
  responsavel: string;
  observacao: string;
  finalizado?: boolean;
  finalizadoEm?: string;
};

const BASES_PRESET_PADRAO = [
  "Petlove Barueri",
  "Petlove Lapa",
  "Petlove Guarujá",
  "Meli Guarujá",
  "Embu",
  "Franco da Rocha",
  "Ibiúna",
];
const BASES_KEY = "jm.inventario.basesCadastradas";

function carregarBases(): string[] {
  if (typeof window === "undefined") return BASES_PRESET_PADRAO;
  try {
    const raw = localStorage.getItem(BASES_KEY);
    if (!raw) return BASES_PRESET_PADRAO;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return BASES_PRESET_PADRAO;
    const merged = Array.from(new Set([...BASES_PRESET_PADRAO, ...arr.filter((x) => typeof x === "string" && x.trim())]));
    return merged;
  } catch {
    return BASES_PRESET_PADRAO;
  }
}

function salvarBases(lista: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BASES_KEY, JSON.stringify(lista));
  } catch {
    /* ignore */
  }
}

function inventarioKey(baseNome: string, dia: string) {
  const slug = baseNome.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `jm.inventario.${slug || "sem-base"}.${dia}`;
}

function baseSlug(nome: string) {
  return nome.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

type InventarioSalvo = {
  key: string;
  baseNome: string;
  dia: string;
  estado: InventarioEstado;
};

function listarInventarios(): InventarioSalvo[] {
  if (typeof window === "undefined") return [];
  const prefixo = "jm.inventario.";
  const out: InventarioSalvo[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(prefixo)) continue;
    if (k === "jm.inventario.ultimaBase" || k === BASES_KEY) continue;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const estado = JSON.parse(raw) as InventarioEstado;
      if (!estado?.leituras) continue;
      const rest = k.slice(prefixo.length);
      const idx = rest.lastIndexOf(".");
      const slug = idx > 0 ? rest.slice(0, idx) : rest;
      const dia = idx > 0 ? rest.slice(idx + 1) : "";
      out.push({ key: k, baseNome: slug.replace(/-/g, " "), dia, estado });
    } catch {
      /* ignore */
    }
  }
  return out.sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : a.baseNome.localeCompare(b.baseNome)));
}

function encontrarEmOutroInventario(
  codigo: string,
  keyAtual: string,
): { baseNome: string; dia: string } | null {
  if (typeof window === "undefined") return null;
  const prefixo = "jm.inventario.";
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || k === keyAtual || !k.startsWith(prefixo)) continue;
    if (k === "jm.inventario.ultimaBase" || k === BASES_KEY) continue;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as InventarioEstado;
      if (!parsed?.leituras?.some?.((l) => l.codigo === codigo)) continue;
      // key formato: jm.inventario.<slug>.<YYYY-MM-DD>
      const rest = k.slice(prefixo.length);
      const idx = rest.lastIndexOf(".");
      const slug = idx > 0 ? rest.slice(0, idx) : rest;
      const dia = idx > 0 ? rest.slice(idx + 1) : "";
      return { baseNome: slug.replace(/-/g, " "), dia };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function InventarioPage() {
  const [bases, setBases] = useState<string[]>(() => carregarBases());
  const [baseNome, setBaseNome] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("jm.inventario.ultimaBase") ?? "";
  });
  const [dia, setDia] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [novaBase, setNovaBase] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (baseNome.trim()) localStorage.setItem("jm.inventario.ultimaBase", baseNome.trim());
  }, [baseNome]);

  const inventarios = useMemo(() => listarInventarios(), [tick]);
  const inventariosPorBase = useMemo(() => {
    const map = new Map<string, InventarioSalvo[]>();
    for (const inv of inventarios) {
      const k = baseSlug(inv.baseNome);
      const arr = map.get(k) ?? [];
      arr.push(inv);
      map.set(k, arr);
    }
    return map;
  }, [inventarios]);

  const adicionarBase = () => {
    const n = novaBase.trim();
    if (!n) return;
    if (bases.some((b) => b.toLowerCase() === n.toLowerCase())) {
      toast.warning("Base já cadastrada.");
      return;
    }
    const nova = [...bases, n];
    setBases(nova);
    salvarBases(nova);
    setBaseNome(n);
    setNovaBase("");
    toast.success(`Base "${n}" adicionada.`);
  };

  const removerBase = (nome: string) => {
    if (!confirm(`Remover a base "${nome}" da lista? (os inventários bipados não serão apagados)`)) return;
    const nova = bases.filter((b) => b !== nome);
    setBases(nova);
    salvarBases(nova);
    if (baseNome === nome) setBaseNome("");
  };

  const apagarInventario = (key: string) => {
    if (!confirm("Apagar este inventário salvo? Esta ação não pode ser desfeita.")) return;
    try {
      localStorage.removeItem(key);
      setTick((t) => t + 1);
      toast.success("Inventário apagado.");
    } catch {
      toast.error("Não foi possível apagar.");
    }
  };

  const relatorioDe = (inv: InventarioSalvo) => ({
    titulo: "Inventário de Base",
    subtitulo: `${inv.baseNome} · Dia ${new Date(inv.dia + "T00:00:00").toLocaleDateString("pt-BR")}`,
    nomeArquivo: `inventario_${inv.baseNome.replace(/[^a-zA-Z0-9]+/g, "_")}_${inv.dia}`,
    kpis: [
      { label: "Base", value: inv.baseNome },
      { label: "Dia", value: new Date(inv.dia + "T00:00:00").toLocaleDateString("pt-BR") },
      { label: "Total bipado", value: inv.estado.leituras.length },
      { label: "Responsável", value: inv.estado.responsavel || "—" },
      ...(inv.estado.observacao ? [{ label: "Observação", value: inv.estado.observacao }] : []),
    ],
    colunas: [
      { header: "#", value: (l: InventarioLeitura) => inv.estado.leituras.length - inv.estado.leituras.indexOf(l) },
      { header: "Hora", value: (l: InventarioLeitura) => new Date(l.hora).toLocaleTimeString("pt-BR") },
      { header: "ID do produto", value: (l: InventarioLeitura) => l.codigo },
    ],
    linhas: inv.estado.leituras,
  });

  const handleInventarioChange = useCallback(() => setTick((t) => t + 1), []);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold">Inventário de Base</h1>
        <p className="text-sm text-muted-foreground">
          Bipe os pedidos que ficam parados na base. Escolha uma base cadastrada ou adicione uma nova.
        </p>
      </header>

      <Card className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-[var(--brand-yellow)]" />
          <h2 className="font-display text-lg font-bold">Bipagem</h2>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_180px] items-end">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Base</label>
            <select
              value={baseNome}
              onChange={(e) => setBaseNome(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">Selecione a base…</option>
              {bases.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Dia</label>
            <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="h-10" />
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-[1fr_auto] items-end">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Adicionar nova base (para clientes fora das nossas)
            </label>
            <Input
              value={novaBase}
              onChange={(e) => setNovaBase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  adicionarBase();
                }
              }}
              placeholder="Ex.: CD Cliente X — Osasco"
              className="h-10"
            />
          </div>
          <Button type="button" variant="outline" onClick={adicionarBase} disabled={!novaBase.trim()}>
            <Plus className="w-4 h-4 mr-2" /> Adicionar base
          </Button>
        </div>

        {baseNome.trim() && dia ? (
          <InventarioBipagem
            key={`${baseSlug(baseNome)}-${dia}`}
            baseNome={baseNome.trim()}
            dia={dia}
            onChange={handleInventarioChange}
          />
        ) : (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Selecione a base e escolha o dia para iniciar a bipagem.
          </div>
        )}
      </Card>

      <Card className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-[var(--brand-yellow)]" />
          <h2 className="font-display text-lg font-bold">Inventários salvos por base</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Todos os inventários bipados ficam salvos neste dispositivo. Escolha um para gerar o relatório (PDF / CSV).
        </p>

        {bases.length === 0 && (
          <div className="text-sm text-muted-foreground py-4 text-center">Nenhuma base cadastrada.</div>
        )}

        <div className="space-y-4">
          {bases.map((b) => {
            const invs = inventariosPorBase.get(baseSlug(b)) ?? [];
            const totalPedidos = invs.reduce((acc, x) => acc + x.estado.leituras.length, 0);
            return (
              <div key={b} className="border rounded-md">
                <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{b}</div>
                    <div className="text-xs text-muted-foreground">
                      {invs.length} dia(s) · {totalPedidos} pedido(s) no total
                    </div>
                  </div>
                  {!BASES_PRESET_PADRAO.includes(b) && (
                    <Button size="icon" variant="ghost" onClick={() => removerBase(b)} title="Remover base">
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                {invs.length === 0 ? (
                  <div className="text-xs text-muted-foreground px-3 py-3">Nenhum inventário bipado ainda.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-32">Dia</TableHead>
                        <TableHead className="w-20 text-right">Pedidos</TableHead>
                        <TableHead className="w-32">Status</TableHead>
                        <TableHead>Responsável</TableHead>
                        <TableHead className="w-[260px] text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invs.map((inv) => (
                        <TableRow key={inv.key}>
                          <TableCell className="font-mono text-xs">
                            {new Date(inv.dia + "T00:00:00").toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-right font-mono">{inv.estado.leituras.length}</TableCell>
                          <TableCell>
                            {inv.estado.finalizado ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                                <Lock className="w-3 h-3" /> Finalizado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                                <Unlock className="w-3 h-3" /> Em andamento
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {inv.estado.responsavel || "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setBaseNome(inv.baseNome);
                                  setDia(inv.dia);
                                }}
                              >
                                Abrir
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const cfg = relatorioDe(inv);
                                  const ok = abrirRelatorio({ ...cfg, autoPrint: true });
                                  if (!ok) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
                                }}
                                disabled={inv.estado.leituras.length === 0}
                              >
                                PDF
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => baixarCSV(relatorioDe(inv))}
                                disabled={inv.estado.leituras.length === 0}
                              >
                                CSV
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => apagarInventario(inv.key)}
                                title="Apagar inventário"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function InventarioBipagem({
  baseNome,
  dia,
  onChange,
}: {
  baseNome: string;
  dia: string;
  onChange?: () => void;
}) {
  const key = inventarioKey(baseNome, dia);
  const [estado, setEstado] = useState<InventarioEstado>({ leituras: [], responsavel: "", observacao: "" });
  const [codigo, setCodigo] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setEstado(JSON.parse(raw));
      else setEstado({ leituras: [], responsavel: "", observacao: "" });
    } catch {
      /* ignore */
    }
    hydrated.current = true;
  }, [key]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(estado));
      onChange?.();
    } catch {
      /* ignore */
    }
  }, [key, estado, onChange]);

  const bipar = (raw: string) => {
    const c = raw.trim();
    if (c.length < 1) return;
    if (estado.finalizado) {
      beepWarn();
      toast.warning("Inventário finalizado. Reabra para adicionar novos itens.");
      return;
    }
    const duplicado = estado.leituras.some((l) => l.codigo === c);
    if (duplicado) {
      beepWarn();
      toast.warning(`Já bipado: ${c}`);
      setCodigo("");
      setTimeout(() => inputRef.current?.focus(), 30);
      return;
    }
    // Verifica se o mesmo código foi bipado em outra base/dia (localStorage)
    const outra = encontrarEmOutroInventario(c, key);
    if (outra) {
      beepWarn();
      toast.warning(
        `Pedido ${c} já foi bipado em "${outra.baseNome}" no dia ${new Date(outra.dia + "T00:00:00").toLocaleDateString("pt-BR")}.`,
        { duration: 6000 },
      );
      setCodigo("");
      setTimeout(() => inputRef.current?.focus(), 30);
      return;
    }
    {
      beepOk();
      setEstado((s) => ({
        ...s,
        leituras: [{ id: crypto.randomUUID(), codigo: c, hora: new Date().toISOString() }, ...s.leituras],
      }));
    }
    setCodigo("");
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const remover = (id: string) => setEstado((s) => ({ ...s, leituras: s.leituras.filter((l) => l.id !== id) }));

  const limpar = () => {
    if (!confirm("Limpar todas as leituras deste dia?")) return;
    setEstado({ leituras: [], responsavel: estado.responsavel, observacao: estado.observacao, finalizado: false });
  };

  const finalizar = () => {
    if (estado.leituras.length === 0) {
      toast.warning("Bipe ao menos 1 pedido antes de finalizar.");
      return;
    }
    if (!confirm("Finalizar este inventário? Ele ficará arquivado no histórico da base e novas bipagens ficarão bloqueadas até reabrir.")) return;
    setEstado((s) => ({ ...s, finalizado: true, finalizadoEm: new Date().toISOString() }));
    toast.success("Inventário finalizado e arquivado no histórico.");
  };

  const reabrir = () => {
    if (!confirm("Reabrir este inventário para adicionar mais bipagens?")) return;
    setEstado((s) => ({ ...s, finalizado: false, finalizadoEm: undefined }));
    toast.info("Inventário reaberto.");
  };

  const relatorio = () => ({
    titulo: "Inventário de Base",
    subtitulo: `${baseNome} · Dia ${new Date(dia + "T00:00:00").toLocaleDateString("pt-BR")}`,
    nomeArquivo: `inventario_${baseNome.replace(/[^a-zA-Z0-9]+/g, "_")}_${dia}`,
    kpis: [
      { label: "Base", value: baseNome },
      { label: "Dia", value: new Date(dia + "T00:00:00").toLocaleDateString("pt-BR") },
      { label: "Total bipado", value: estado.leituras.length },
      { label: "Responsável", value: estado.responsavel || "—" },
    ],
    colunas: [
      { header: "#", value: (l: InventarioLeitura) => estado.leituras.length - estado.leituras.indexOf(l) },
      { header: "Hora", value: (l: InventarioLeitura) => new Date(l.hora).toLocaleTimeString("pt-BR") },
      { header: "ID do produto", value: (l: InventarioLeitura) => l.codigo },
    ],
    linhas: estado.leituras,
  });

  const imprimir = () => {
    const cfg = relatorio();
    const linhas = estado.leituras.length;
    const obsKpi = estado.observacao ? [{ label: "Observação", value: estado.observacao }] : [];
    const ok = abrirRelatorio({
      ...cfg,
      kpis: [
        ...cfg.kpis,
        ...obsKpi,
        {
          label: "Assinatura",
          value: estado.responsavel
            ? `_______________________  (${estado.responsavel})`
            : "_______________________",
        },
      ],
      subtitulo: `${cfg.subtitulo} · ${linhas} pedido(s)`,
      autoPrint: true,
    });
    if (!ok) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
  };
  const baixarCsv = () => baixarCSV(relatorio());

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <ScanLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                bipar(codigo);
              }
            }}
            placeholder={estado.finalizado ? "Inventário finalizado — reabra para bipar" : "Bipe o ID do produto parado…"}
            className="pl-9 h-12 text-lg font-mono"
            disabled={estado.finalizado}
          />
        </div>
        <Button size="lg" onClick={() => bipar(codigo)} disabled={codigo.trim().length < 1 || estado.finalizado}>
          Adicionar
        </Button>
      </div>

      {estado.finalizado && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              Finalizado em{" "}
              {estado.finalizadoEm
                ? new Date(estado.finalizadoEm).toLocaleString("pt-BR")
                : "—"}
              . Arquivado no histórico abaixo.
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={reabrir}>
            <Unlock className="w-4 h-4 mr-2" /> Reabrir
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Responsável pela conferência</label>
          <Input
            value={estado.responsavel}
            onChange={(e) => setEstado((s) => ({ ...s, responsavel: e.target.value }))}
            placeholder="Nome de quem fez a conferência"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Observação (opcional)</label>
          <Input
            value={estado.observacao}
            onChange={(e) => setEstado((s) => ({ ...s, observacao: e.target.value }))}
            placeholder="Notas gerais deste inventário"
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t pt-3">
        <div className="text-sm">
          <span className="text-muted-foreground">Total bipado hoje:</span>{" "}
          <b className="font-mono">{estado.leituras.length}</b>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={limpar} disabled={estado.leituras.length === 0 || estado.finalizado}>
            <Trash2 className="w-4 h-4 mr-2" /> Limpar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={estado.leituras.length === 0}>
                <Download className="w-4 h-4 mr-2" /> Salvar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={imprimir}>Imprimir / Salvar PDF (com assinatura)</DropdownMenuItem>
              <DropdownMenuItem onClick={baixarCsv}>Baixar CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={finalizar} disabled={estado.leituras.length === 0 || estado.finalizado}>
            <CheckCircle2 className="w-4 h-4 mr-2" /> Finalizar inventário
          </Button>
        </div>
      </div>

      <div className="border rounded-md max-h-[420px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead className="w-24">Hora</TableHead>
              <TableHead>ID do produto</TableHead>
              <TableHead className="w-14"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {estado.leituras.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                  Nenhum pedido bipado ainda.
                </TableCell>
              </TableRow>
            )}
            {estado.leituras.map((l, idx) => (
              <TableRow key={l.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {estado.leituras.length - idx}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {new Date(l.hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </TableCell>
                <TableCell className="font-mono">{l.codigo}</TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" onClick={() => remover(l.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}