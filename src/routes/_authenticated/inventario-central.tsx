import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Boxes, Download, FileText, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { beepOk, beepWarn } from "@/lib/scanner-sound";
import { abrirRelatorio, baixarCSV } from "@/lib/relatorio";
import { contextoBaseOperacional } from "@/lib/base-operacional.functions";
import {
  listarBasesInventario,
  listarInventarioCentral,
  registrarLeituraInventarioCentral,
  type InventarioCentralLinha,
} from "@/lib/inventario-central.functions";

export const Route = createFileRoute("/_authenticated/inventario-central")({
  head: () => ({ meta: [{ title: "Inventário Central — JM Transportes" }] }),
  component: InventarioCentralPage,
});

function ymd(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function dataBR(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
}

function InventarioCentralPage() {
  const contextoFn = useServerFn(contextoBaseOperacional);
  const basesFn = useServerFn(listarBasesInventario);
  const listarFn = useServerFn(listarInventarioCentral);
  const registrarFn = useServerFn(registrarLeituraInventarioCentral);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [inicio, setInicio] = useState(ymd(-1));
  const [fim, setFim] = useState(ymd());
  const [baseFiltro, setBaseFiltro] = useState("todas");
  const [codigoBusca, setCodigoBusca] = useState("");
  const [usuarioBusca, setUsuarioBusca] = useState("");
  const [baseBipagem, setBaseBipagem] = useState("");
  const [diaBipagem, setDiaBipagem] = useState(ymd());
  const [codigo, setCodigo] = useState("");

  const contexto = useQuery({
    queryKey: ["contexto-base-operacional"],
    queryFn: () => contextoFn(),
    staleTime: 60_000,
  });
  const bases = useQuery({
    queryKey: ["inventario-bases"],
    queryFn: () => basesFn(),
    staleTime: 300_000,
  });
  const isAdmin = contexto.data?.isAdmin === true;

  useEffect(() => {
    const fixa = contexto.data?.baseFixa?.id;
    if (!isAdmin && fixa) {
      setBaseBipagem(fixa);
      setBaseFiltro(fixa);
    }
  }, [contexto.data, isAdmin]);

  const lista = useQuery({
    queryKey: ["inventario-central", inicio, fim, baseFiltro, codigoBusca, usuarioBusca],
    queryFn: () => listarFn({ data: {
      inicio,
      fim,
      baseId: baseFiltro === "todas" ? undefined : baseFiltro,
      codigo: codigoBusca.trim() || undefined,
      usuario: usuarioBusca.trim() || undefined,
      status: "todos",
    } }),
    enabled: !!contexto.data,
    refetchInterval: 15_000,
  });

  const registrar = useMutation({
    mutationFn: () => registrarFn({ data: {
      baseId: baseBipagem,
      diaOperacional: diaBipagem,
      codigo: codigo.trim(),
    } }),
    onSuccess: (res) => {
      if (res.resultado === "duplicado") {
        beepWarn();
        toast.warning(res.mensagem);
      } else {
        beepOk();
        toast.success(res.mensagem);
      }
      setCodigo("");
      void qc.invalidateQueries({ queryKey: ["inventario-central"] });
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao registrar leitura."),
  });

  const leituras = useMemo(() => (lista.data?.leituras ?? []).filter((l) => !l.cancelado), [lista.data]);
  const basesCount = new Set(leituras.map((l) => l.base_id)).size;
  const usuariosCount = new Set(leituras.map((l) => l.bipado_por)).size;

  const relatorio = () => ({
    titulo: isAdmin ? "Inventário central — todas as bases" : "Inventário da base",
    subtitulo: `${dataBR(inicio)} a ${dataBR(fim)}`,
    nomeArquivo: `inventario_central_${inicio}_${fim}`,
    kpis: [
      { label: "Total bipado", value: leituras.length },
      { label: "Bases", value: basesCount },
      { label: "Usuários", value: usuariosCount },
    ],
    colunas: [
      { header: "Data", value: (l: InventarioCentralLinha) => dataBR(l.dia_operacional) },
      { header: "Hora", value: (l: InventarioCentralLinha) => new Date(l.bipado_em).toLocaleTimeString("pt-BR") },
      { header: "Base", value: (l: InventarioCentralLinha) => `${l.base_codigo} · ${l.base_nome}` },
      { header: "Código", value: (l: InventarioCentralLinha) => l.codigo },
      { header: "Bipado por", value: (l: InventarioCentralLinha) => l.bipado_por_nome ?? "—" },
    ],
    linhas: leituras,
  });

  return (
    <div className="p-4 md:p-6 max-w-[1450px] mx-auto space-y-5">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2"><Boxes className="w-7 h-7 text-primary" />Inventário Central</h1>
          <p className="text-sm text-muted-foreground">Bipagens compartilhadas, com base, horário e usuário. Admin visualiza todas as bases.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!leituras.length} onClick={() => baixarCSV(relatorio())}><Download className="w-4 h-4 mr-2" />Excel / CSV</Button>
          <Button variant="outline" disabled={!leituras.length} onClick={() => {
            if (!abrirRelatorio({ ...relatorio(), autoPrint: true })) toast.error("Permita pop-ups para imprimir.");
          }}><FileText className="w-4 h-4 mr-2" />Imprimir</Button>
        </div>
      </header>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2"><ScanLine className="w-5 h-5 text-primary" /><b>Nova bipagem</b></div>
        <div className="grid md:grid-cols-[1.3fr_180px_2fr] gap-3 items-end">
          <div><Label>Base</Label><select value={baseBipagem} onChange={(e) => setBaseBipagem(e.target.value)} disabled={!isAdmin} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Selecione…</option>{(bases.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.codigo} · {b.nome}</option>)}</select></div>
          <div><Label>Dia</Label><Input type="date" value={diaBipagem} onChange={(e) => setDiaBipagem(e.target.value)} /></div>
          <div><Label>Código</Label><div className="flex gap-2"><Input ref={inputRef} value={codigo} onChange={(e) => setCodigo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && baseBipagem && codigo.trim()) registrar.mutate(); }} placeholder="Bipe ou digite" className="font-mono" /><Button disabled={!baseBipagem || !codigo.trim() || registrar.isPending} onClick={() => registrar.mutate()}>Registrar</Button></div></div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setInicio(ymd()); setFim(ymd()); }}>Hoje</Button><Button size="sm" variant="outline" onClick={() => { setInicio(ymd(-1)); setFim(ymd(-1)); }}>Ontem</Button><Button size="sm" variant="outline" onClick={() => { setInicio(ymd(-1)); setFim(ymd()); }}>Ontem + hoje</Button></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div><Label>Início</Label><Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
          <div><Label>Fim</Label><Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></div>
          <div><Label>Base</Label><select value={baseFiltro} onChange={(e) => setBaseFiltro(e.target.value)} disabled={!isAdmin} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{isAdmin && <option value="todas">Todas as bases</option>}{(bases.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.codigo} · {b.nome}</option>)}</select></div>
          <div><Label>Código</Label><Input value={codigoBusca} onChange={(e) => setCodigoBusca(e.target.value)} /></div>
          <div><Label>Usuário</Label><Input value={usuarioBusca} onChange={(e) => setUsuarioBusca(e.target.value)} /></div>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3"><Kpi label="Total bipado" value={leituras.length} /><Kpi label="Bases" value={basesCount} /><Kpi label="Usuários" value={usuariosCount} /></div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b flex justify-between"><b>Leituras realizadas</b><Badge variant="outline">{leituras.length} registros</Badge></div>
        <div className="overflow-auto max-h-[580px]"><Table><TableHeader><TableRow><TableHead>Data / hora</TableHead><TableHead>Base</TableHead><TableHead>Código</TableHead><TableHead>Bipado por</TableHead></TableRow></TableHeader><TableBody>{leituras.map((l) => <TableRow key={l.id}><TableCell className="whitespace-nowrap">{dataBR(l.dia_operacional)} {new Date(l.bipado_em).toLocaleTimeString("pt-BR")}</TableCell><TableCell>{l.base_codigo} · {l.base_nome}</TableCell><TableCell className="font-mono">{l.codigo}</TableCell><TableCell>{l.bipado_por_nome ?? "—"}</TableCell></TableRow>)}{!lista.isLoading && !leituras.length && <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">Nenhuma leitura encontrada.</TableCell></TableRow>}</TableBody></Table></div>
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return <Card className="p-3"><span className="text-xs uppercase text-muted-foreground">{label}</span><b className="block text-2xl mt-1">{value}</b></Card>;
}
