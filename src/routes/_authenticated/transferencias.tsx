import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { RequireBaseOperacional } from "@/components/base-operacional-selector";
import { useBaseOperacional } from "@/lib/base-operacional-context";
import { contextoBaseOperacional } from "@/lib/base-operacional.functions";
import {
  caminhoEvidenciaTransferencia,
  cancelarTransferencia,
  corrigirMarcoTransferencia,
  editarTransferencia,
  listarTransferencias,
  proximaEtapa,
  registrarMarcoTransferencia,
  TRANSFERENCIA_ETAPAS,
  type TransferenciaDetalhe,
  type TransferenciaEtapa,
} from "@/lib/transferencias.functions";
import { supabase } from "@/integrations/supabase/client";
import { criarTransferenciasLote } from "@/lib/transferencias-lote.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/transferencias")({
  head: () => ({ meta: [{ title: "Transferências — JM Transportes" }] }),
  component: TransferenciasGuard,
});

// ============================================================
// Helpers
// ============================================================
function hojeYmd() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
function dataHoraLocal(iso?: string) {
  const data = iso ? new Date(iso) : new Date();
  data.setMinutes(data.getMinutes() - data.getTimezoneOffset());
  return data.toISOString().slice(0, 16);
}
function minutosEntre(inicio?: string, fim?: string) {
  if (!inicio || !fim) return null;
  return Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 60_000));
}
function duracao(minutos: number | null) {
  if (minutos == null) return "—";
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}
function eventoDe(t: TransferenciaDetalhe, etapa: TransferenciaEtapa) {
  return t.eventos.find((e) => e.etapa === etapa);
}
function serviceDaBase(nome?: string) {
  const base = (nome ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (base.includes("ibiuna")) return "SSP20";
  if (base.includes("guaruja")) return "SSP15";
  if (base.includes("embu")) return "SSP34";
  if (base.includes("franco")) return "SSP25";
  return "";
}
const SERVICES_OPERACIONAIS = ["SSP20", "SSP15", "SSP34", "SSP25"] as const;

// -----------------------------------------------------------
// Rotas (armazenadas como JSON no campo observacao)
// -----------------------------------------------------------
type Rota = { id: string; codigo: string; obs: string };
type ObsPayload = { rotas: Rota[]; notas: string };

function parseObs(raw: string | null | undefined): ObsPayload {
  if (!raw) return { rotas: [], notas: "" };
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object" && Array.isArray((p as ObsPayload).rotas)) {
      return {
        rotas: (p as ObsPayload).rotas.filter((r) => r && r.id && r.codigo != null),
        notas: (p as ObsPayload).notas ?? "",
      };
    }
  } catch {
    /* legado texto puro */
  }
  return { rotas: [], notas: String(raw) };
}
function serializeObs(p: ObsPayload): string {
  const limpo: ObsPayload = {
    rotas: p.rotas.map((r) => ({ id: r.id, codigo: r.codigo.trim(), obs: (r.obs ?? "").trim() })),
    notas: (p.notas ?? "").trim(),
  };
  if (limpo.rotas.length === 0 && !limpo.notas) return "";
  return JSON.stringify(limpo);
}

// -----------------------------------------------------------
// Status → Badge
// -----------------------------------------------------------
function statusInfo(status: string): { label: string; classe: string } {
  switch (status) {
    case "aguardando_chegada_service":
      return { label: "Aguardando Service", classe: "bg-slate-200 text-slate-700" };
    case "no_service":
    case "pendente_evidencia":
      return { label: "No Service", classe: "bg-sky-100 text-sky-700" };
    case "em_transito_xpt":
      return { label: "Em trânsito", classe: "bg-amber-100 text-amber-700" };
    case "no_xpt":
      return { label: "No XPT", classe: "bg-blue-100 text-blue-700" };
    case "concluida_no_prazo":
    case "concluida_com_atraso":
      return { label: "Finalizada", classe: "bg-emerald-100 text-emerald-700" };
    case "cancelada":
      return { label: "Cancelada", classe: "bg-slate-200 text-slate-500" };
    default:
      return { label: status, classe: "bg-slate-200 text-slate-700" };
  }
}
function StatusBadge({ status }: { status: string }) {
  const info = statusInfo(status);
  return (
    <span className={`inline-flex px-2 py-1 rounded-full text-[11px] font-semibold ${info.classe}`}>
      {info.label}
    </span>
  );
}

// -----------------------------------------------------------
// Tempo aguardando carga com tick vivo
// -----------------------------------------------------------
function corAguardando(min: number | null): string {
  if (min == null) return "text-muted-foreground";
  if (min <= 30) return "text-emerald-600";
  if (min <= 60) return "text-amber-600";
  return "text-red-600 font-bold";
}
function useTickSeconds(intervalMs = 30_000) {
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
function TempoAguardandoCarga({ t }: { t: TransferenciaDetalhe }) {
  useTickSeconds(30_000);
  const chegada = eventoDe(t, "chegada_service")?.ocorrido_em;
  const saida = eventoDe(t, "saida_service")?.ocorrido_em;
  const emAndamento = !!chegada && !saida && t.status !== "cancelada";
  const min = minutosEntre(chegada, saida ?? (emAndamento ? new Date().toISOString() : undefined));
  return (
    <span className={corAguardando(min)}>
      {min == null ? "—" : duracao(min)}
      {emAndamento && min != null && <span className="ml-1 text-[10px] uppercase">em curso</span>}
    </span>
  );
}

// ============================================================
// Guard
// ============================================================
function TransferenciasGuard() {
  return (
    <RequireBaseOperacional
      titulo="Transferências"
      descricao="Selecione a base e o dia para acompanhar a movimentação dos caminhões."
    >
      <TransferenciasPage />
    </RequireBaseOperacional>
  );
}

// ============================================================
// Página principal
// ============================================================
function TransferenciasPage() {
  const { base, diaOperacional } = useBaseOperacional();
  const listarFn = useServerFn(listarTransferencias);
  const contextoFn = useServerFn(contextoBaseOperacional);
  const criarLoteFn = useServerFn(criarTransferenciasLote);
  const marcoFn = useServerFn(registrarMarcoTransferencia);
  const corrigirMarcoFn = useServerFn(corrigirMarcoTransferencia);
  const editarFn = useServerFn(editarTransferencia);
  const cancelarFn = useServerFn(cancelarTransferencia);
  const qc = useQueryClient();

  const [dataRota, setDataRota] = useState(diaOperacional ?? hojeYmd());
  const [serviceFiltro, setServiceFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("todos");
  const [motoristaFiltro, setMotoristaFiltro] = useState("");
  const [placaFiltro, setPlacaFiltro] = useState("");
  const [expandidaId, setExpandidaId] = useState<string | null>(null);
  const [fotosDe, setFotosDe] = useState<TransferenciaDetalhe | null>(null);
  const [novaAberto, setNovaAberto] = useState(false);
  const [editando, setEditando] = useState<TransferenciaDetalhe | null>(null);

  const contexto = useQuery({
    queryKey: ["contexto-base-operacional"],
    queryFn: () => contextoFn(),
    staleTime: 60_000,
  });
  const isAdmin = contexto.data?.isAdmin === true;
  const serviceBase = serviceDaBase(base?.nome);

  const lista = useQuery({
    queryKey: ["transferencias-painel", dataRota, base?.id, isAdmin],
    queryFn: () =>
      listarFn({
        data: {
          inicio: dataRota,
          fim: dataRota,
          baseId: isAdmin && !base?.id ? undefined : base!.id,
        },
      }),
    enabled: !!dataRota && (!!base || isAdmin) && !!contexto.data,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const linhas = useMemo(() => {
    const termo = busca.trim().toLocaleUpperCase("pt-BR");
    const motoTermo = motoristaFiltro.trim().toLocaleUpperCase("pt-BR");
    const placaTermo = placaFiltro.trim().toLocaleUpperCase("pt-BR");
    return (lista.data ?? []).filter((t) => {
      if (t.status === "cancelada") return false;
      if (!serviceBase && serviceFiltro !== "todos" && t.service !== serviceFiltro) return false;
      if (statusFiltro !== "todos") {
        const grupo = statusInfo(t.status).label;
        if (grupo !== statusFiltro) return false;
      }
      if (motoTermo && !t.motorista.toLocaleUpperCase("pt-BR").includes(motoTermo)) return false;
      if (placaTermo && !t.placa.toLocaleUpperCase("pt-BR").includes(placaTermo)) return false;
      if (!termo) return true;
      return [t.motorista, t.placa, t.codigo, t.service, t.base_nome]
        .join(" ")
        .toLocaleUpperCase("pt-BR")
        .includes(termo);
    });
  }, [lista.data, busca, serviceFiltro, serviceBase, statusFiltro, motoristaFiltro, placaFiltro]);

  const services = useMemo(
    () =>
      Array.from(
        new Set([...SERVICES_OPERACIONAIS, ...(lista.data ?? []).map((t) => t.service)]),
      ).sort(),
    [lista.data],
  );

  useTickSeconds(60_000); // para KPIs "em andamento"

  const indicadores = useMemo(() => {
    const agoraIso = new Date().toISOString();
    const emAndamento = linhas.filter(
      (t) => !["concluida_no_prazo", "concluida_com_atraso", "cancelada"].includes(t.status),
    ).length;
    const finalizadasHoje = linhas.filter((t) =>
      ["concluida_no_prazo", "concluida_com_atraso"].includes(t.status),
    ).length;
    const esperas = linhas
      .map((t) => {
        const chegada = eventoDe(t, "chegada_service")?.ocorrido_em;
        const saida = eventoDe(t, "saida_service")?.ocorrido_em;
        if (!chegada) return null;
        return minutosEntre(chegada, saida ?? agoraIso);
      })
      .filter((v): v is number => v != null);
    const media = esperas.length
      ? Math.round(esperas.reduce((a, b) => a + b, 0) / esperas.length)
      : 0;
    const maior = esperas.length ? Math.max(...esperas) : 0;
    const atrasadas = linhas.filter((t) => {
      const chegada = eventoDe(t, "chegada_service")?.ocorrido_em;
      const saida = eventoDe(t, "saida_service")?.ocorrido_em;
      if (!chegada || saida) return false;
      const min = minutosEntre(chegada, agoraIso);
      return min != null && min > 60;
    }).length;
    const veiculos = new Set(linhas.map((t) => t.placa)).size;
    return { emAndamento, finalizadasHoje, media, maior, atrasadas, veiculos };
  }, [linhas]);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["transferencias-painel"] });
  }

  const criarMutation = useMutation({
    mutationFn: (dados: { motorista: string; placa: string; tipoVeiculo?: string; service: string }) =>
      criarLoteFn({
        data: {
          baseId: base!.id,
          dataOperacional: dataRota,
          linhas: [
            {
              service: serviceBase || dados.service,
              motorista: dados.motorista,
              placa: dados.placa.toUpperCase(),
              tipoVeiculo: dados.tipoVeiculo || undefined,
            },
          ],
        },
      }),
    onSuccess: (resultado) => {
      if (!resultado.sucessos) {
        toast.error(resultado.detalhes[0]?.mensagem ?? "Não foi possível criar a transferência.");
        return;
      }
      toast.success("Transferência criada.");
      setNovaAberto(false);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar transferência."),
  });

  const excluirMutation = useMutation({
    mutationFn: (transferenciaId: string) =>
      cancelarFn({
        data: {
          transferenciaId,
          justificativa: "Excluída pela operação na tela de Transferências.",
        },
      }),
    onSuccess: () => {
      toast.success("Transferência excluída.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao excluir."),
  });

  const concluirMutation = useMutation({
    mutationFn: (t: TransferenciaDetalhe) =>
      marcoFn({
        data: {
          transferenciaId: t.id,
          etapa: "saida_xpt",
          ocorridoEm: new Date().toISOString(),
          localizacaoTexto: "XPT",
        },
      }),
    onSuccess: () => {
      toast.success("Transferência concluída.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao concluir."),
  });

  const statusOpcoes = useMemo(() => {
    const set = new Set<string>();
    (lista.data ?? []).forEach((t) => set.add(statusInfo(t.status).label));
    return Array.from(set).sort();
  }, [lista.data]);

  return (
    <div className="p-3 md:p-6 max-w-[1500px] mx-auto space-y-5">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Truck className="w-7 h-7 text-primary shrink-0" /> Transferências
          </h1>
          <p className="text-sm text-muted-foreground">
            Chegada, carregamento, deslocamento e conclusão de cada transferência entre o Service e o XPT.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => refresh()}
            disabled={lista.isFetching}
            title="Atualizar"
          >
            <RefreshCcw className={`w-4 h-4 mr-2 ${lista.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button onClick={() => setNovaAberto(true)} disabled={!base?.id}>
            <Plus className="w-4 h-4 mr-2" /> Nova Transferência
          </Button>
        </div>
      </header>

      {/* Filtros */}
      <Card className="p-4">
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 items-end">
          <div>
            <Label>Base</Label>
            <Input value={base?.nome ?? (isAdmin ? "Todas as bases" : "—")} disabled />
          </div>
          <div>
            <Label>Service</Label>
            {serviceBase ? (
              <Input value={serviceBase} disabled className="font-semibold" />
            ) : (
              <Select value={serviceFiltro} onValueChange={setServiceFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os Services</SelectItem>
                  {services.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <Label>Data</Label>
            <Input type="date" value={dataRota} onChange={(e) => setDataRota(e.target.value)} />
          </div>
          <div>
            <Label>Buscar</Label>
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Motorista, placa ou código"
            />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={statusFiltro} onValueChange={setStatusFiltro}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {statusOpcoes.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Motorista</Label>
            <Input
              value={motoristaFiltro}
              onChange={(e) => setMotoristaFiltro(e.target.value)}
              placeholder="Nome"
            />
          </div>
          <div>
            <Label>Placa</Label>
            <Input
              value={placaFiltro}
              onChange={(e) => setPlacaFiltro(e.target.value.toUpperCase())}
              placeholder="ABC1D23"
            />
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi titulo="Em andamento" valor={indicadores.emAndamento} icone={Truck} />
        <Kpi titulo="Finalizadas hoje" valor={indicadores.finalizadasHoje} icone={CheckCircle2} tom="success" />
        <Kpi titulo="Tempo médio aguardando" valor={duracao(indicadores.media)} icone={Clock3} />
        <Kpi titulo="Maior tempo aguardando" valor={duracao(indicadores.maior)} icone={AlertTriangle} tom="warning" />
        <Kpi titulo="Atrasadas (>60min)" valor={indicadores.atrasadas} icone={AlertTriangle} tom="danger" />
        <Kpi titulo="Total de veículos" valor={indicadores.veiculos} icone={Truck} />
      </div>

      {/* Tabela */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr className="text-left">
                <th className="p-3 w-8" />
                <th className="p-3">Motorista</th>
                <th className="p-3">Placa</th>
                <th className="p-3 hidden md:table-cell">Service</th>
                <th className="p-3 text-center">Rotas</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-center">Aguardando carga</th>
                <th className="p-3 text-center w-16">Fotos</th>
                <th className="p-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((t) => {
                const expandida = expandidaId === t.id;
                const obs = parseObs(t.observacao);
                const totalFotos = t.evidencias.filter((e) => e.storage_path).length;
                return (
                  <Fragment key={t.id}>
                    <tr
                      className={`border-b last:border-0 hover:bg-muted/20 cursor-pointer ${
                        expandida ? "bg-muted/30" : ""
                      }`}
                      onClick={() => setExpandidaId(expandida ? null : t.id)}
                    >
                      <td className="p-3">
                        {expandida ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </td>
                      <td className="p-3">
                        <b>{t.motorista}</b>
                        <div className="text-xs text-muted-foreground">{t.codigo}</div>
                      </td>
                      <td className="p-3 font-mono">{t.placa}</td>
                      <td className="p-3 font-semibold hidden md:table-cell">{t.service}</td>
                      <td className="p-3 text-center">
                        <span className="inline-flex items-center gap-1">
                          <span className="font-semibold">{obs.rotas.length}</span>
                          <span className="text-xs text-muted-foreground">rota{obs.rotas.length === 1 ? "" : "s"}</span>
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="p-3 text-center font-semibold">
                        <TempoAguardandoCarga t={t} />
                      </td>
                      <td className="p-3 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={`Ver fotos (${totalFotos})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFotosDe(t);
                          }}
                        >
                          <Camera className="w-4 h-4" />
                          {totalFotos > 0 && (
                            <span className="ml-1 text-[10px] font-semibold">{totalFotos}</span>
                          )}
                        </Button>
                      </td>
                      <td className="p-3 text-right">
                        <div
                          className="flex justify-end gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Editar"
                            onClick={() => setEditando(t)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={
                              proximaEtapa(t.eventos) === "saida_xpt"
                                ? "Concluir transferência"
                                : "Concluir disponível somente após chegada no XPT"
                            }
                            className="text-emerald-600"
                            disabled={
                              proximaEtapa(t.eventos) !== "saida_xpt" ||
                              concluirMutation.isPending
                            }
                            onClick={() => concluirMutation.mutate(t)}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Excluir (admin)"
                              className="text-destructive"
                              disabled={excluirMutation.isPending}
                              onClick={() => {
                                if (confirm("Excluir esta transferência da operação?")) {
                                  excluirMutation.mutate(t.id);
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandida && (
                      <tr className="border-b bg-muted/10">
                        <td colSpan={9} className="p-4">
                          <LinhaExpandida
                            transferencia={t}
                            editarFn={editarFn}
                            marcoFn={marcoFn}
                            corrigirMarcoFn={corrigirMarcoFn}
                            onSalvo={refresh}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!lista.isLoading && linhas.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-muted-foreground">
                    Nenhuma transferência encontrada para os filtros selecionados.
                  </td>
                </tr>
              )}
              {lista.isLoading && (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-muted-foreground">
                    Carregando transferências…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <NovaTransferenciaDialog
        aberto={novaAberto}
        onFechar={() => setNovaAberto(false)}
        serviceFixo={serviceBase}
        services={services}
        salvando={criarMutation.isPending}
        onSalvar={(dados) => criarMutation.mutate(dados)}
      />

      <EditarTransferenciaDialog
        transferencia={editando}
        onFechar={() => setEditando(null)}
        serviceFixo={serviceBase}
        services={services}
        editarFn={editarFn}
        onSalvo={refresh}
      />

      <FotosDialog transferencia={fotosDe} onFechar={() => setFotosDe(null)} />
    </div>
  );
}

// ============================================================
// Linha expandida (rotas + timeline + próxima etapa)
// ============================================================
function LinhaExpandida({
  transferencia,
  editarFn,
  marcoFn,
  corrigirMarcoFn,
  onSalvo,
}: {
  transferencia: TransferenciaDetalhe;
  editarFn: ReturnType<typeof useServerFn<typeof editarTransferencia>>;
  marcoFn: ReturnType<typeof useServerFn<typeof registrarMarcoTransferencia>>;
  corrigirMarcoFn: ReturnType<typeof useServerFn<typeof corrigirMarcoTransferencia>>;
  onSalvo: () => void;
}) {
  const proxima = proximaEtapa(transferencia.eventos);
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        <RotasManager transferencia={transferencia} editarFn={editarFn} onSalvo={onSalvo} />
        <TimelineHistorico transferencia={transferencia} />
      </div>
      <div className="space-y-4">
        <ProximaEtapaForm
          transferencia={transferencia}
          etapa={proxima}
          marcoFn={marcoFn}
          corrigirMarcoFn={corrigirMarcoFn}
          onSalvo={onSalvo}
        />
        <NotasEditor transferencia={transferencia} editarFn={editarFn} onSalvo={onSalvo} />
      </div>
    </div>
  );
}

// ============================================================
// Rotas Manager
// ============================================================
function RotasManager({
  transferencia,
  editarFn,
  onSalvo,
}: {
  transferencia: TransferenciaDetalhe;
  editarFn: ReturnType<typeof useServerFn<typeof editarTransferencia>>;
  onSalvo: () => void;
}) {
  const inicial = parseObs(transferencia.observacao);
  const [rotas, setRotas] = useState<Rota[]>(inicial.rotas);
  const [codigo, setCodigo] = useState("");
  const [obs, setObs] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);

  useEffect(() => {
    setRotas(parseObs(transferencia.observacao).rotas);
  }, [transferencia.observacao]);

  const mutation = useMutation({
    mutationFn: (novaLista: Rota[]) => {
      const payload = serializeObs({ rotas: novaLista, notas: inicial.notas });
      return editarFn({
        data: {
          transferenciaId: transferencia.id,
          service: transferencia.service,
          motorista: transferencia.motorista,
          placa: transferencia.placa,
          tipoVeiculo: transferencia.tipo_veiculo ?? undefined,
          observacao: payload,
        },
      });
    },
    onSuccess: () => {
      toast.success("Rotas salvas.");
      setCodigo("");
      setObs("");
      setEditandoId(null);
      onSalvo();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar rotas."),
  });

  function adicionar() {
    const c = codigo.trim();
    if (!c) return;
    const nova: Rota = { id: crypto.randomUUID(), codigo: c, obs: obs.trim() };
    const lista = [...rotas, nova];
    setRotas(lista);
    mutation.mutate(lista);
  }
  function salvarEdicao(id: string) {
    const c = codigo.trim();
    if (!c) return;
    const lista = rotas.map((r) => (r.id === id ? { ...r, codigo: c, obs: obs.trim() } : r));
    setRotas(lista);
    mutation.mutate(lista);
  }
  function excluir(id: string) {
    const lista = rotas.filter((r) => r.id !== id);
    setRotas(lista);
    mutation.mutate(lista);
  }
  function iniciarEdicao(r: Rota) {
    setEditandoId(r.id);
    setCodigo(r.codigo);
    setObs(r.obs);
  }
  function cancelarEdicao() {
    setEditandoId(null);
    setCodigo("");
    setObs("");
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Rotas ({rotas.length})</h3>
      </div>
      <div className="space-y-2">
        {rotas.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhuma rota cadastrada.</p>
        )}
        {rotas.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-2 rounded-md border bg-background p-2 text-sm"
          >
            <div className="flex-1 min-w-0">
              <div className="font-mono font-semibold truncate">{r.codigo}</div>
              {r.obs && <div className="text-xs text-muted-foreground truncate">{r.obs}</div>}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Editar rota"
              onClick={() => iniciarEdicao(r)}
              disabled={mutation.isPending}
            >
              <Pencil className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              title="Excluir rota"
              onClick={() => excluir(r.id)}
              disabled={mutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[1fr_1.4fr_auto] gap-2 items-end">
        <div>
          <Label className="text-xs">Código</Label>
          <Input
            className="h-8 text-xs"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Ex.: R-123"
          />
        </div>
        <div>
          <Label className="text-xs">Observação</Label>
          <Input
            className="h-8 text-xs"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Opcional"
          />
        </div>
        {editandoId ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-8"
              disabled={!codigo.trim() || mutation.isPending}
              onClick={() => salvarEdicao(editandoId)}
            >
              <Save className="w-3 h-3 mr-1" /> Salvar
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={cancelarEdicao}>
              <X className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="h-8"
            disabled={!codigo.trim() || mutation.isPending}
            onClick={adicionar}
          >
            <Plus className="w-3 h-3 mr-1" /> Adicionar rota
          </Button>
        )}
      </div>
    </Card>
  );
}

// ============================================================
// Timeline histórico
// ============================================================
function TimelineHistorico({ transferencia }: { transferencia: TransferenciaDetalhe }) {
  return (
    <Card className="p-4">
      <h3 className="font-semibold text-sm mb-3">Histórico</h3>
      <ol className="relative border-l ml-2 space-y-3">
        {TRANSFERENCIA_ETAPAS.map((etapa) => {
          const ev = eventoDe(transferencia, etapa.value);
          const ocorrencia = transferencia.ocorrencias.find((o) => o.etapa === etapa.value);
          return (
            <li key={etapa.value} className="ml-4">
              <span
                className={`absolute -left-[6px] w-3 h-3 rounded-full border-2 border-background ${
                  ev ? "bg-primary" : "bg-muted"
                }`}
              />
              <div className="flex items-baseline justify-between gap-2">
                <b className="text-sm">{etapa.label}</b>
                <span className="text-xs text-muted-foreground">
                  {ev
                    ? new Date(ev.ocorrido_em).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "Pendente"}
                </span>
              </div>
              {ev?.localizacao_texto && (
                <div className="text-xs text-muted-foreground">📍 {ev.localizacao_texto}</div>
              )}
              {ev && ev.minutos_atraso > 0 && (
                <div className="text-xs text-amber-600">
                  Atraso: {duracao(ev.minutos_atraso)}
                </div>
              )}
              {ocorrencia?.observacao && (
                <div className="text-xs text-muted-foreground italic">
                  {ocorrencia.observacao}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ============================================================
// Notas gerais (observação livre)
// ============================================================
function NotasEditor({
  transferencia,
  editarFn,
  onSalvo,
}: {
  transferencia: TransferenciaDetalhe;
  editarFn: ReturnType<typeof useServerFn<typeof editarTransferencia>>;
  onSalvo: () => void;
}) {
  const inicial = parseObs(transferencia.observacao);
  const [notas, setNotas] = useState(inicial.notas);
  useEffect(() => setNotas(parseObs(transferencia.observacao).notas), [transferencia.observacao]);

  const mutation = useMutation({
    mutationFn: () =>
      editarFn({
        data: {
          transferenciaId: transferencia.id,
          service: transferencia.service,
          motorista: transferencia.motorista,
          placa: transferencia.placa,
          tipoVeiculo: transferencia.tipo_veiculo ?? undefined,
          observacao: serializeObs({ rotas: inicial.rotas, notas }),
        },
      }),
    onSuccess: () => {
      toast.success("Observações salvas.");
      onSalvo();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar observações."),
  });

  const alterada = notas !== inicial.notas;
  return (
    <Card className="p-4">
      <h3 className="font-semibold text-sm mb-2">Observações</h3>
      <textarea
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        rows={3}
        maxLength={2000}
        className="w-full rounded-md border bg-background p-2 text-sm"
        placeholder="Anote informações complementares sobre esta transferência."
      />
      <div className="flex justify-end mt-2">
        <Button
          size="sm"
          disabled={!alterada || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          <Save className="w-3 h-3 mr-1" /> {mutation.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </Card>
  );
}

// ============================================================
// Próxima etapa
// ============================================================
function ProximaEtapaForm({
  transferencia,
  etapa,
  marcoFn,
  corrigirMarcoFn,
  onSalvo,
}: {
  transferencia: TransferenciaDetalhe;
  etapa: TransferenciaEtapa | null;
  marcoFn: ReturnType<typeof useServerFn<typeof registrarMarcoTransferencia>>;
  corrigirMarcoFn: ReturnType<typeof useServerFn<typeof corrigirMarcoTransferencia>>;
  onSalvo: () => void;
}) {
  const [modoCorrigir, setModoCorrigir] = useState(false);
  const etapaAtiva = etapa
    ? etapa
    : modoCorrigir
      ? ("saida_xpt" as TransferenciaEtapa)
      : null;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">
          {etapa ? "Próxima etapa" : "Transferência finalizada"}
        </h3>
        {!etapa && !modoCorrigir && (
          <Button variant="outline" size="sm" onClick={() => setModoCorrigir(true)}>
            <Pencil className="w-3 h-3 mr-1" /> Corrigir última etapa
          </Button>
        )}
      </div>
      {etapaAtiva ? (
        <EtapaForm
          transferencia={transferencia}
          etapa={etapaAtiva}
          modoCorrigir={!etapa}
          marcoFn={marcoFn}
          corrigirMarcoFn={corrigirMarcoFn}
          onSalvo={() => {
            setModoCorrigir(false);
            onSalvo();
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Todas as etapas foram registradas com sucesso.
        </p>
      )}
    </Card>
  );
}

function EtapaForm({
  transferencia,
  etapa,
  modoCorrigir,
  marcoFn,
  corrigirMarcoFn,
  onSalvo,
}: {
  transferencia: TransferenciaDetalhe;
  etapa: TransferenciaEtapa;
  modoCorrigir: boolean;
  marcoFn: ReturnType<typeof useServerFn<typeof registrarMarcoTransferencia>>;
  corrigirMarcoFn: ReturnType<typeof useServerFn<typeof corrigirMarcoTransferencia>>;
  onSalvo: () => void;
}) {
  const eventoAtual = eventoDe(transferencia, etapa);
  const evidenciaAtual = transferencia.evidencias.find((e) => e.etapa === etapa);
  const [horario, setHorario] = useState(dataHoraLocal(eventoAtual?.ocorrido_em));
  const [localizacao, setLocalizacao] = useState(eventoAtual?.localizacao_texto ?? "");
  const [foto, setFoto] = useState<File | null>(null);
  const [timemark, setTimemark] = useState(evidenciaAtual?.timemark_url ?? "");
  const [fotoKey, setFotoKey] = useState(0);
  const etapaLabel = TRANSFERENCIA_ETAPAS.find((e) => e.value === etapa)?.label ?? etapa;

  const mutation = useMutation({
    mutationFn: async () => {
      let storagePath: string | undefined;
      if (foto) {
        if (foto.size > 10 * 1024 * 1024) throw new Error("A foto deve ter no máximo 10 MB.");
        storagePath = caminhoEvidenciaTransferencia(
          transferencia.base_id,
          transferencia.id,
          etapa,
          foto.name,
        );
        const { error } = await supabase.storage
          .from("transferencias-evidencias")
          .upload(storagePath, foto, { upsert: false, contentType: foto.type });
        if (error) throw new Error(error.message);
      }
      try {
        if (modoCorrigir) {
          return await corrigirMarcoFn({
            data: {
              transferenciaId: transferencia.id,
              etapa,
              ocorridoEm: new Date(horario).toISOString(),
              localizacaoTexto: localizacao || undefined,
              storagePath,
              timemarkUrl: timemark,
              horarioEvidencia:
                foto || timemark ? new Date(horario).toISOString() : undefined,
            },
          });
        }
        return await marcoFn({
          data: {
            transferenciaId: transferencia.id,
            etapa,
            ocorridoEm: new Date(horario).toISOString(),
            storagePath,
            timemarkUrl: timemark || undefined,
            horarioEvidencia:
              foto || timemark ? new Date(horario).toISOString() : undefined,
            localizacaoTexto: localizacao || undefined,
          },
        });
      } catch (error) {
        if (storagePath)
          await supabase.storage.from("transferencias-evidencias").remove([storagePath]);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success(modoCorrigir ? "Etapa corrigida." : "Etapa registrada.");
      setFoto(null);
      setFotoKey((k) => k + 1);
      setTimemark("");
      onSalvo();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao registrar etapa."),
  });

  return (
    <div className="space-y-3">
      <div className="text-sm">
        Etapa: <b>{etapaLabel}</b>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Horário</Label>
          <Input
            type="datetime-local"
            value={horario}
            onChange={(e) => setHorario(e.target.value)}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Localização</Label>
          <Input
            value={localizacao}
            onChange={(e) => setLocalizacao(e.target.value)}
            placeholder="Ex.: SSP20 / doca 3"
            className="h-9"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Foto (opcional)</Label>
          <Input
            key={fotoKey}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
            className="h-9 text-xs file:text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">Link TimeMark (opcional)</Label>
          <Input
            type="url"
            value={timemark}
            onChange={(e) => setTimemark(e.target.value)}
            placeholder="https://..."
            className="h-9"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          <Save className="w-4 h-4 mr-1" />
          {mutation.isPending
            ? "Salvando…"
            : modoCorrigir
              ? "Salvar correção"
              : "Registrar etapa"}
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// Dialog: Fotos
// ============================================================
function FotosDialog({
  transferencia,
  onFechar,
}: {
  transferencia: TransferenciaDetalhe | null;
  onFechar: () => void;
}) {
  const fotos = transferencia
    ? transferencia.evidencias
        .filter((e) => e.signed_url)
        .map((e) => ({
          url: e.signed_url as string,
          etapa: e.etapa,
          horario: e.horario_evidencia,
        }))
    : [];
  return (
    <Dialog open={!!transferencia} onOpenChange={(open) => !open && onFechar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Fotos da transferência</DialogTitle>
          <DialogDescription>
            {transferencia
              ? `${transferencia.codigo} · ${transferencia.motorista} · ${transferencia.placa}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {fotos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma foto anexada nas etapas desta transferência.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[70vh] overflow-y-auto">
            {fotos.map((f, i) => {
              const etapaLabel =
                TRANSFERENCIA_ETAPAS.find((e) => e.value === f.etapa)?.label ?? f.etapa;
              return (
                <a
                  key={i}
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block group border rounded-md overflow-hidden"
                >
                  <img
                    src={f.url}
                    alt={etapaLabel}
                    className="w-full h-40 object-cover group-hover:opacity-90"
                    loading="lazy"
                  />
                  <div className="p-2 text-xs">
                    <b>{etapaLabel}</b>
                    {f.horario && (
                      <div className="text-muted-foreground">
                        {new Date(f.horario).toLocaleString("pt-BR")}
                      </div>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog: Nova transferência
// ============================================================
function NovaTransferenciaDialog({
  aberto,
  onFechar,
  serviceFixo,
  services,
  salvando,
  onSalvar,
}: {
  aberto: boolean;
  onFechar: () => void;
  serviceFixo: string;
  services: string[];
  salvando: boolean;
  onSalvar: (dados: {
    motorista: string;
    placa: string;
    tipoVeiculo?: string;
    service: string;
  }) => void;
}) {
  const [motorista, setMotorista] = useState("");
  const [placa, setPlaca] = useState("");
  const [tipo, setTipo] = useState("");
  const [service, setService] = useState(serviceFixo || services[0] || "");

  useEffect(() => {
    if (aberto) {
      setMotorista("");
      setPlaca("");
      setTipo("");
      setService(serviceFixo || services[0] || "");
    }
  }, [aberto, serviceFixo, services]);

  const valido =
    motorista.trim().length >= 2 && placa.trim().length >= 5 && (serviceFixo || service).length >= 2;

  return (
    <Dialog open={aberto} onOpenChange={(open) => !open && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova Transferência</DialogTitle>
          <DialogDescription>
            Cadastre o veículo. Rotas e etapas poderão ser preenchidas depois.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Service</Label>
            {serviceFixo ? (
              <Input value={serviceFixo} disabled className="font-semibold" />
            ) : (
              <Select value={service} onValueChange={setService}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <Label>Motorista</Label>
            <Input
              value={motorista}
              onChange={(e) => setMotorista(e.target.value)}
              placeholder="Nome do motorista"
            />
          </div>
          <div>
            <Label>Placa</Label>
            <Input
              value={placa}
              onChange={(e) => setPlaca(e.target.value.toUpperCase())}
              placeholder="ABC1D23"
            />
          </div>
          <div>
            <Label>Tipo de veículo</Label>
            <Input
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              placeholder="Truck, Van…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={!valido || salvando}
            onClick={() =>
              onSalvar({
                motorista,
                placa,
                tipoVeiculo: tipo || undefined,
                service: serviceFixo || service,
              })
            }
          >
            <Save className="w-4 h-4 mr-1" />
            {salvando ? "Criando…" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog: Editar transferência
// ============================================================
function EditarTransferenciaDialog({
  transferencia,
  onFechar,
  serviceFixo,
  services,
  editarFn,
  onSalvo,
}: {
  transferencia: TransferenciaDetalhe | null;
  onFechar: () => void;
  serviceFixo: string;
  services: string[];
  editarFn: ReturnType<typeof useServerFn<typeof editarTransferencia>>;
  onSalvo: () => void;
}) {
  const [motorista, setMotorista] = useState("");
  const [placa, setPlaca] = useState("");
  const [tipo, setTipo] = useState("");
  const [service, setService] = useState("");

  useEffect(() => {
    if (transferencia) {
      setMotorista(transferencia.motorista);
      setPlaca(transferencia.placa);
      setTipo(transferencia.tipo_veiculo ?? "");
      setService(transferencia.service);
    }
  }, [transferencia]);

  const mutation = useMutation({
    mutationFn: () =>
      editarFn({
        data: {
          transferenciaId: transferencia!.id,
          service: serviceFixo || service,
          motorista,
          placa,
          tipoVeiculo: tipo || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Transferência atualizada.");
      onFechar();
      onSalvo();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao editar."),
  });

  const valido =
    motorista.trim().length >= 2 && placa.trim().length >= 5 && (serviceFixo || service).length >= 2;

  return (
    <Dialog open={!!transferencia} onOpenChange={(open) => !open && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar transferência</DialogTitle>
          <DialogDescription>{transferencia?.codigo}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Service</Label>
            {serviceFixo ? (
              <Input value={serviceFixo} disabled className="font-semibold" />
            ) : (
              <Select value={service} onValueChange={setService}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <Label>Motorista</Label>
            <Input value={motorista} onChange={(e) => setMotorista(e.target.value)} />
          </div>
          <div>
            <Label>Placa</Label>
            <Input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label>Tipo de veículo</Label>
            <Input value={tipo} onChange={(e) => setTipo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={!valido || mutation.isPending} onClick={() => mutation.mutate()}>
            <Save className="w-4 h-4 mr-1" />
            {mutation.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// KPI Card
// ============================================================
function Kpi({
  titulo,
  valor,
  icone: Icon,
  tom = "default",
}: {
  titulo: string;
  valor: string | number;
  icone: typeof Truck;
  tom?: "default" | "success" | "warning" | "danger";
}) {
  const caixa =
    tom === "success"
      ? "bg-emerald-50 text-emerald-600"
      : tom === "warning"
        ? "bg-amber-50 text-amber-600"
        : tom === "danger"
          ? "bg-red-50 text-red-600"
          : "bg-primary/10 text-primary";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${caixa}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold truncate">{valor}</div>
          <div className="text-xs text-muted-foreground">{titulo}</div>
        </div>
      </div>
    </Card>
  );
}
