import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  biparTriagem,
  triagemResumoDia,
  ultimasTriagens,
  triagemRotasDoDia,
  triagemShipmentsPendentes,
  type TriagemResult,
} from "@/lib/triagem.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { beepError, beepOk, beepWarn } from "@/lib/scanner-sound";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ScanLine,
  Timer,
  Package,
  PackageCheck,
  PackageX,
  Percent,
  Download,
  Printer,
  RotateCcw,
  Pause,
  Play,
  Info,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { abrirRelatorio, baixarCSV, montarLinhasTriagemRota, type TriagemLinhaImpressao } from "@/lib/relatorio";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RequireBaseOperacional } from "@/components/base-operacional-selector";
import { useBaseOperacional } from "@/lib/base-operacional-context";

export const Route = createFileRoute("/_authenticated/triagem")({
  head: () => ({ meta: [{ title: "Triagem — JM Transportes" }] }),
  component: TriagemGuard,
});

function TriagemGuard() {
  return (
    <RequireBaseOperacional
      titulo="Triagem"
      descricao="Selecione a Base e o Dia Operacional. A escala ativa correspondente será carregada."
    >
      <TriagemComHeader />
    </RequireBaseOperacional>
  );
}

function TriagemComHeader() {
  const { base, diaOperacional, limpar } = useBaseOperacional();
  return (
    <>
      <div className="border-b bg-muted/30 px-4 md:px-6 py-2 flex items-center gap-3 flex-wrap text-xs">
        <span className="font-display font-semibold text-sm">Triagem</span>
        <span className="text-muted-foreground">·</span>
        <span>Base: <b>{base?.nome ?? "—"}</b>{base?.codigo && <span className="font-mono text-muted-foreground"> ({base.codigo})</span>}</span>
        <span className="text-muted-foreground">·</span>
        <span>Dia Operacional: <b className="font-mono">{diaOperacional ? new Date(diaOperacional + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</b></span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-xs"
          onClick={() => limpar()}
        >
          Trocar base / dia
        </Button>
      </div>
      <TriagemPage />
    </>
  );
}

const DEDUPE_MS = 700;
const STORAGE_KEY = "triagem:session:v1";
const ROTA_STORAGE_KEY = "triagem:rota-selecionada:v1";

type PersistedSession = {
  startedAt: number | null;
  accumulatedMs: number;
  paused: boolean;
  sessionOk: number;
  sessionErr: number;
  last: TriagemResult | null;
};

const defaultSession: PersistedSession = {
  startedAt: null,
  accumulatedMs: 0,
  paused: false,
  sessionOk: 0,
  sessionErr: 0,
  last: null,
};

function loadSession(): PersistedSession {
  if (typeof window === "undefined") return defaultSession;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSession;
    return { ...defaultSession, ...JSON.parse(raw) };
  } catch {
    return defaultSession;
  }
}

function TriagemPage() {
  const qc = useQueryClient();
  const { base, diaOperacional } = useBaseOperacional();
  const baseId = base!.id;
  const dataOperacional = diaOperacional!;
  const biparFn = useServerFn(biparTriagem);
  const listaFn = useServerFn(ultimasTriagens);
  const resumoFn = useServerFn(triagemResumoDia);
  const rotasFn = useServerFn(triagemRotasDoDia);
  const pendentesFn = useServerFn(triagemShipmentsPendentes);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<{ codigo: string; ts: number } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [session, setSession] = useState<PersistedSession>(defaultSession);
  const [hydrated, setHydrated] = useState(false);
  const [flash, setFlash] = useState<"ok" | "error" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [rotaSelecionada, setRotaSelecionada] = useState<string | null>(null);
  const [rotaDetalhe, setRotaDetalhe] = useState<string | null>(null);

  const detalheQuery = useQuery({
    queryKey: ["triagem-pendentes", baseId, dataOperacional, rotaDetalhe],
    queryFn: () =>
      pendentesFn({ data: { baseId, dataOperacional, rota: rotaDetalhe! } }),
    enabled: !!rotaDetalhe,
    refetchInterval: rotaDetalhe ? 5000 : false,
  });

  const { startedAt, accumulatedMs, paused, sessionOk, sessionErr, last } = session;

  // hydrate from localStorage
  useEffect(() => {
    setSession(loadSession());
    setHydrated(true);
  }, []);

  // hydrate rota selecionada por base+dia
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(`${ROTA_STORAGE_KEY}:${baseId}:${dataOperacional}`);
      setRotaSelecionada(raw && raw.length ? raw : null);
    } catch {
      setRotaSelecionada(null);
    }
  }, [baseId, dataOperacional]);

  const escolherRota = useCallback(
    (rota: string | null) => {
      setRotaSelecionada(rota);
      try {
        const key = `${ROTA_STORAGE_KEY}:${baseId}:${dataOperacional}`;
        if (rota) window.localStorage.setItem(key, rota);
        else window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    [baseId, dataOperacional],
  );

  // persist
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // ignore
    }
  }, [session, hydrated]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const resumo = useQuery({
    queryKey: ["triagem-resumo", baseId, dataOperacional],
    queryFn: () => resumoFn({ data: { baseId, dataOperacional } }),
    refetchInterval: 5000,
  });
  const lista = useQuery({
    queryKey: ["triagem-ultimas"],
    queryFn: () => listaFn(),
    refetchInterval: 5000,
  });
  const rotas = useQuery({
    queryKey: ["triagem-rotas", baseId, dataOperacional],
    queryFn: () => rotasFn({ data: { baseId, dataOperacional } }),
    refetchInterval: 5000,
  });

  // Se a rota selecionada bateu 100%, mantém aberta mas indica; se sumiu da lista, limpa.
  useEffect(() => {
    if (!rotaSelecionada || !rotas.data) return;
    const existe = rotas.data.some((r) => r.rota === rotaSelecionada);
    if (!existe) escolherRota(null);
  }, [rotas.data, rotaSelecionada, escolherRota]);

  const mutation = useMutation({
    mutationFn: (cod: string) => {
      const tempo = lastRef.current ? Date.now() - lastRef.current.ts : undefined;
      return biparFn({
        data: {
          codigo: cod,
          baseId,
          dataOperacional,
          tempoDesdeUltimaMs: tempo,
          rotaSelecionada: rotaSelecionada ?? undefined,
        },
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["triagem-ultimas"] });
      qc.invalidateQueries({ queryKey: ["triagem-resumo"] });
      qc.invalidateQueries({ queryKey: ["triagem-rotas"] });
      const isOk = res.resultado === "ok";
      const isWarn = res.resultado === "duplicado";
      if (isOk) {
        beepOk();
        setFlash("ok");
        toast.success(res.mensagem);
      } else if (isWarn) {
        beepWarn();
        setFlash("error");
        toast.warning(res.mensagem);
      } else {
        beepError();
        setFlash("error");
        toast.error(res.mensagem, { duration: 5000 });
      }
      setSession((s) => ({
        ...s,
        startedAt: s.paused ? Date.now() : (s.startedAt ?? Date.now()),
        paused: false,
        last: res,
        sessionOk: s.sessionOk + (isOk ? 1 : 0),
        sessionErr: s.sessionErr + (isOk ? 0 : 1),
      }));
      setTimeout(() => setFlash(null), 500);
      inputRef.current?.focus();
    },
    onError: (err: unknown) => {
      beepError();
      setFlash("error");
      setSession((s) => ({
        ...s,
        startedAt: s.paused ? Date.now() : (s.startedAt ?? Date.now()),
        paused: false,
        sessionErr: s.sessionErr + 1,
      }));
      toast.error(err instanceof Error ? err.message : "Falha na triagem.");
      setTimeout(() => setFlash(null), 500);
      inputRef.current?.focus();
    },
  });

  const submit = useCallback(
    (cod: string) => {
      if (paused) {
        toast.warning("Sessão pausada. Retome para bipar.");
        setCodigo("");
        return;
      }
      if (!rotaSelecionada) {
        toast.warning("Selecione a rota que será triada antes de bipar.");
        setCodigo("");
        return;
      }
      const trimmed = cod.trim();
      if (trimmed.length < 3) return;
      const ts = Date.now();
      if (
        lastRef.current &&
        lastRef.current.codigo === trimmed &&
        ts - lastRef.current.ts < DEDUPE_MS
      ) {
        setCodigo("");
        inputRef.current?.focus();
        return;
      }
      lastRef.current = { codigo: trimmed, ts };
      mutation.mutate(trimmed);
      setCodigo("");
    },
    [mutation, paused, rotaSelecionada],
  );

  // Foco permanente
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("button, a, input, textarea, [role=button]")) return;
      focus();
    };
    const onKey = () => focus();
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const relatorioConfig = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // ignore
    }
    const linhas = lista.data ?? [];
    type Linha = (typeof linhas)[number];
    return {
      titulo: "Relatório de Triagem",
      subtitulo: `Sessão · ${sessionOk} OK · ${sessionErr} erros · ${hh}:${mm}:${ss}`,
      nomeArquivo: `triagem_${new Date().toISOString().slice(0, 10)}`,
      kpis: [
        { label: "Volumes triados", value: totalTri },
        { label: "Pendentes", value: pendentes },
        { label: "Conclusão", value: `${pct}%` },
        { label: "Meus hoje", value: resumo.data?.meusHoje ?? 0 },
        { label: "Tempo da sessão", value: `${hh}:${mm}:${ss}` },
        { label: "Sessão OK / Erros", value: `${sessionOk} / ${sessionErr}` },
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
    const ok = abrirRelatorio({ ...relatorioConfig(), autoPrint: true });
    if (!ok) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
  };
  const baixarCsv = () => baixarCSV(relatorioConfig());
  const printSession = baixarPDF;

  const imprimirDetalheRota = useCallback(
    (
      rota: string,
      detalhe: { pendentes: Array<{ shipment: string; cidade: string | null }>; triados: Array<{ shipment: string; cidade: string | null }> },
    ) => {
      const linhas = montarLinhasTriagemRota(detalhe);
      const totalRota = linhas.length;
      const totalTriados = detalhe.triados.length;
      const totalPendentes = detalhe.pendentes.length;
      const pctRota = totalRota ? Math.round((totalTriados / totalRota) * 100) : 0;
      const ok = abrirRelatorio<TriagemLinhaImpressao>({
        titulo: `Triagem — Rota ${rota}`,
        subtitulo: `${base?.nome ?? ""} · ${dataOperacional ? new Date(dataOperacional + "T00:00:00").toLocaleDateString("pt-BR") : ""}`,
        nomeArquivo: `triagem_rota_${rota}_${dataOperacional}`,
        kpis: [
          { label: "Total da rota", value: totalRota },
          { label: "Triados", value: totalTriados },
          { label: "Pendentes", value: totalPendentes },
          { label: "Conclusão", value: `${pctRota}%` },
        ],
        colunas: [
          { header: "ID (Shipment)", value: (l) => l.shipment },
          { header: "Cidade", value: (l) => l.cidade ?? "" },
          { header: "Status", value: (l) => (l.status === "triado" ? "Triado" : "Pendente") },
        ],
        linhas,
        autoPrint: true,
      });
      if (!ok) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
    },
    [base?.nome, dataOperacional],
  );

  const imprimirRotaSelecionada = async () => {
    if (!rotaSelecionada) {
      toast.warning("Selecione uma rota para imprimir seus IDs.");
      return;
    }
    let detalhe = detalheQuery.data;
    if (!detalhe || detalhe.rota !== rotaSelecionada) {
      try {
        detalhe = await pendentesFn({
          data: { baseId, dataOperacional, rota: rotaSelecionada },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao carregar rota.");
        return;
      }
    }
    if (!detalhe) return;
    imprimirDetalheRota(rotaSelecionada, detalhe);
  };

  const imprimirDetalheModal = () => {
    if (!rotaDetalhe || !detalheQuery.data) return;
    imprimirDetalheRota(rotaDetalhe, detalheQuery.data);
  };

  const pauseSession = () => {
    setSession((s) => {
      if (s.paused) return s;
      const add = s.startedAt ? Date.now() - s.startedAt : 0;
      return { ...s, paused: true, startedAt: null, accumulatedMs: s.accumulatedMs + add };
    });
    toast.info("Sessão pausada.");
  };
  const resumeSession = () => {
    setSession((s) => (s.paused ? { ...s, paused: false, startedAt: Date.now() } : s));
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const resetSession = () => {
    if (!window.confirm("Encerrar e zerar a sessão atual?")) return;
    setSession(defaultSession);
    lastRef.current = null;
  };

  const totalPrev = resumo.data?.totalPrevistos ?? 0;
  const totalTri = resumo.data?.totalTriados ?? 0;
  const pendentes = resumo.data?.pendentes ?? 0;
  const pct = totalPrev ? Math.round((totalTri / totalPrev) * 100) : 0;

  const elapsedMs = accumulatedMs + (startedAt && !paused ? now - startedAt : 0);
  const elapsed = Math.floor(elapsedMs / 1000);
  const hh = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const flashClass =
    flash === "ok" ? "scan-flash-ok" : flash === "error" ? "scan-flash-error" : "";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi
          icon={PackageCheck}
          label="Volumes triados"
          value={totalTri.toLocaleString("pt-BR")}
          tone="success"
        />
        <Kpi
          icon={PackageX}
          label="Pendentes"
          value={pendentes.toLocaleString("pt-BR")}
          tone="warning"
        />
        <Kpi
          icon={Percent}
          label="Conclusão"
          value={`${pct}%`}
          tone="primary"
        />
        <Kpi
          icon={Package}
          label="Meus hoje"
          value={(resumo.data?.meusHoje ?? 0).toLocaleString("pt-BR")}
        />
        <Kpi
          icon={Timer}
          label="Tempo da sessão"
          value={`${hh}:${mm}:${ss}`}
        />
      </div>
      <Progress value={pct} className="h-2" />

      {/* Seletor de rota */}
      <RotasSelector
        rotas={rotas.data ?? []}
        selecionada={rotaSelecionada}
        onSelecionar={escolherRota}
        onDetalhes={(r) => setRotaDetalhe(r)}
        loading={rotas.isLoading}
      />

      {/* Scanner + status */}
      <div className="grid md:grid-cols-3 gap-6">
        <Card className={`md:col-span-2 p-6 md:p-10 ${flashClass} transition-colors`}>
          <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-md brand-gradient flex items-center justify-center">
                <ScanLine className="w-5 h-5 text-[var(--brand-yellow)]" />
              </div>
              <div>
                <h1 className="font-display text-2xl md:text-3xl font-bold leading-tight">
                  Triagem de Volumes
                </h1>
                <p className="text-xs md:text-sm text-muted-foreground">
                  {paused
                    ? "Sessão pausada."
                    : "A sessão inicia automaticamente na primeira leitura."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {paused ? (
                <Button onClick={resumeSession} className="gap-2">
                  <Play className="w-4 h-4" />
                  Retomar
                </Button>
              ) : (
                <Button
                  onClick={pauseSession}
                  variant="secondary"
                  className="gap-2"
                  disabled={!startedAt && accumulatedMs === 0}
                >
                  <Pause className="w-4 h-4" />
                  Pausar
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" className="gap-2">
                    <Download className="w-4 h-4" />
                    Baixar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={baixarPDF}>
                    <Printer className="w-4 h-4 mr-2" /> Baixar PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={baixarCsv}>
                    <Download className="w-4 h-4 mr-2" /> Baixar CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={imprimirRotaSelecionada}
                    disabled={!rotaSelecionada}
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Imprimir rota{rotaSelecionada ? ` ${rotaSelecionada}` : " selecionada"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={printSession} variant="secondary" className="gap-2">
                <Printer className="w-4 h-4" />
                Imprimir
              </Button>
              {(sessionOk > 0 || sessionErr > 0 || last) && (
                <Button onClick={resetSession} variant="ghost" size="icon" title="Zerar sessão">
                  <RotateCcw className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(codigo);
            }}
          >
            <Input
              ref={inputRef}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder={rotaSelecionada ? `Rota ${rotaSelecionada} — aguardando leitura…` : "Selecione uma rota para começar…"}
              className="h-20 md:h-24 text-3xl md:text-4xl font-mono tracking-widest text-center"
              disabled={!rotaSelecionada}
            />
          </form>

          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Sessão: <span className="text-success font-semibold">{sessionOk} OK</span> ·{" "}
              <span className="text-destructive font-semibold">{sessionErr} erros</span>
            </span>
            {last?.hora && (
              <span>Última: {new Date(last.hora).toLocaleTimeString("pt-BR")}</span>
            )}
          </div>
        </Card>

        <UltimoCard last={last} />
      </div>

      {/* Ocorrências / últimas leituras */}
      <Card className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-sm uppercase tracking-wider text-muted-foreground">
            Últimas 20 leituras
          </h2>
          <span className="text-xs text-muted-foreground">Atualizado em tempo real</span>
        </div>
        <div className="divide-y">
          {(lista.data ?? []).map((r) => (
            <Row key={r.id} r={r} />
          ))}
          {(lista.data?.length ?? 0) === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma leitura ainda.
            </div>
          )}
        </div>
      </Card>
      <RotaDetalheDialog
        rota={rotaDetalhe}
        onClose={() => setRotaDetalhe(null)}
        data={detalheQuery.data}
        loading={detalheQuery.isFetching}
        onImprimir={imprimirDetalheModal}
      />
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "success" | "warning" | "primary";
}) {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "primary"
          ? "text-primary"
          : "text-foreground";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className={`w-4 h-4 ${toneCls}`} />
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl md:text-3xl font-bold ${toneCls}`}>{value}</div>
    </Card>
  );
}

function UltimoCard({ last }: { last: TriagemResult | null }) {
  const status = useMemo(() => {
    if (!last) return null;
    if (last.resultado === "ok")
      return {
        tag:
          last.rota && last.rota.quantidade_triada >= last.rota.quantidade_prevista
            ? "Rota completa"
            : "Triado com sucesso",
        icon: CheckCircle2,
        color: "bg-success text-success-foreground",
      };
    if (last.resultado === "duplicado")
      return {
        tag: "Já triado",
        icon: AlertTriangle,
        color: "bg-warning text-warning-foreground",
      };
    return {
      tag: labelRes(last.resultado),
      icon: XCircle,
      color: "bg-destructive text-destructive-foreground",
    };
  }, [last]);

  if (!last || !status) {
    return (
      <Card className="p-6 border-dashed flex items-center justify-center text-center">
        <div className="text-sm text-muted-foreground">
          A última leitura aparecerá aqui.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Último código lido
        </div>
        <Badge
          className={`${status.color} text-[10px] font-semibold uppercase tracking-wider px-2 py-1`}
        >
          <status.icon className="w-3 h-3 mr-1" />
          {status.tag}
        </Badge>
      </div>
      <div className="font-mono text-lg md:text-xl font-bold break-all">
        {last.volume?.codigo ?? "—"}
      </div>
      {last.rota && (
        <div className="mt-4 space-y-3">
          <div className="text-xs text-muted-foreground">
            Rota <span className="font-mono font-semibold">{last.rota.codigo}</span>
            {last.rota.rota_final ? ` · ${last.rota.rota_final}` : ""} ·{" "}
            {last.rota.base_codigo ?? "?"}
          </div>
          <div>
            <div className="flex items-end justify-between text-xs mb-1">
              <span className="text-muted-foreground uppercase tracking-wider">
                Progresso da rota
              </span>
              <span className="font-mono">
                <span className="font-bold">{last.rota.quantidade_triada}</span>/
                {last.rota.quantidade_prevista} · {last.rota.percentual_triagem}%
              </span>
            </div>
            <Progress value={last.rota.percentual_triagem} className="h-2" />
          </div>
        </div>
      )}
      <div className="mt-4 text-sm">{last.mensagem}</div>
    </Card>
  );
}

function labelRes(r: TriagemResult["resultado"]) {
  switch (r) {
    case "inexistente":
      return "Não encontrado";
    case "nao_recebido":
      return "Não recebido";
    case "outra_base":
      return "Outra base";
    case "rota_divergente":
      return "Outra rota";
    case "cancelada":
      return "Cancelada";
    case "encerrada":
      return "Encerrada";
    default:
      return r;
  }
}

type RotaResumo = {
  rota: string;
  previstos: number;
  triados: number;
  pendentes: number;
  percentual: number;
  status: "aberta" | "fechada";
};

function RotasSelector({
  rotas,
  selecionada,
  onSelecionar,
  onDetalhes,
  loading,
}: {
  rotas: RotaResumo[];
  selecionada: string | null;
  onSelecionar: (rota: string | null) => void;
  onDetalhes: (rota: string) => void;
  loading: boolean;
}) {
  const abertas = rotas.filter((r) => r.status === "aberta");
  const fechadas = rotas.filter((r) => r.status === "fechada");
  return (
    <Card className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="font-display text-sm uppercase tracking-wider text-muted-foreground">
            Rotas do dia
          </h2>
          <p className="text-xs text-muted-foreground">
            Escolha a rota que será triada. A rota permanece aberta até bater 100%.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="border-warning text-warning">
            {abertas.length} abertas
          </Badge>
          <Badge variant="outline" className="border-success text-success">
            {fechadas.length} fechadas
          </Badge>
          {selecionada && (
            <Button size="sm" variant="ghost" onClick={() => onSelecionar(null)}>
              Limpar seleção
            </Button>
          )}
        </div>
      </div>
      {loading && rotas.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Carregando rotas…</div>
      ) : rotas.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          Nenhuma rota importada para esta base/dia.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {[...abertas, ...fechadas].map((r) => {
            const isSel = r.rota === selecionada;
            const fechada = r.status === "fechada";
            return (
              <button
                key={r.rota}
                type="button"
                onClick={() => onSelecionar(isSel ? null : r.rota)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDetalhes(r.rota);
                }}
                title="Duplo clique para ver IDs faltantes"
                className={`text-left rounded-md border p-3 transition-colors ${
                  isSel
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : fechada
                      ? "border-success/40 bg-success/5 hover:bg-success/10"
                      : "hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono font-bold text-sm truncate">{r.rota}</span>
                  <div className="flex items-center gap-1">
                    <Badge
                      className={`text-[10px] px-1.5 py-0 ${
                        fechada
                          ? "bg-success text-success-foreground"
                          : "bg-warning text-warning-foreground"
                      }`}
                    >
                      {fechada ? "Fechada" : "Aberta"}
                    </Badge>
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDetalhes(r.rota);
                      }}
                      className="p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground"
                      title="Ver IDs faltantes"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
                <div className="font-mono text-lg font-bold">
                  {r.triados}
                  <span className="text-muted-foreground text-sm font-normal">/{r.previstos}</span>
                </div>
                <Progress value={r.percentual} className="h-1.5 mt-2" />
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function RotaDetalheDialog({
  rota,
  onClose,
  data,
  loading,
  onImprimir,
}: {
  rota: string | null;
  onClose: () => void;
  data:
    | {
        rota: string;
        pendentes: Array<{ shipment: string; cidade: string | null }>;
        triados: Array<{ shipment: string; cidade: string | null }>;
      }
    | undefined;
  loading: boolean;
  onImprimir: () => void;
}) {
  const copiar = () => {
    if (!data) return;
    const txt = data.pendentes.map((p) => p.shipment).join("\n");
    navigator.clipboard.writeText(txt).then(
      () => toast.success("IDs faltantes copiados."),
      () => toast.error("Não foi possível copiar."),
    );
  };
  const podeImprimir = !!data && !loading;
  return (
    <Dialog open={!!rota} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">Rota {rota}</DialogTitle>
          <DialogDescription>
            Shipments pendentes (não bipados) e já triados desta rota.
          </DialogDescription>
        </DialogHeader>
        {loading && !data ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : !data ? null : (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="min-w-0">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="text-xs uppercase tracking-wider font-semibold text-warning">
                  Faltando ({data.pendentes.length})
                </div>
                <div className="flex items-center gap-1">
                  {data.pendentes.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={copiar} className="h-7 gap-1 text-xs">
                      <Copy className="w-3 h-3" /> Copiar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onImprimir}
                    disabled={!podeImprimir}
                    className="h-7 gap-1 text-xs"
                  >
                    <Printer className="w-3 h-3" /> Imprimir rota
                  </Button>
                </div>
              </div>
              <div className="border rounded-md max-h-[32vh] md:max-h-[50vh] overflow-auto divide-y">
                {data.pendentes.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">
                    Nenhum pendente — rota completa.
                  </div>
                ) : (
                  data.pendentes.map((p) => (
                    <div key={p.shipment} className="px-3 py-1.5 text-sm flex items-center justify-between gap-2 min-w-0">
                      <span className="font-mono truncate">{p.shipment}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[45%] text-right">{p.cidade ?? ""}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider font-semibold text-success mb-2">
                Triados ({data.triados.length})
              </div>
              <div className="border rounded-md max-h-[32vh] md:max-h-[50vh] overflow-auto divide-y">
                {data.triados.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">Nenhum triado ainda.</div>
                ) : (
                  data.triados.map((p) => (
                    <div key={p.shipment} className="px-3 py-1.5 text-sm flex items-center justify-between gap-2 min-w-0">
                      <span className="font-mono truncate">{p.shipment}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[45%] text-right">{p.cidade ?? ""}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
          <Button
            onClick={onImprimir}
            disabled={!podeImprimir}
            className="gap-2"
          >
            <Printer className="w-4 h-4" /> Imprimir rota
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


function Row({
  r,
}: {
  r: {
    id: string;
    codigo_bipado: string;
    resultado: string;
    created_at: string;
    mensagem: string | null;
    rotas: { codigo: string } | null;
  };
}) {
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
      <span className="font-mono text-xs truncate max-w-[200px]">{r.codigo_bipado}</span>
      <span className="text-xs text-muted-foreground hidden md:block truncate flex-1">
        {r.rotas?.codigo ? `${r.rotas.codigo} · ` : ""}
        {r.mensagem}
      </span>
    </div>
  );
}