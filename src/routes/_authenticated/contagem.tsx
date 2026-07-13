import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { reservarRotaLock, liberarRotaLock } from "@/lib/contagem-lock.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { beepError, beepOk, beepWarn } from "@/lib/scanner-sound";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  Plus,
  Printer,
  RotateCcw,
  ScanLine,
  Trash2,
  X,
} from "lucide-react";
import { abrirRelatorio, baixarCSV } from "@/lib/relatorio";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RequireBaseOperacional } from "@/components/base-operacional-selector";
import { useBaseOperacional } from "@/lib/base-operacional-context";
import { meuPerfil } from "@/lib/recebimento.functions";

export const Route = createFileRoute("/_authenticated/contagem")({
  head: () => ({ meta: [{ title: "Contagem Manual — JM Transportes" }] }),
  component: ContagemGuard,
});

function ContagemGuard() {
  return (
    <RequireBaseOperacional
      titulo="Contagem Manual"
      descricao="Selecione a Base e o Dia Operacional. A contagem será vinculada a esta seleção."
    >
      <ContagemComHeader />
    </RequireBaseOperacional>
  );
}

function ContagemComHeader() {
  const { base, diaOperacional, limpar, trocarDia } = useBaseOperacional();
  const fetchPerfil = useServerFn(meuPerfil);
  const perfilQuery = useQuery({ queryKey: ["meu-perfil"], queryFn: () => fetchPerfil() });
  const isAdmin = (perfilQuery.data?.roles ?? []).includes("admin");
  return (
    <>
      <OperacaoBanner
        titulo="Contagem Manual"
        base={base?.nome}
        codigo={base?.codigo}
        dia={diaOperacional}
        isAdmin={isAdmin}
        onTrocar={limpar}
        onTrocarDia={trocarDia}
      />
      <ContagemManualPage baseId={base?.id ?? ""} dia={diaOperacional ?? ""} />
    </>
  );
}

function OperacaoBanner({
  titulo,
  base,
  codigo,
  dia,
  isAdmin,
  onTrocar,
  onTrocarDia,
}: {
  titulo: string;
  base?: string | null;
  codigo?: string | null;
  dia?: string | null;
  isAdmin?: boolean;
  onTrocar?: () => void;
  onTrocarDia?: (novoDia: string) => void;
}) {
  return (
    <div className="border-b bg-muted/30 px-4 md:px-6 py-2 flex items-center gap-3 flex-wrap text-xs">
      <span className="font-display font-semibold text-sm">{titulo}</span>
      <span className="text-muted-foreground">·</span>
      <span>
        Base: <b>{base ?? "—"}</b>
        {codigo && <span className="font-mono text-muted-foreground"> ({codigo})</span>}
      </span>
      <span className="text-muted-foreground">·</span>
      <span>
        Dia Operacional:{" "}
        <b className="font-mono">
          {dia ? new Date(dia + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
        </b>
      </span>
      {isAdmin && onTrocar ? (
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-7 px-2 text-xs"
          onClick={onTrocar}
          title="Trocar base ou dia operacional"
        >
          <Building2 className="w-3.5 h-3.5 mr-1" /> Trocar base / dia
        </Button>
      ) : onTrocarDia ? (
        <label
          className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground"
          title="Trocar apenas o dia operacional (base permanece fixa)"
        >
          Trocar dia:
          <Input
            type="date"
            value={dia ?? ""}
            onChange={(e) => e.target.value && onTrocarDia(e.target.value)}
            className="h-7 w-[9.5rem] text-xs"
          />
        </label>
      ) : null}
    </div>
  );
}

type Leitura = {
  id: string;
  codigo: string;
  hora: string;
  status: "ok" | "duplicado" | "fora_padrao";
};

const DEDUPE_MS = 700;

// Padrão Mercado Livre: normalmente códigos numéricos longos (>= 10 dígitos)
// ou prefixos MLB/ML. Ajuste conforme necessário.
function isPadraoML(codigo: string): boolean {
  const c = codigo.trim().toUpperCase();
  if (/^\d{10,}$/.test(c)) return true;
  if (/^ML[AB]?\d{6,}/.test(c)) return true;
  if (/^[0-9]{8,}[A-Z0-9]{0,6}$/.test(c) && /\d{8,}/.test(c)) return true;
  return false;
}

type RotaContagem = {
  id: string;
  nome: string;
  previsto: number;
  motorista?: string | null;
  leituras: Leitura[];
  criadoEm: string;
  atualizadoEm: string;
};

function storageKey(baseId: string, dia: string) {
  return `jm.contagem.rotas.${baseId}.${dia}`;
}

function ContagemManualPage({ baseId, dia }: { baseId: string; dia: string }) {
  const key = storageKey(baseId, dia);
  const reservarFn = useServerFn(reservarRotaLock);
  const liberarFn = useServerFn(liberarRotaLock);
  const [criando, setCriando] = useState(false);
  const [rotas, setRotas] = useState<RotaContagem[]>([]);
  const [rotaAtivaId, setRotaAtivaId] = useState<string | null>(null);
  const [novaOpen, setNovaOpen] = useState(false);
  const [novaNome, setNovaNome] = useState("");
  const [novaPrevisto, setNovaPrevisto] = useState<number>(0);
  const [novaMotorista, setNovaMotorista] = useState<string>("");
  const [codigo, setCodigo] = useState("");
  const [flash, setFlash] = useState<"ok" | "error" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastBipRef = useRef<{ codigo: string; ts: number } | null>(null);
  const hydratedRef = useRef(false);

  // hidratar do localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const s = JSON.parse(raw) as { rotas: RotaContagem[]; rotaAtivaId: string | null };
        setRotas(s.rotas ?? []);
        setRotaAtivaId(s.rotaAtivaId ?? null);
      }
    } catch {
      /* ignore */
    }
    hydratedRef.current = true;
  }, [key]);

  // persistir
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(key, JSON.stringify({ rotas, rotaAtivaId }));
    } catch {
      /* ignore */
    }
  }, [key, rotas, rotaAtivaId]);

  const rotaAtiva = useMemo(
    () => rotas.find((r) => r.id === rotaAtivaId) ?? null,
    [rotas, rotaAtivaId],
  );
  const leituras = rotaAtiva?.leituras ?? [];
  const previsto = rotaAtiva?.previsto ?? 0;
  const rota = rotaAtiva?.nome ?? "";
  const motorista = rotaAtiva?.motorista ?? "";

  const bipadosOk = useMemo(
    () => leituras.filter((l) => l.status !== "duplicado").length,
    [leituras],
  );
  const percentual = previsto > 0 ? Math.min(100, Math.round((bipadosOk / previsto) * 100)) : 0;
  const restantes = Math.max(0, previsto - bipadosOk);
  const isFechada = previsto > 0 && bipadosOk >= previsto;

  const criarRota = async () => {
    const nome = novaNome.trim().toUpperCase();
    if (!nome) return toast.error("Informe o nome da rota.");
    if (!novaPrevisto || novaPrevisto <= 0) return toast.error("Informe a quantidade de volumes.");
    if (rotas.some((r) => r.nome === nome)) return toast.error("Já existe uma rota com esse nome.");
    if (!baseId || !dia) return toast.error("Selecione a base e o dia operacional.");
    setCriando(true);
    try {
      const res = await reservarFn({
        data: {
          baseId,
          diaOperacional: dia,
          nome,
          previsto: novaPrevisto,
          motorista: novaMotorista.trim() || undefined,
        },
      });
      if (res.resultado === "em_uso") {
        const dono = res.dono ? ` por ${res.dono}` : "";
        toast.error(`Rota ${nome} já foi criada${dono} nesta base/dia. Escolha outro nome.`);
        return;
      }
      // "ok" ou "ja_e_meu" — pode prosseguir
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao reservar a rota.");
      return;
    } finally {
      setCriando(false);
    }
    const nova: RotaContagem = {
      id: crypto.randomUUID(),
      nome,
      previsto: novaPrevisto,
      motorista: novaMotorista.trim() || null,
      leituras: [],
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };
    setRotas((prev) => [nova, ...prev]);
    setRotaAtivaId(nova.id);
    setNovaNome("");
    setNovaPrevisto(0);
    setNovaMotorista("");
    setNovaOpen(false);
    setCodigo("");
    lastBipRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const trocarRota = (id: string) => {
    setRotaAtivaId(id);
    setCodigo("");
    lastBipRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const excluirRota = (id: string) => {
    const r = rotas.find((x) => x.id === id);
    if (!r) return;
    if (!confirm(`Excluir a rota ${r.nome} e todas as suas leituras?`)) return;
    setRotas((prev) => prev.filter((x) => x.id !== id));
    if (rotaAtivaId === id) setRotaAtivaId(null);
    if (baseId && dia) {
      liberarFn({ data: { baseId, diaOperacional: dia, nome: r.nome } }).catch(() => {});
    }
  };

  const updateAtiva = (fn: (r: RotaContagem) => RotaContagem) => {
    setRotas((prev) => prev.map((r) => (r.id === rotaAtivaId ? fn(r) : r)));
  };

  const submit = useCallback(
    (cod: string) => {
      if (!rotaAtiva) return;
      const trimmed = cod.trim();
      if (trimmed.length < 3) return;
      const now = Date.now();
      if (
        lastBipRef.current &&
        lastBipRef.current.codigo === trimmed &&
        now - lastBipRef.current.ts < DEDUPE_MS
      ) {
        setCodigo("");
        inputRef.current?.focus();
        return;
      }
      lastBipRef.current = { codigo: trimmed, ts: now };

      const duplicado = rotaAtiva.leituras.some(
        (l) => l.codigo === trimmed && l.status !== "duplicado",
      );
      const foraPadrao = !isPadraoML(trimmed);
      const status: Leitura["status"] = duplicado ? "duplicado" : foraPadrao ? "fora_padrao" : "ok";

      const leitura: Leitura = {
        id: crypto.randomUUID(),
        codigo: trimmed,
        hora: new Date().toISOString(),
        status,
      };
      updateAtiva((r) => ({
        ...r,
        leituras: [leitura, ...r.leituras],
        atualizadoEm: new Date().toISOString(),
      }));

      if (status === "ok") {
        beepOk();
        setFlash("ok");
      } else if (status === "duplicado") {
        beepError();
        setFlash("error");
        toast.warning(`Volume duplicado: ${trimmed}`);
      } else {
        beepWarn();
        setFlash("ok");
        toast.warning(`Etiqueta fora do padrão Mercado Livre: ${trimmed}`);
      }
      setTimeout(() => setFlash(null), 500);
      setCodigo("");
      inputRef.current?.focus();
    },
    [rotaAtiva, rotaAtivaId],
  );

  useEffect(() => {
    if (!rotaAtiva) return;
    const focus = () => inputRef.current?.focus();
    focus();
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("button, a, input, textarea, [role=button]")) return;
      focus();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [rotaAtiva]);

  const removerLeitura = (id: string) => {
    updateAtiva((r) => ({
      ...r,
      leituras: r.leituras.filter((l) => l.id !== id),
      atualizadoEm: new Date().toISOString(),
    }));
  };

  const relatorioConfig = () => {
    const dup = leituras.filter((l) => l.status === "duplicado").length;
    const fora = leituras.filter((l) => l.status === "fora_padrao").length;
    return {
      titulo: "Contagem Manual",
      subtitulo: `Rota ${rota}${motorista ? " · Motorista " + motorista : ""} · Previsto ${previsto} · Bipado ${bipadosOk}`,
      nomeArquivo: `contagem_${rota || "rota"}_${new Date().toISOString().slice(0, 10)}`,
      kpis: [
        { label: "Rota", value: rota || "-" },
        { label: "Motorista", value: motorista || "-" },
        { label: "Previsto", value: previsto },
        { label: "Bipado", value: bipadosOk },
        { label: "Restantes", value: restantes },
        { label: "Duplicados", value: dup },
        { label: "Fora do padrão", value: fora },
        { label: "Conclusão", value: `${percentual}%` },
      ],
      colunas: [
        { header: "#", value: (l: Leitura) => leituras.length - leituras.indexOf(l) },
        { header: "Hora", value: (l: Leitura) => new Date(l.hora).toLocaleTimeString("pt-BR") },
        { header: "Código", value: (l: Leitura) => l.codigo },
        { header: "Status", value: (l: Leitura) => l.status },
      ],
      linhas: leituras,
    };
  };
  const baixarPDF = () => {
    const opened = abrirRelatorio({ ...relatorioConfig(), autoPrint: true });
    if (!opened) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
  };
  const baixarCsv = () => baixarCSV(relatorioConfig());
  const imprimir = baixarPDF;

  const flashClass = flash === "ok" ? "scan-flash-ok" : flash === "error" ? "scan-flash-error" : "";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <RotasSidebar
          rotas={rotas}
          rotaAtivaId={rotaAtivaId}
          onTrocar={trocarRota}
          onExcluir={excluirRota}
          onNova={() => setNovaOpen(true)}
        />

        <div className="space-y-6">
          {!rotaAtiva ? (
            <Card className="p-8 md:p-12 no-print text-center">
              <div className="w-14 h-14 rounded-md brand-gradient flex items-center justify-center mx-auto mb-4">
                <ScanLine className="w-6 h-6 text-[var(--brand-yellow)]" />
              </div>
              <h1 className="font-display text-xl md:text-2xl font-bold mb-2">Contagem Manual</h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
                Crie uma rota para iniciar a contagem. Você pode trabalhar em várias rotas ao mesmo
                tempo e alternar entre elas sem perder o progresso.
              </p>
              <Button size="lg" onClick={() => setNovaOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> Nova rota
              </Button>
            </Card>
          ) : (
            <>
              <Card className={`p-6 md:p-8 ${flashClass} no-print`}>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      Rota
                      <RotaStatusBadge fechada={isFechada} />
                    </div>
                    <div className="font-display text-2xl font-bold font-mono">{rota}</div>
                    {motorista && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Motorista:{" "}
                        <span className="font-medium text-foreground/80">{motorista}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Progresso
                    </div>
                    <div className="font-display text-2xl">
                      <span className="font-bold">{bipadosOk}</span>
                      <span className="text-muted-foreground"> / {previsto}</span>
                      <span className="ml-2 text-sm text-muted-foreground">({percentual}%)</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {restantes > 0
                        ? `Faltam ${restantes} volume(s)`
                        : bipadosOk === previsto
                          ? "Contagem completa"
                          : `${bipadosOk - previsto} a mais que o previsto`}
                    </div>
                  </div>
                </div>
                <Progress value={percentual} className="h-3 mb-4" />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(codigo);
                  }}
                  className="flex gap-2"
                >
                  <Input
                    ref={inputRef}
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="Aguardando leitura..."
                    className="h-14 text-xl font-mono tracking-wider"
                  />
                  <Button type="submit" size="lg" className="h-14 px-8">
                    Bipar
                  </Button>
                </form>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button variant="default" onClick={() => setNovaOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" /> Nova rota
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        <Download className="w-4 h-4 mr-2" />
                        Baixar
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={baixarPDF}>
                        <Printer className="w-4 h-4 mr-2" /> Baixar PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={baixarCsv}>
                        <Download className="w-4 h-4 mr-2" /> Baixar CSV
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="outline" onClick={imprimir}>
                    <Printer className="w-4 h-4 mr-2" />
                    Imprimir relatório
                  </Button>
                  <Button variant="outline" onClick={() => rotaAtiva && excluirRota(rotaAtiva.id)}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Descartar rota
                  </Button>
                </div>
              </Card>

              <Card className="p-4 md:p-6" id="print-area">
                <div className="flex items-center justify-between mb-4 border-b pb-3">
                  <div>
                    <h2 className="font-display text-lg font-bold">Relatório de Contagem Manual</h2>
                    <div className="text-sm text-muted-foreground">
                      Rota <span className="font-mono font-bold">{rota}</span> · Previsto:{" "}
                      {previsto} · Bipado: {bipadosOk} · Duplicados:{" "}
                      {leituras.filter((l) => l.status === "duplicado").length} · Fora do padrão:{" "}
                      {leituras.filter((l) => l.status === "fora_padrao").length}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Gerado em {new Date().toLocaleString("pt-BR")}
                    </div>
                  </div>
                </div>
                <div className="divide-y">
                  {leituras.map((l, idx) => (
                    <div key={l.id} className="py-2 flex items-center gap-3 text-sm">
                      <span className="font-mono text-xs text-muted-foreground w-8 shrink-0 text-right">
                        {leituras.length - idx}
                      </span>
                      <StatusIcon status={l.status} />
                      <span className="font-mono text-sm flex-1 truncate">{l.codigo}</span>
                      <span className="text-xs text-muted-foreground font-mono w-20 shrink-0">
                        {new Date(l.hora).toLocaleTimeString("pt-BR")}
                      </span>
                      <StatusBadge status={l.status} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="no-print h-7 w-7 p-0"
                        onClick={() => removerLeitura(l.id)}
                        aria-label="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  {leituras.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      Nenhuma leitura ainda.
                    </div>
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
        <DialogContent className="no-print">
          <DialogHeader>
            <DialogTitle>Nova rota</DialogTitle>
            <DialogDescription>
              A rota fica salva neste dia operacional. Você pode alternar entre rotas a qualquer
              momento.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="nova-rota">Nome da rota</Label>
              <Input
                id="nova-rota"
                autoFocus
                value={novaNome}
                onChange={(e) => setNovaNome(e.target.value.toUpperCase())}
                placeholder="Ex.: AV1_AM1"
                className="h-11 font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nova-qtd">Quantidade de volumes prevista</Label>
              <Input
                id="nova-qtd"
                type="number"
                min={1}
                value={novaPrevisto || ""}
                onChange={(e) => setNovaPrevisto(parseInt(e.target.value || "0", 10))}
                placeholder="Ex.: 105"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nova-motorista">Motorista (opcional)</Label>
              <Input
                id="nova-motorista"
                value={novaMotorista}
                onChange={(e) => setNovaMotorista(e.target.value)}
                placeholder="Nome do motorista"
                className="h-11"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={criarRota} disabled={criando}>
              {criando ? "Verificando…" : "Criar rota"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RotasSidebar({
  rotas,
  rotaAtivaId,
  onTrocar,
  onExcluir,
  onNova,
}: {
  rotas: RotaContagem[];
  rotaAtivaId: string | null;
  onTrocar: (id: string) => void;
  onExcluir: (id: string) => void;
  onNova: () => void;
}) {
  const abertas = rotas.filter(
    (r) => r.leituras.filter((l) => l.status !== "duplicado").length < r.previsto,
  );
  const fechadas = rotas.filter(
    (r) => r.leituras.filter((l) => l.status !== "duplicado").length >= r.previsto,
  );

  return (
    <Card className="p-3 md:p-4 no-print h-fit lg:sticky lg:top-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Rotas do dia
        </h3>
        <Button size="sm" variant="ghost" onClick={onNova} className="h-7 px-2">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {rotas.length === 0 && (
        <div className="text-xs text-muted-foreground py-4 text-center">Nenhuma rota criada.</div>
      )}
      {abertas.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-warning font-semibold mb-1 px-1">
            Em aberto
          </div>
          <div className="space-y-1">
            {abertas.map((r) => (
              <RotaItem
                key={r.id}
                rota={r}
                ativa={r.id === rotaAtivaId}
                onTrocar={onTrocar}
                onExcluir={onExcluir}
              />
            ))}
          </div>
        </div>
      )}
      {fechadas.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-success font-semibold mb-1 px-1">
            Fechadas
          </div>
          <div className="space-y-1">
            {fechadas.map((r) => (
              <RotaItem
                key={r.id}
                rota={r}
                ativa={r.id === rotaAtivaId}
                onTrocar={onTrocar}
                onExcluir={onExcluir}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function RotaItem({
  rota,
  ativa,
  onTrocar,
  onExcluir,
}: {
  rota: RotaContagem;
  ativa: boolean;
  onTrocar: (id: string) => void;
  onExcluir: (id: string) => void;
}) {
  const bipados = rota.leituras.filter((l) => l.status !== "duplicado").length;
  const fechada = bipados >= rota.previsto;
  const pct = rota.previsto > 0 ? Math.min(100, Math.round((bipados / rota.previsto) * 100)) : 0;
  return (
    <div
      className={`group rounded-md border px-2 py-2 cursor-pointer transition-colors ${
        ativa ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
      }`}
      onClick={() => onTrocar(rota.id)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-bold truncate">{rota.nome}</span>
        <RotaStatusBadge fechada={fechada} />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[11px] font-mono text-muted-foreground">
          {bipados}/{rota.previsto} ({pct}%)
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExcluir(rota.id);
          }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
          aria-label="Excluir rota"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <Progress value={pct} className="h-1 mt-1.5" />
    </div>
  );
}

function RotaStatusBadge({ fechada }: { fechada: boolean }) {
  if (fechada)
    return <Badge className="bg-success text-success-foreground text-[10px]">FECHADA</Badge>;
  return <Badge className="bg-warning text-warning-foreground text-[10px]">EM ABERTO</Badge>;
}

function StatusIcon({ status }: { status: Leitura["status"] }) {
  if (status === "ok") return <CheckCircle2 className="w-4 h-4 text-success shrink-0" />;
  if (status === "duplicado")
    return <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />;
  return <AlertTriangle className="w-4 h-4 text-warning shrink-0" />;
}

function StatusBadge({ status }: { status: Leitura["status"] }) {
  if (status === "ok")
    return <Badge className="bg-success text-success-foreground text-[10px]">OK</Badge>;
  if (status === "duplicado")
    return (
      <Badge className="bg-destructive text-destructive-foreground text-[10px]">DUPLICADO</Badge>
    );
  return <Badge className="bg-warning text-warning-foreground text-[10px]">FORA DO PADRÃO</Badge>;
}
