import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listarHistorico, listarFiltros, type HistoricoRow } from "@/lib/historico.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, FileSpreadsheet, FileText, Search, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/historico")({
  head: () => ({ meta: [{ title: "Histórico — JM Transportes" }] }),
  component: HistoricoPage,
});

const RESULTADOS = [
  { v: "ok", label: "OK" },
  { v: "duplicado", label: "Duplicado" },
  { v: "inexistente", label: "Inexistente" },
  { v: "outra_rota", label: "Outra rota" },
  { v: "outra_base", label: "Outra base" },
  { v: "cancelada", label: "Cancelada" },
  { v: "encerrada", label: "Encerrada" },
  { v: "volume_repetido", label: "Volume repetido" },
];

type Filtros = {
  dataInicio: string;
  dataFim: string;
  operadorId: string;
  baseId: string;
  rotaCodigo: string;
  resultado: string;
  busca: string;
};

function hoje() { return new Date().toISOString().slice(0, 10); }
function seteDiasAtras() {
  const d = new Date(); d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function HistoricoPage() {
  const [filtros, setFiltros] = useState<Filtros>({
    dataInicio: seteDiasAtras(),
    dataFim: hoje(),
    operadorId: "",
    baseId: "",
    rotaCodigo: "",
    resultado: "",
    busca: "",
  });
  const [aplicados, setAplicados] = useState<Filtros>(filtros);

  const filtrosFn = useServerFn(listarFiltros);
  const histFn = useServerFn(listarHistorico);

  const filtrosQuery = useQuery({ queryKey: ["hist-filtros"], queryFn: () => filtrosFn(), staleTime: 300_000 });

  const histQuery = useQuery({
    queryKey: ["historico", aplicados],
    queryFn: () =>
      histFn({
        data: {
          dataInicio: aplicados.dataInicio || undefined,
          dataFim: aplicados.dataFim || undefined,
          operadorId: aplicados.operadorId || undefined,
          baseId: aplicados.baseId || undefined,
          rotaCodigo: aplicados.rotaCodigo || undefined,
          resultado: aplicados.resultado || undefined,
          busca: aplicados.busca || undefined,
          limit: 2000,
        },
      }),
  });

  const rows = histQuery.data ?? [];
  const stats = useMemo(() => {
    const ok = rows.filter((r) => r.resultado === "ok").length;
    const erros = rows.length - ok;
    return { total: rows.length, ok, erros };
  }, [rows]);

  function aplicar() { setAplicados({ ...filtros }); }
  function limpar() {
    const zero: Filtros = { dataInicio: seteDiasAtras(), dataFim: hoje(), operadorId: "", baseId: "", rotaCodigo: "", resultado: "", busca: "" };
    setFiltros(zero); setAplicados(zero);
  }

  async function exportarExcel() {
    if (!rows.length) return toast.warning("Nada para exportar.");
    const XLSX = await import("xlsx");
    const data = rows.map(rowToExport);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Histórico");
    XLSX.writeFile(wb, `historico_${aplicados.dataInicio}_${aplicados.dataFim}.xlsx`);
    toast.success(`${rows.length} linhas exportadas.`);
  }

  async function exportarPDF() {
    if (!rows.length) return toast.warning("Nada para exportar.");
    const [{ default: jsPDF }, autoTableMod] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const autoTable = (autoTableMod as unknown as { default: (doc: unknown, opts: unknown) => void }).default;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text("JM Transportes — Histórico de Recebimentos", 40, 40);
    doc.setFontSize(9);
    doc.text(`Período: ${aplicados.dataInicio} a ${aplicados.dataFim} · Total: ${rows.length} leituras · OK: ${stats.ok} · Erros: ${stats.erros}`, 40, 58);
    autoTable(doc, {
      startY: 70,
      head: [["Data/Hora", "Operador", "Base", "Rota", "Motorista", "Cidade", "Código", "Resultado"]],
      body: rows.map((r) => [
        new Date(r.created_at).toLocaleString("pt-BR"),
        r.operador_nome ?? "—",
        r.base_codigo ?? "—",
        r.rota_codigo ?? "—",
        r.motorista_nome ?? "—",
        r.cidade ?? "—",
        r.codigo_bipado,
        r.resultado,
      ]),
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [15, 35, 72], textColor: 245 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    doc.save(`historico_${aplicados.dataInicio}_${aplicados.dataFim}.pdf`);
    toast.success(`PDF gerado com ${rows.length} linhas.`);
  }

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-md brand-gradient flex items-center justify-center">
          <History className="w-5 h-5 text-[var(--brand-yellow)]" />
        </div>
        <div>
          <h1 className="font-display text-xl md:text-2xl font-bold">Histórico de Recebimentos</h1>
          <p className="text-xs md:text-sm text-muted-foreground">Consulta completa com filtros e exportação Excel/PDF.</p>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div>
            <Label className="text-xs">Data início</Label>
            <Input type="date" value={filtros.dataInicio} onChange={(e) => setFiltros({ ...filtros, dataInicio: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Data fim</Label>
            <Input type="date" value={filtros.dataFim} onChange={(e) => setFiltros({ ...filtros, dataFim: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Base</Label>
            <Select value={filtros.baseId || "all"} onValueChange={(v) => setFiltros({ ...filtros, baseId: v === "all" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {(filtrosQuery.data?.bases ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.codigo} · {b.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Operador</Label>
            <Select value={filtros.operadorId || "all"} onValueChange={(v) => setFiltros({ ...filtros, operadorId: v === "all" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(filtrosQuery.data?.operadores ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.nome ?? o.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Resultado</Label>
            <Select value={filtros.resultado || "all"} onValueChange={(v) => setFiltros({ ...filtros, resultado: v === "all" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {RESULTADOS.map((r) => <SelectItem key={r.v} value={r.v}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Rota (contém)</Label>
            <Input value={filtros.rotaCodigo} onChange={(e) => setFiltros({ ...filtros, rotaCodigo: e.target.value })} placeholder="ex: AV1" />
          </div>
          <div>
            <Label className="text-xs">Código bipado</Label>
            <Input value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} placeholder="parte do código" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button onClick={aplicar} disabled={histQuery.isFetching}>
            <Search className="w-4 h-4 mr-1.5" /> Buscar
          </Button>
          <Button variant="outline" onClick={limpar}>
            <RotateCcw className="w-4 h-4 mr-1.5" /> Limpar
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Total: {stats.total}</Badge>
            <Badge className="bg-success text-success-foreground">OK: {stats.ok}</Badge>
            <Badge className="bg-destructive text-destructive-foreground">Erros: {stats.erros}</Badge>
            <Button variant="outline" size="sm" onClick={exportarExcel} disabled={!rows.length}>
              <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={exportarPDF} disabled={!rows.length}>
              <FileText className="w-4 h-4 mr-1.5" /> PDF
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto max-h-[65vh]">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0 z-10">
              <tr className="text-left">
                <Th>Data/Hora</Th>
                <Th>Operador</Th>
                <Th>Base</Th>
                <Th>Rota</Th>
                <Th>Motorista</Th>
                <Th>Cidade</Th>
                <Th>Código</Th>
                <Th>Resultado</Th>
                <Th>Δ tempo</Th>
              </tr>
            </thead>
            <tbody>
              {histQuery.isLoading && (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Carregando...</td></tr>
              )}
              {!histQuery.isLoading && rows.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Nenhum registro encontrado.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <Td mono>{new Date(r.created_at).toLocaleString("pt-BR")}</Td>
                  <Td>{r.operador_nome ?? "—"}</Td>
                  <Td>{r.base_codigo ?? "—"}</Td>
                  <Td mono>{r.rota_codigo ?? "—"}</Td>
                  <Td>{r.motorista_nome ?? "—"}</Td>
                  <Td>{r.cidade ?? "—"}</Td>
                  <Td mono className="max-w-[220px] truncate">{r.codigo_bipado}</Td>
                  <Td><ResultBadge r={r.resultado} /></Td>
                  <Td mono>{r.tempo_desde_ultima_ms ? `${(r.tempo_desde_ultima_ms / 1000).toFixed(1)}s` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">{children}</th>;
}
function Td({ children, mono, className = "" }: { children: React.ReactNode; mono?: boolean; className?: string }) {
  return <td className={`px-3 py-1.5 ${mono ? "font-mono" : ""} ${className}`}>{children}</td>;
}
function ResultBadge({ r }: { r: string }) {
  const cls =
    r === "ok" ? "bg-success text-success-foreground" :
    r === "duplicado" ? "bg-warning text-warning-foreground" :
    "bg-destructive text-destructive-foreground";
  return <Badge className={`${cls} text-[10px]`}>{r}</Badge>;
}
function rowToExport(r: HistoricoRow) {
  return {
    "Data/Hora": new Date(r.created_at).toLocaleString("pt-BR"),
    Operador: r.operador_nome ?? "",
    Email: r.operador_email ?? "",
    "Base Código": r.base_codigo ?? "",
    "Base Nome": r.base_nome ?? "",
    "Rota": r.rota_codigo ?? "",
    "Rota Final": r.rota_final ?? "",
    Motorista: r.motorista_nome ?? "",
    Cidade: r.cidade ?? "",
    "Código Bipado": r.codigo_bipado,
    Resultado: r.resultado,
    Mensagem: r.mensagem ?? "",
    "Δ desde última (ms)": r.tempo_desde_ultima_ms ?? "",
  };
}