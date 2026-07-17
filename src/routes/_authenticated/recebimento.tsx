import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { bipar, ultimasLeituras, type BipResult } from "@/lib/recebimento.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { beepError, beepOk, beepWarn } from "@/lib/scanner-sound";
import { CheckCircle2, AlertTriangle, XCircle, ScanLine, ArrowRight, Building2, Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { abrirRelatorio, baixarCSV } from "@/lib/relatorio";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RequireBaseOperacional } from "@/components/base-operacional-selector";
import { useBaseOperacional } from "@/lib/base-operacional-context";

export const Route = createFileRoute("/_authenticated/recebimento")({
  head: () => ({ meta: [{ title: "Recebimento — JM Transportes" }] }),
  component: RecebimentoGuard,
});

function RecebimentoGuard() {
  return (
    <RequireBaseOperacional
      titulo="Recebimento"
      descricao="Selecione a Base e o Dia Operacional. Cada bipe será carimbado com esta seleção."
    >
      <RecebimentoComHeader />
    </RequireBaseOperacional>
  );
}

function RecebimentoComHeader() {
  const { base, diaOperacional } = useBaseOperacional();
  return (
    <>
      <div className="border-b bg-muted/30 px-4 md:px-6 py-2 flex items-center gap-3 flex-wrap text-xs">
        <span className="font-display font-semibold text-sm">Recebimento</span>
        <span className="text-muted-foreground">·</span>
        <span>Base: <b>{base?.nome ?? "—"}</b>{base?.codigo && <span className="font-mono text-muted-foreground"> ({base.codigo})</span>}</span>
        <span className="text-muted-foreground">·</span>
        <span>Dia Operacional: <b className="font-mono">{diaOperacional ? new Date(diaOperacional + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</b></span>
      </div>
      <RecebimentoPage />
    </>
  );
}

const DEDUPE_MS = 700; // ignora bipagens repetidas idênticas dentro deste intervalo

function RecebimentoPage() {
  const qc = useQueryClient();
  const biparFn = useServerFn(bipar);
  const listaFn = useServerFn(ultimasLeituras);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastBipRef = useRef<{ codigo: string; ts: number } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [last, setLast] = useState<BipResult | null>(null);
  const [flash, setFlash] = useState<"ok" | "error" | null>(null);

  const lista = useQuery({ queryKey: ["ultimas-leituras"], queryFn: () => listaFn(), refetchInterval: 5000 });

  const mutation = useMutation({
    mutationFn: (cod: string) => {
      const tempo = lastBipRef.current ? Date.now() - lastBipRef.current.ts : undefined;
      return biparFn({ data: { codigo: cod, tempoDesdeUltimaMs: tempo } });
    },
    onSuccess: (res) => {
      setLast(res);
      qc.invalidateQueries({ queryKey: ["ultimas-leituras"] });
      if (res.resultado === "ok") {
        beepOk();
        setFlash("ok");
        toast.success(res.mensagem);
      } else if (res.resultado === "duplicado") {
        beepWarn();
        setFlash("error");
        toast.warning(res.mensagem);
      } else if (res.resultado === "outra_base") {
        beepError();
        setFlash("error");
        toast.error(res.mensagem, { duration: 6000 });
      } else {
        beepError();
        setFlash("error");
        toast.error(res.mensagem);
      }
      setTimeout(() => setFlash(null), 600);
    },
    onError: (err: unknown) => {
      beepError();
      setFlash("error");
      toast.error(err instanceof Error ? err.message : "Falha no recebimento.");
      setTimeout(() => setFlash(null), 600);
    },
  });

  const submit = useCallback(
    (cod: string) => {
      const trimmed = cod.trim();
      if (trimmed.length < 3) return;
      const now = Date.now();
      if (lastBipRef.current && lastBipRef.current.codigo === trimmed && now - lastBipRef.current.ts < DEDUPE_MS) {
        // ignora repetição imediata do scanner
        setCodigo("");
        inputRef.current?.focus();
        return;
      }
      lastBipRef.current = { codigo: trimmed, ts: now };
      mutation.mutate(trimmed);
      setCodigo("");
      inputRef.current?.focus();
    },
    [mutation],
  );

  // Mantém foco no input — essencial para leitores HID
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("button, a, input, textarea, [role=button]")) return;
      focus();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  const flashClass = flash === "ok" ? "scan-flash-ok" : flash === "error" ? "scan-flash-error" : "";

  const relatorioConfig = () => {
    const linhas = lista.data ?? [];
    type Linha = (typeof linhas)[number];
    const ok = linhas.filter((r) => r.resultado === "ok").length;
    const dup = linhas.filter((r) => r.resultado === "duplicado").length;
    const err = linhas.length - ok - dup;
    return {
      titulo: "Relatório de Recebimento",
      subtitulo: `${linhas.length} leituras · ${ok} OK · ${dup} duplicadas · ${err} com erro`,
      nomeArquivo: `recebimento_${new Date().toISOString().slice(0, 10)}`,
      kpis: [
        { label: "Total leituras", value: linhas.length },
        { label: "OK", value: ok },
        { label: "Duplicadas", value: dup },
        { label: "Com erro", value: err },
      ],
      colunas: [
        { header: "Hora", value: (r: Linha) => new Date(r.created_at).toLocaleTimeString("pt-BR") },
        { header: "Código", value: (r: Linha) => r.codigo_bipado },
        { header: "Rota", value: (r: Linha) => r.rotas?.codigo ?? "-" },
        { header: "Resultado", value: (r: Linha) => r.resultado },
        { header: "Mensagem", value: (r: Linha) => r.mensagem ?? "" },
      ],
      linhas,
    };
  };

  const baixarPDF = () => {
    const opened = abrirRelatorio({ ...relatorioConfig(), autoPrint: true });
    if (!opened) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
  };
  const baixarCsv = () => baixarCSV(relatorioConfig());
  const imprimirRel = baixarPDF;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Campo de leitura */}
      <Card className={`p-6 md:p-8 ${flashClass}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-md brand-gradient flex items-center justify-center">
            <ScanLine className="w-5 h-5 text-[var(--brand-yellow)]" />
          </div>
          <div className="flex-1">
            <h1 className="font-display text-xl md:text-2xl font-bold">Bipagem de Etiquetas</h1>
            <p className="text-xs md:text-sm text-muted-foreground">Aponte o leitor para a etiqueta. O código será processado automaticamente.</p>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="gap-2">
                  <Download className="w-4 h-4" /> Baixar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={baixarPDF}>
                  <Printer className="w-4 h-4 mr-2" /> Baixar PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={baixarCsv}>
                  <Download className="w-4 h-4 mr-2" /> Baixar CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secondary" size="sm" className="gap-2" onClick={imprimirRel}>
              <Printer className="w-4 h-4" /> Imprimir
            </Button>
          </div>
        </div>
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
          <Button type="submit" size="lg" className="h-14 px-8" disabled={mutation.isPending}>
            Receber
          </Button>
        </form>
      </Card>

      {/* Última leitura */}
      <UltimaLeituraCard last={last} pending={mutation.isPending} />

      {/* Lista das últimas 20 */}
      <Card className="p-4 md:p-6">
        <h2 className="font-display text-sm uppercase tracking-wider text-muted-foreground mb-3">Últimas 20 leituras</h2>
        <div className="divide-y">
          {(lista.data ?? []).map((r) => (
            <Row key={r.id} r={r} />
          ))}
          {(lista.data?.length ?? 0) === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">Nenhuma leitura ainda.</div>
          )}
        </div>
      </Card>
    </div>
  );
}

function UltimaLeituraCard({ last, pending }: { last: BipResult | null; pending: boolean }) {
  const status = useMemo(() => {
    if (!last) return null;
    if (last.resultado === "ok") {
      if (last.rota?.status === "recebida_completa")
        return { tag: "Recebimento Completo", icon: CheckCircle2, color: "bg-success text-success-foreground" };
      return { tag: "Recebimento Parcial", icon: CheckCircle2, color: "bg-warning text-warning-foreground" };
    }
    if (last.resultado === "duplicado")
      return { tag: "Volume Duplicado", icon: AlertTriangle, color: "bg-warning text-warning-foreground" };
    if (last.resultado === "outra_base")
      return { tag: "BASE INCORRETA", icon: AlertTriangle, color: "bg-destructive text-destructive-foreground" };
    return { tag: labelResultado(last.resultado), icon: XCircle, color: "bg-destructive text-destructive-foreground" };
  }, [last]);

  if (!last || !status) {
    return (
      <Card className="p-6 md:p-8 border-dashed">
        <div className="text-center text-muted-foreground text-sm">
          {pending ? "Processando leitura..." : "A última leitura aparecerá aqui."}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 md:p-8 overflow-hidden">
      {last.resultado === "outra_base" && (
        <div className="mb-4 p-4 rounded-lg bg-destructive/10 border-2 border-destructive flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="font-display font-bold text-destructive uppercase tracking-wide text-sm">Volume não pertence a esta base</div>
            <div className="text-sm mt-1">Destino correto: <span className="font-mono font-bold">{last.rota?.base_codigo}</span> · {last.rota?.base_nome}. Separe este volume para devolução / redirecionamento.</div>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Última leitura · {new Date(last.hora).toLocaleTimeString("pt-BR")}</div>
          <div className="font-display text-2xl md:text-3xl font-bold mt-1 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-base font-mono px-2 py-1 rounded bg-muted">
              <Building2 className="w-4 h-4" />{last.rota?.base_origem_codigo ?? "?"}
            </span>
            <ArrowRight className="w-5 h-5 text-muted-foreground" />
            <span className="inline-flex items-center gap-1.5 text-base font-mono px-2 py-1 rounded bg-primary text-primary-foreground">
              <Building2 className="w-4 h-4" />{last.rota?.base_codigo ?? "?"}
            </span>
            {last.rota?.rota_final && (
              <>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
                <span className="text-base font-mono px-2 py-1 rounded bg-[var(--brand-yellow)] text-[var(--brand-navy)]">{last.rota.rota_final}</span>
              </>
            )}
          </div>
        </div>
        <Badge className={`${status.color} text-xs font-semibold uppercase tracking-wider px-3 py-1.5`}>
          <status.icon className="w-3.5 h-3.5 mr-1.5" />
          {status.tag}
        </Badge>
      </div>

      {last.rota && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Info label="NF" value={last.rota.nf ?? "—"} mono />
            <Info label="Pack ID" value={last.rota.pack_id ?? "—"} mono />
            <Info label="Data prevista" value={last.rota.data_prevista ?? "—"} />
            <Info label="Janela" value={last.rota.janela_despacho ?? "—"} />
            <Info label="Destinatário" value={last.rota.destinatario_nome ?? "—"} />
            <Info label="CEP" value={last.rota.destinatario_cep ?? "—"} mono />
            <Info label="Endereço" value={last.rota.destinatario_endereco ?? "—"} />
            <Info label="Cidade" value={last.rota.cidade} />
          </div>

          <div className="mt-6">
            <div className="flex items-end justify-between mb-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Volumes</div>
              <div className="font-display text-xl">
                <span className="font-bold">{last.rota.quantidade_recebida}</span>
                <span className="text-muted-foreground"> / {last.rota.quantidade_prevista}</span>
                <span className="ml-2 text-sm text-muted-foreground">({last.rota.percentual}%)</span>
              </div>
            </div>
            <Progress value={last.rota.percentual} className="h-3" />
            {last.volume && (
              <div className="mt-2 text-xs text-muted-foreground font-mono">
                Volume bipado: {last.volume.codigo} ({last.volume.sequencia}/{last.volume.total})
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-4 text-sm">{last.mensagem}</div>
    </Card>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono font-medium" : "font-medium"}>{value}</div>
    </div>
  );
}

function labelResultado(r: BipResult["resultado"]) {
  switch (r) {
    case "inexistente": return "Código não encontrado";
    case "duplicado": return "Volume duplicado";
    case "outra_rota": return "Outra rota";
    case "outra_base": return "Outra base";
    case "cancelada": return "Rota cancelada";
    case "encerrada": return "Rota encerrada";
    case "volume_repetido": return "Volume repetido";
    default: return r;
  }
}

function Row({ r }: { r: { id: string; codigo_bipado: string; resultado: BipResult["resultado"]; created_at: string; mensagem: string | null; rotas: { codigo: string } | null } }) {
  const dot =
    r.resultado === "ok"
      ? "bg-success"
      : r.resultado === "duplicado"
        ? "bg-warning"
        : "bg-destructive";
  return (
    <div className="py-2.5 flex items-center gap-3 text-sm">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
      <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">
        {new Date(r.created_at).toLocaleTimeString("pt-BR")}
      </span>
      <span className="font-mono text-xs truncate max-w-[180px]">{r.codigo_bipado}</span>
      <span className="text-xs text-muted-foreground hidden md:block truncate flex-1">
        {r.rotas?.codigo ? `${r.rotas.codigo} · ` : ""}
        {r.mensagem}
      </span>
    </div>
  );
}