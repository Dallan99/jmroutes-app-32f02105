import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
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
  type TransferenciaDetalhe,
  type TransferenciaEtapa,
} from "@/lib/transferencias.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  criarTransferenciasLote,
  registrarMarcosTransferenciaLote,
  type LinhaCadastroTransferencia,
} from "@/lib/transferencias-lote.functions";
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

function minutosDoDiaEmSaoPaulo(iso?: string) {
  if (!iso) return null;
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hora = Number(partes.find((parte) => parte.type === "hour")?.value);
  const minuto = Number(partes.find((parte) => parte.type === "minute")?.value);
  return Number.isFinite(hora) && Number.isFinite(minuto) ? hora * 60 + minuto : null;
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

type RascunhoRota = LinhaCadastroTransferencia & { id: string };

function novoRascunho(service: string): RascunhoRota {
  return { id: crypto.randomUUID(), service, motorista: "", placa: "", tipoVeiculo: "" };
}

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

function TransferenciasPage() {
  const { base, diaOperacional } = useBaseOperacional();
  const listarFn = useServerFn(listarTransferencias);
  const contextoFn = useServerFn(contextoBaseOperacional);
  const criarLoteFn = useServerFn(criarTransferenciasLote);
  const marcoLoteFn = useServerFn(registrarMarcosTransferenciaLote);
  const marcoFn = useServerFn(registrarMarcoTransferencia);
  const corrigirMarcoFn = useServerFn(corrigirMarcoTransferencia);
  const editarFn = useServerFn(editarTransferencia);
  const cancelarFn = useServerFn(cancelarTransferencia);
  const qc = useQueryClient();

  const [dataRota, setDataRota] = useState(diaOperacional ?? hojeYmd());
  const [service, setService] = useState("todos");
  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [rascunhos, setRascunhos] = useState<RascunhoRota[]>([]);
  const [editando, setEditando] = useState<TransferenciaDetalhe | null>(null);
  const [marcoLote, setMarcoLote] = useState<TransferenciaEtapa | null>(null);

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
    refetchInterval: 30_000,
  });

  const linhas = useMemo(() => {
    const termo = busca.trim().toLocaleUpperCase("pt-BR");
    return (lista.data ?? []).filter((t) => {
      if (t.status === "cancelada") return false;
      if (!serviceBase && service !== "todos" && t.service !== service) return false;
      if (!termo) return true;
      return [t.motorista, t.placa, t.codigo, t.service, t.base_nome]
        .join(" ")
        .toLocaleUpperCase("pt-BR")
        .includes(termo);
    });
  }, [lista.data, busca, service, serviceBase]);

  const services = useMemo(
    () => Array.from(new Set([...SERVICES_OPERACIONAIS, ...(lista.data ?? []).map((t) => t.service)])).sort(),
    [lista.data],
  );

  const criarMutation = useMutation({
    mutationFn: async (rascunho: RascunhoRota) => {
      const resultado = await criarLoteFn({
        data: {
          baseId: base!.id,
          dataOperacional: dataRota,
          linhas: [{
            service: serviceBase || rascunho.service,
            motorista: rascunho.motorista,
            placa: rascunho.placa.toUpperCase(),
            tipoVeiculo: rascunho.tipoVeiculo || undefined,
          }],
        },
      });
      if (!resultado.sucessos) throw new Error(resultado.detalhes[0]?.mensagem ?? "Não foi possível criar a rota.");
      return resultado;
    },
    onSuccess: (_resultado, rascunho) => {
      setRascunhos((atual) => atual.filter((item) => item.id !== rascunho.id));
      toast.success("Rota adicionada.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao adicionar rota."),
  });

  const editarMutation = useMutation({
    mutationFn: (dados: { transferenciaId: string; service: string; motorista: string; placa: string; tipoVeiculo?: string }) => editarFn({ data: dados }),
    onSuccess: () => { toast.success("Rota atualizada."); setEditando(null); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao editar rota."),
  });

  const excluirMutation = useMutation({
    mutationFn: (transferenciaId: string) => cancelarFn({ data: { transferenciaId, justificativa: "Excluída pela operação na tela de Transferências." } }),
    onSuccess: () => { toast.success("Rota excluída da operação."); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao excluir rota."),
  });

  const concluirMutation = useMutation({
    mutationFn: (transferencia: TransferenciaDetalhe) => marcoFn({ data: { transferenciaId: transferencia.id, etapa: "saida_xpt", ocorridoEm: new Date().toISOString(), localizacaoTexto: "XPT" } }),
    onSuccess: () => { toast.success("Transferência concluída."); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao concluir transferência."),
  });

  const indicadores = useMemo(() => {
    const agora = dataRota === hojeYmd() ? new Date().toISOString() : undefined;
    const permanencias = linhas
      .map((t) => minutosEntre(
        eventoDe(t, "chegada_service")?.ocorrido_em,
        eventoDe(t, "saida_service")?.ocorrido_em ?? agora,
      ))
      .filter((v): v is number => v != null);
    const disponibilizadosAte7 = linhas.filter((t) => {
      const minutos = minutosDoDiaEmSaoPaulo(eventoDe(t, "chegada_service")?.ocorrido_em);
      return minutos != null && minutos <= 7 * 60;
    }).length;
    const aguardandoCarga = linhas.filter(
      (t) => eventoDe(t, "chegada_service") && !eventoDe(t, "saida_service"),
    ).length;
    const saidasApos9 = linhas.filter((t) => {
      const minutos = minutosDoDiaEmSaoPaulo(eventoDe(t, "saida_service")?.ocorrido_em);
      return minutos != null && minutos > 9 * 60;
    }).length;
    return {
      total: linhas.length,
      disponibilizadosAte7,
      aguardandoCarga,
      saidasApos9,
      mediaService: permanencias.length
        ? Math.round(permanencias.reduce((a, b) => a + b, 0) / permanencias.length)
        : 0,
      maiorEspera: permanencias.length ? Math.max(...permanencias) : 0,
    };
  }, [linhas, dataRota]);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["transferencias-painel"] });
    void qc.invalidateQueries({ queryKey: ["transferencias"] });
  }

  function selecionarTodos() {
    setSelecionados((atual) => (atual.length === linhas.length ? [] : linhas.map((t) => t.id)));
  }

  return (
    <div className="p-3 md:p-6 max-w-[1700px] mx-auto space-y-5">
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Truck className="w-8 h-8 text-primary" /> Transferências
          </h1>
          <p className="text-sm text-muted-foreground">
            Comprove quando o veículo foi disponibilizado e quanto tempo aguardou a carga no Service.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selecionados.length > 0 && (
            <>
              <Button variant="outline" onClick={() => setMarcoLote("chegada_service")}>
                Registrar chegada ({selecionados.length})
              </Button>
              <Button variant="outline" onClick={() => setMarcoLote("saida_service")}>
                Registrar saída ({selecionados.length})
              </Button>
              <Button variant="outline" onClick={() => setMarcoLote("chegada_xpt")}>
                Registrar chegada XPT ({selecionados.length})
              </Button>
              <Button variant="outline" onClick={() => setMarcoLote("saida_xpt")}>
                Registrar saída XPT ({selecionados.length})
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => refresh()} disabled={lista.isFetching}>
            <RefreshCcw className={`w-4 h-4 mr-2 ${lista.isFetching ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button onClick={() => setRascunhos((atual) => [...atual, novoRascunho(serviceBase || (service === "todos" ? services[0] : service))])} disabled={!base?.id}>
            <Plus className="w-4 h-4 mr-2" /> Nova rota
          </Button>
        </div>
      </header>

      <Card className="p-4">
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 items-end">
          <div>
            <Label>Base</Label>
            <Input value={base?.nome ?? (isAdmin ? "Todas as bases" : "—")} disabled />
          </div>
          <div>
            <Label>Service (origem)</Label>
            {serviceBase ? (
              <Input value={serviceBase} disabled className="font-semibold" />
            ) : (
              <Select value={service} onValueChange={setService}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os Services</SelectItem>
                  {services.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <Label>Data da rota</Label>
            <Input type="date" value={dataRota} onChange={(e) => setDataRota(e.target.value)} />
          </div>
          <div>
            <Label>Buscar veículo</Label>
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Motorista, placa ou código" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi titulo="Total de veículos" valor={indicadores.total} icone={Truck} />
        <Kpi titulo="Disponibilizados até 07h" valor={indicadores.disponibilizadosAte7} subtitulo={percentual(indicadores.disponibilizadosAte7, indicadores.total)} icone={CheckCircle2} tom="success" />
        <Kpi titulo="Aguardando carga" valor={indicadores.aguardandoCarga} icone={Clock3} tom="warning" />
        <Kpi titulo="Saídas após 09h (MELI)" valor={indicadores.saidasApos9} subtitulo={percentual(indicadores.saidasApos9, indicadores.total)} icone={AlertTriangle} tom="danger" />
        <Kpi titulo="Média aguardando carga" valor={duracao(indicadores.mediaService)} icone={Clock3} />
        <Kpi titulo="Maior espera por carga" valor={duracao(indicadores.maiorEspera)} icone={AlertTriangle} tom="danger" />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[2600px] text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 text-center w-12">
                  <input type="checkbox" checked={linhas.length > 0 && selecionados.length === linhas.length} onChange={selecionarTodos} />
                </th>
                <th className="p-3 text-left">Motorista</th>
                <th className="p-3 text-left">Placa</th>
                <th className="p-3 text-left">Service</th>
                <th className="p-3 text-center" colSpan={2}>Chegada Service</th>
                <th className="p-3 text-center" colSpan={2}>Saída Service</th>
                <th className="p-3 text-center">Tempo aguardando carga</th>
                <th className="p-3 text-center">Situação no Service</th>
                <th className="p-3 text-center" colSpan={2}>Chegada XPT</th>
                <th className="p-3 text-center" colSpan={2}>Saída XPT</th>
                <th className="p-3 text-center">Deslocamento</th>
                <th className="p-3 text-center">Ações</th>
              </tr>
              <tr className="text-xs text-muted-foreground border-t">
                <th />
                <th />
                <th />
                <th />
                <th className="p-2">Horário</th>
                <th className="p-2">Evidência</th>
                <th className="p-2">Horário</th>
                <th className="p-2">TimeMark</th>
                <th />
                <th />
                <th className="p-2">Horário</th>
                <th className="p-2">Evidência</th>
                <th className="p-2">Horário</th>
                <th className="p-2">Evidência</th>
                <th /><th />
              </tr>
            </thead>
            <tbody>
              {rascunhos.map((rascunho) => (
                <RascunhoRotaRow
                  key={rascunho.id}
                  rascunho={rascunho}
                  serviceFixo={serviceBase}
                  services={services}
                  salvando={criarMutation.isPending}
                  onChange={(novo) => setRascunhos((atual) => atual.map((item) => item.id === novo.id ? novo : item))}
                  onExcluir={() => setRascunhos((atual) => atual.filter((item) => item.id !== rascunho.id))}
                  onSalvar={() => criarMutation.mutate(rascunho)}
                />
              ))}
              {linhas.map((t) => {
                const chegadaService = eventoDe(t, "chegada_service");
                const saidaService = eventoDe(t, "saida_service");
                const chegadaXpt = eventoDe(t, "chegada_xpt");
                const saidaXpt = eventoDe(t, "saida_xpt");
                const permanencia = minutosEntre(
                  chegadaService?.ocorrido_em,
                  saidaService?.ocorrido_em ?? (dataRota === hojeYmd() ? new Date().toISOString() : undefined),
                );
                const deslocamento = minutosEntre(saidaService?.ocorrido_em, chegadaXpt?.ocorrido_em);
                const situacao = classificarService(chegadaService?.ocorrido_em, saidaService?.ocorrido_em);
                const evidChegada = t.evidencias.find((e) => e.etapa === "chegada_service");
                const evidSaida = t.evidencias.find((e) => e.etapa === "saida_service");
                const evidXpt = t.evidencias.find((e) => e.etapa === "chegada_xpt");
                const evidSaidaXpt = t.evidencias.find((e) => e.etapa === "saida_xpt");
                const proxima = proximaEtapa(t.eventos);
                return (
                  <Fragment key={t.id}>
                  <tr className="border-b last:border-0 hover:bg-muted/20">
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={selecionados.includes(t.id)}
                        onChange={() => setSelecionados((atual) => atual.includes(t.id) ? atual.filter((id) => id !== t.id) : [...atual, t.id])}
                      />
                    </td>
                    <td className="p-3"><b>{t.motorista}</b><div className="text-xs text-muted-foreground">{t.codigo}</div></td>
                    <td className="p-3 font-mono">{t.placa}</td>
                    <td className="p-3 font-semibold">{t.service}</td>
                    <EtapaFormCells transferencia={t} etapa="chegada_service" evento={chegadaService} evidencia={evidChegada} ativo={proxima === "chegada_service"} registrarFn={marcoFn} corrigirFn={corrigirMarcoFn} onSuccess={refresh} />
                    <EtapaFormCells transferencia={t} etapa="saida_service" evento={saidaService} evidencia={evidSaida} ativo={proxima === "saida_service"} registrarFn={marcoFn} corrigirFn={corrigirMarcoFn} onSuccess={refresh} />
                    <td className={`p-3 text-center font-semibold ${situacao.cor}`}>{permanencia != null ? duracao(permanencia) : chegadaService ? "Em aberto" : "—"}</td>
                    <td className="p-3 text-center"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${situacao.badge}`}>{situacao.label}</span></td>
                    <EtapaFormCells transferencia={t} etapa="chegada_xpt" evento={chegadaXpt} evidencia={evidXpt} ativo={proxima === "chegada_xpt"} registrarFn={marcoFn} corrigirFn={corrigirMarcoFn} onSuccess={refresh} />
                    <EtapaFormCells transferencia={t} etapa="saida_xpt" evento={saidaXpt} evidencia={evidSaidaXpt} ativo={proxima === "saida_xpt"} registrarFn={marcoFn} corrigirFn={corrigirMarcoFn} onSuccess={refresh} />
                    <td className="p-3 text-center font-semibold text-muted-foreground">{duracao(deslocamento)}</td>
                    <td className="p-3 text-center"><div className="flex justify-center gap-1">
                      <Button variant="ghost" size="icon" title="Editar rota" onClick={() => setEditando(t)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" title="Excluir rota" className="text-destructive" disabled={excluirMutation.isPending} onClick={() => excluirMutation.mutate(t.id)}><Trash2 className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" title={proxima === "saida_xpt" ? "Concluir transferência" : saidaXpt ? "Transferência concluída" : "Disponível após a chegada no XPT"} className="text-emerald-600" disabled={proxima !== "saida_xpt" || concluirMutation.isPending} onClick={() => concluirMutation.mutate(t)}><Check className="w-4 h-4" /></Button>
                    </div></td>
                  </tr>
                  {editando?.id === t.id && (
                    <EditarRotaRow
                      transferencia={editando}
                      serviceFixo={serviceBase}
                      services={services}
                      salvando={editarMutation.isPending}
                      onChange={setEditando}
                      onCancelar={() => setEditando(null)}
                      onSalvar={() => editarMutation.mutate({ transferenciaId: editando.id, service: serviceBase || editando.service, motorista: editando.motorista, placa: editando.placa, tipoVeiculo: editando.tipo_veiculo || undefined })}
                    />
                  )}
                  </Fragment>
                );
              })}
              {!lista.isLoading && linhas.length === 0 && rascunhos.length === 0 && (
                <tr><td colSpan={16} className="p-12 text-center text-muted-foreground">Nenhum veículo encontrado para os filtros selecionados.</td></tr>
              )}
              {lista.isLoading && (
                <tr><td colSpan={16} className="p-12 text-center text-muted-foreground">Carregando transferências…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t flex flex-wrap gap-6 text-xs text-muted-foreground">
          <Legenda classe="bg-emerald-500" texto="Veículo liberado pelo Service até 09h" />
          <Legenda classe="bg-amber-500" texto="Veículo no Service aguardando carga" />
          <Legenda classe="bg-red-500" texto="Saída após 09h: atraso de carregamento/liberação MELI" />
          <Legenda classe="bg-slate-400" texto="Chegada ao Service ainda não registrada" />
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Resumo da operação</h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Resumo label="Data da rota" valor={new Date(`${dataRota}T00:00:00`).toLocaleDateString("pt-BR")} />
            <Resumo label="Base" valor={base?.nome ?? "Todas as bases"} />
            <Resumo label="Veículos" valor={String(linhas.length)} />
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Observações gerais</h2>
          <p className="text-sm text-muted-foreground">O foco é documentar a disponibilização antecipada da frota JM e a espera pela carga. O deslocamento até o XPT continua registrado como dado complementar.</p>
        </Card>
      </div>

      <MarcoLoteDialog
        etapa={marcoLote}
        onOpenChange={(open) => !open && setMarcoLote(null)}
        ids={selecionados}
        registrarFn={marcoLoteFn}
        onSuccess={() => { setSelecionados([]); refresh(); }}
      />
    </div>
  );
}

function percentual(valor: number, total: number) {
  return total ? `${Math.round((valor / total) * 100)}%` : "0%";
}

function classificarService(chegadaIso?: string, saidaIso?: string) {
  if (!chegadaIso) return { label: "Aguardando chegada", cor: "text-muted-foreground", badge: "bg-muted text-muted-foreground" };
  if (!saidaIso) return { label: "Aguardando carga MELI", cor: "text-amber-600", badge: "bg-amber-100 text-amber-700" };
  const saida = minutosDoDiaEmSaoPaulo(saidaIso);
  if (saida != null && saida <= 9 * 60) return { label: "Liberado até 09h", cor: "text-emerald-600", badge: "bg-emerald-100 text-emerald-700" };
  return { label: "Saída tardia · MELI", cor: "text-red-600", badge: "bg-red-100 text-red-700" };
}

function EvidenceLink({ evidencia }: { evidencia?: TransferenciaDetalhe["evidencias"][number] }) {
  const url = evidencia?.signed_url ?? evidencia?.timemark_url;
  if (!url) return <span className="text-muted-foreground">—</span>;
  return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Ver <ExternalLink className="w-3 h-3" /></a>;
}

function Kpi({ titulo, valor, subtitulo, icone: Icon, tom = "default" }: { titulo: string; valor: string | number; subtitulo?: string; icone: typeof Truck; tom?: "default" | "success" | "warning" | "danger" }) {
  const caixa = tom === "success" ? "bg-emerald-50 text-emerald-600" : tom === "warning" ? "bg-amber-50 text-amber-600" : tom === "danger" ? "bg-red-50 text-red-600" : "bg-primary/10 text-primary";
  return <Card className="p-4"><div className="flex items-center gap-3"><div className={`p-2 rounded-lg ${caixa}`}><Icon className="w-5 h-5" /></div><div><div className="text-2xl font-bold">{valor}</div><div className="text-xs text-muted-foreground">{titulo}</div></div>{subtitulo && <b className="ml-auto text-xs">{subtitulo}</b>}</div></Card>;
}

function Legenda({ classe, texto }: { classe: string; texto: string }) {
  return <span className="flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${classe}`} />{texto}</span>;
}

function Resumo({ label, valor }: { label: string; valor: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><b>{valor}</b></div>;
}

function ServiceField({ value, serviceFixo, services, onChange }: { value: string; serviceFixo: string; services: string[]; onChange: (value: string) => void }) {
  if (serviceFixo) return <Input value={serviceFixo} disabled className="font-semibold" />;
  return <Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Service" /></SelectTrigger><SelectContent>{services.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>;
}

function RascunhoRotaRow({ rascunho, serviceFixo, services, salvando, onChange, onExcluir, onSalvar }: { rascunho: RascunhoRota; serviceFixo: string; services: string[]; salvando: boolean; onChange: (value: RascunhoRota) => void; onExcluir: () => void; onSalvar: () => void }) {
  const valido = (serviceFixo || rascunho.service).length >= 2 && rascunho.motorista.trim().length >= 2 && rascunho.placa.trim().length >= 5;
  return <tr className="border-b bg-primary/5"><td colSpan={16} className="p-3"><div className="grid gap-3 md:grid-cols-[1fr_1.4fr_1fr_1fr_auto] items-end"><div><Label>Service</Label><ServiceField value={rascunho.service} serviceFixo={serviceFixo} services={services} onChange={(value) => onChange({ ...rascunho, service: value })} /></div><div><Label>Motorista</Label><Input value={rascunho.motorista} onChange={(e) => onChange({ ...rascunho, motorista: e.target.value })} placeholder="Nome do motorista" /></div><div><Label>Placa</Label><Input value={rascunho.placa} onChange={(e) => onChange({ ...rascunho, placa: e.target.value.toUpperCase() })} placeholder="ABC1D23" /></div><div><Label>Tipo de veículo</Label><Input value={rascunho.tipoVeiculo ?? ""} onChange={(e) => onChange({ ...rascunho, tipoVeiculo: e.target.value })} placeholder="Truck, Van…" /></div><div className="flex gap-1"><Button size="icon" title="Salvar rota" disabled={!valido || salvando} onClick={onSalvar}><Save className="w-4 h-4" /></Button><Button variant="ghost" size="icon" title="Excluir linha" className="text-destructive" onClick={onExcluir}><Trash2 className="w-4 h-4" /></Button></div></div></td></tr>;
}

function EditarRotaRow({ transferencia, serviceFixo, services, salvando, onChange, onCancelar, onSalvar }: { transferencia: TransferenciaDetalhe; serviceFixo: string; services: string[]; salvando: boolean; onChange: (value: TransferenciaDetalhe) => void; onCancelar: () => void; onSalvar: () => void }) {
  const valido = (serviceFixo || transferencia.service).length >= 2 && transferencia.motorista.trim().length >= 2 && transferencia.placa.trim().length >= 5;
  return <tr className="border-b bg-amber-50/60"><td colSpan={16} className="p-3"><div className="grid gap-3 md:grid-cols-[1fr_1.4fr_1fr_1fr_auto] items-end"><div><Label>Service</Label><ServiceField value={transferencia.service} serviceFixo={serviceFixo} services={services} onChange={(value) => onChange({ ...transferencia, service: value })} /></div><div><Label>Motorista</Label><Input value={transferencia.motorista} onChange={(e) => onChange({ ...transferencia, motorista: e.target.value })} /></div><div><Label>Placa</Label><Input value={transferencia.placa} onChange={(e) => onChange({ ...transferencia, placa: e.target.value.toUpperCase() })} /></div><div><Label>Tipo de veículo</Label><Input value={transferencia.tipo_veiculo ?? ""} onChange={(e) => onChange({ ...transferencia, tipo_veiculo: e.target.value })} /></div><div className="flex gap-1"><Button size="icon" title="Salvar alterações" disabled={!valido || salvando} onClick={onSalvar}><Save className="w-4 h-4" /></Button><Button variant="ghost" size="icon" title="Cancelar edição" onClick={onCancelar}><X className="w-4 h-4" /></Button></div></div></td></tr>;
}

function MarcoLoteDialog({ etapa, onOpenChange, ids, registrarFn, onSuccess }: { etapa: TransferenciaEtapa | null; onOpenChange: (open: boolean) => void; ids: string[]; registrarFn: ReturnType<typeof useServerFn<typeof registrarMarcosTransferenciaLote>>; onSuccess: () => void }) {
  const [horario, setHorario] = useState(() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); });
  const [localizacao, setLocalizacao] = useState("");
  const mutation = useMutation({
    mutationFn: () => registrarFn({ data: { transferenciaIds: ids, etapa: etapa!, ocorridoEm: new Date(horario).toISOString(), localizacaoTexto: localizacao, responsabilidade: etapa === "saida_service" && new Date(horario).getHours() >= 9 ? "MELI" : undefined, motivoCodigo: etapa === "saida_service" && new Date(horario).getHours() >= 9 ? "ATRASO_CARREGAMENTO" : undefined } }),
    onSuccess: (resultado) => { toast.success(`${resultado.sucessos} marco(s) registrado(s).`); if (resultado.falhas) toast.warning(`${resultado.falhas} registro(s) falharam.`); onOpenChange(false); onSuccess(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao registrar marcos."),
  });
  const titulo = etapa === "chegada_service"
    ? "Chegada no Service em lote"
    : etapa === "saida_service"
      ? "Saída do Service em lote"
      : etapa === "chegada_xpt"
        ? "Chegada no XPT em lote"
        : "Saída do XPT em lote";
  return <Dialog open={!!etapa} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{titulo}</DialogTitle><DialogDescription>O mesmo horário será aplicado aos {ids.length} veículos selecionados. As evidências poderão ser anexadas depois.</DialogDescription></DialogHeader><div className="space-y-3"><div><Label>Data e horário reais</Label><Input type="datetime-local" value={horario} onChange={(e) => setHorario(e.target.value)} /></div><div><Label>Localização</Label><Input value={localizacao} onChange={(e) => setLocalizacao(e.target.value)} placeholder="Ex.: SP17" /></div>{etapa === "saida_service" && new Date(horario).getHours() >= 9 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">Saída após 09:00: responsabilidade atribuída automaticamente ao Mercado Livre por atraso no carregamento/liberação.</div>}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={!localizacao.trim() || !ids.length || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Registrando…" : "Registrar em lote"}</Button></DialogFooter></DialogContent></Dialog>;
}

function EtapaFormCells({ transferencia, etapa, evento, evidencia, ativo, registrarFn, corrigirFn, onSuccess }: { transferencia: TransferenciaDetalhe; etapa: TransferenciaEtapa; evento?: TransferenciaDetalhe["eventos"][number]; evidencia?: TransferenciaDetalhe["evidencias"][number]; ativo: boolean; registrarFn: ReturnType<typeof useServerFn<typeof registrarMarcoTransferencia>>; corrigirFn: ReturnType<typeof useServerFn<typeof corrigirMarcoTransferencia>>; onSuccess: () => void }) {
  const [horario, setHorario] = useState(() => dataHoraLocal(evento?.ocorrido_em));
  const [localizacao, setLocalizacao] = useState(evento?.localizacao_texto ?? "");
  const [foto, setFoto] = useState<File | null>(null);
  const [timemark, setTimemark] = useState(evidencia?.timemark_url ?? "");
  const [fotoKey, setFotoKey] = useState(0);
  const [editandoEtapa, setEditandoEtapa] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!ativo || evento) throw new Error("Esta etapa ainda não está disponível.");
      let storagePath: string | undefined;
      if (foto) {
        if (foto.size > 10 * 1024 * 1024) throw new Error("A foto deve ter no máximo 10 MB.");
        storagePath = caminhoEvidenciaTransferencia(transferencia.base_id, transferencia.id, etapa, foto.name);
        const { error } = await supabase.storage.from("transferencias-evidencias").upload(storagePath, foto, { upsert: false, contentType: foto.type });
        if (error) throw new Error(error.message);
      }
      try {
        return await registrarFn({ data: { transferenciaId: transferencia.id, etapa, ocorridoEm: new Date(horario).toISOString(), storagePath, timemarkUrl: timemark || undefined, horarioEvidencia: foto || timemark ? new Date(horario).toISOString() : undefined, localizacaoTexto: localizacao || undefined } });
      } catch (error) {
        if (storagePath) await supabase.storage.from("transferencias-evidencias").remove([storagePath]);
        throw error;
      }
    },
    onSuccess: () => { toast.success("Etapa registrada."); setFoto(null); setFotoKey((key) => key + 1); setTimemark(""); onSuccess(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao registrar etapa."),
  });
  const corrigirMutation = useMutation({
    mutationFn: async () => {
      let storagePath: string | undefined;
      if (foto) {
        if (foto.size > 10 * 1024 * 1024) throw new Error("A foto deve ter no máximo 10 MB.");
        storagePath = caminhoEvidenciaTransferencia(transferencia.base_id, transferencia.id, etapa, foto.name);
        const { error } = await supabase.storage
          .from("transferencias-evidencias")
          .upload(storagePath, foto, { upsert: false, contentType: foto.type });
        if (error) throw new Error(error.message);
      }
      try {
        return await corrigirFn({
          data: {
            transferenciaId: transferencia.id,
            etapa,
            ocorridoEm: new Date(horario).toISOString(),
            localizacaoTexto: localizacao || undefined,
            storagePath,
            timemarkUrl: timemark,
            horarioEvidencia: foto || timemark ? new Date(horario).toISOString() : undefined,
          },
        });
      } catch (error) {
        if (storagePath) await supabase.storage.from("transferencias-evidencias").remove([storagePath]);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Etapa corrigida.");
      setEditandoEtapa(false);
      setFoto(null);
      setFotoKey((key) => key + 1);
      onSuccess();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao corrigir a etapa."),
  });
  const bloqueado = evento ? !editandoEtapa : !ativo;
  const mensagem = evento ? editandoEtapa ? "Corrija os campos necessários e salve" : "Etapa registrada" : ativo ? "Preencha e salve" : "Aguardando etapa anterior";
  const cancelarEdicao = () => {
    setHorario(dataHoraLocal(evento?.ocorrido_em));
    setLocalizacao(evento?.localizacao_texto ?? "");
    setTimemark(evidencia?.timemark_url ?? "");
    setFoto(null);
    setFotoKey((key) => key + 1);
    setEditandoEtapa(false);
  };
  return <Fragment><td className={`p-2 align-top min-w-[190px] ${ativo || editandoEtapa ? "bg-sky-50/60" : ""}`}><div className="space-y-2"><Input aria-label={`Horário ${etapa}`} type="datetime-local" value={horario} disabled={bloqueado} onChange={(e) => setHorario(e.target.value)} className="h-8 text-xs" /><Input aria-label={`Localização ${etapa}`} value={localizacao} disabled={bloqueado} onChange={(e) => setLocalizacao(e.target.value)} placeholder="Localização" className="h-8 text-xs" />{evento && !editandoEtapa && <Button variant="outline" size="sm" className="w-full h-8" onClick={() => { setHorario(dataHoraLocal(evento.ocorrido_em)); setLocalizacao(evento.localizacao_texto ?? ""); setTimemark(evidencia?.timemark_url ?? ""); setEditandoEtapa(true); }}><Pencil className="w-3 h-3 mr-1" />Editar etapa</Button>}{evento && editandoEtapa && <div className="flex gap-1"><Button size="sm" className="flex-1 h-8" disabled={corrigirMutation.isPending} onClick={() => corrigirMutation.mutate()}><Save className="w-3 h-3 mr-1" />{corrigirMutation.isPending ? "Salvando…" : "Salvar correção"}</Button><Button variant="ghost" size="icon" className="h-8 w-8" title="Cancelar correção" onClick={cancelarEdicao}><X className="w-3 h-3" /></Button></div>}<div className="text-[11px] text-muted-foreground">{mensagem}</div></div></td><td className={`p-2 align-top min-w-[230px] ${ativo || editandoEtapa ? "bg-sky-50/60" : ""}`}><div className="space-y-2"><Input aria-label={`Link ${etapa}`} type="url" value={timemark} disabled={evento ? !editandoEtapa : !ativo} onChange={(e) => setTimemark(e.target.value)} placeholder="Link TimeMark ou evidência" className="h-8 text-xs" /><Input key={fotoKey} aria-label={`Foto ${etapa}`} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={evento ? !editandoEtapa : !ativo} onChange={(e) => setFoto(e.target.files?.[0] ?? null)} className="h-8 text-xs file:text-xs" />{evento ? <EvidenceLink evidencia={evidencia} /> : <Button size="sm" className="w-full h-8" disabled={!ativo || mutation.isPending} onClick={() => mutation.mutate()}><Save className="w-3 h-3 mr-1" />{mutation.isPending ? "Salvando…" : "Salvar etapa"}</Button>}</div></td></Fragment>;
}
