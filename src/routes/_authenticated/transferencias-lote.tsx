import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ClipboardPaste, Truck, UsersRound } from "lucide-react";
import { RequireBaseOperacional } from "@/components/base-operacional-selector";
import { useBaseOperacional } from "@/lib/base-operacional-context";
import { listarTransferencias, proximaEtapa } from "@/lib/transferencias.functions";
import {
  criarTransferenciasLote,
  registrarMarcosTransferenciaLote,
  type LinhaCadastroTransferencia,
  type ResultadoLote,
} from "@/lib/transferencias-lote.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/transferencias-lote")({
  head: () => ({ meta: [{ title: "Transferências em lote — JM Transportes" }] }),
  component: Guard,
});

function Guard() {
  return (
    <RequireBaseOperacional
      titulo="Transferências em lote"
      descricao="Selecione a Base e o Dia para cadastrar veículos e registrar marcos coletivos."
    >
      <Page />
    </RequireBaseOperacional>
  );
}

function agoraLocalInput() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseLinhas(texto: string): LinhaCadastroTransferencia[] {
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      const partes = linha.split(/\t|;|,/).map((v) => v.trim());
      return {
        service: partes[0] ?? "",
        motorista: partes[1] ?? "",
        placa: (partes[2] ?? "").toUpperCase(),
        tipoVeiculo: partes[3] || undefined,
      };
    });
}

function Page() {
  const { base, diaOperacional } = useBaseOperacional();
  const listarFn = useServerFn(listarTransferencias);
  const criarLoteFn = useServerFn(criarTransferenciasLote);
  const marcoLoteFn = useServerFn(registrarMarcosTransferenciaLote);
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [etapa, setEtapa] = useState<"chegada_service" | "saida_service">("chegada_service");
  const [ocorridoEm, setOcorridoEm] = useState(agoraLocalInput());
  const [localizacao, setLocalizacao] = useState("");
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);

  const lista = useQuery({
    queryKey: ["transferencias-lote", base?.id, diaOperacional],
    queryFn: () =>
      listarFn({
        data: {
          inicio: diaOperacional!,
          fim: diaOperacional!,
          baseId: base!.id,
        },
      }),
    enabled: !!base && !!diaOperacional,
  });

  const linhas = useMemo(() => parseLinhas(texto), [texto]);
  const elegiveis = useMemo(
    () =>
      (lista.data ?? []).filter(
        (t) => t.status !== "cancelada" && proximaEtapa(t.eventos) === etapa,
      ),
    [lista.data, etapa],
  );

  const criar = useMutation({
    mutationFn: () =>
      criarLoteFn({
        data: {
          baseId: base!.id,
          dataOperacional: diaOperacional!,
          linhas,
        },
      }),
    onSuccess: (res) => {
      setResultado(res);
      toast.success(`${res.sucessos} transferência(s) criada(s).`);
      void qc.invalidateQueries({ queryKey: ["transferencias"] });
      void qc.invalidateQueries({ queryKey: ["transferencias-lote"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar lote."),
  });

  const registrar = useMutation({
    mutationFn: () =>
      marcoLoteFn({
        data: {
          transferenciaIds: selecionados,
          etapa,
          ocorridoEm: new Date(ocorridoEm).toISOString(),
          localizacaoTexto: localizacao,
          ...(etapa === "saida_service" && new Date(ocorridoEm).getHours() >= 9
            ? {
                responsabilidade: "MELI" as const,
                motivoCodigo: "ATRASO_CARREGAMENTO",
                observacao: "Saída do Service após 09:00; responsabilidade MELI aplicada automaticamente.",
              }
            : {}),
        },
      }),
    onSuccess: (res) => {
      setResultado(res);
      setSelecionados([]);
      toast.success(`${res.sucessos} marco(s) registrado(s).`);
      void qc.invalidateQueries({ queryKey: ["transferencias"] });
      void qc.invalidateQueries({ queryKey: ["transferencias-lote"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao registrar lote."),
  });

  function toggle(id: string) {
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
  }

  return (
    <div className="p-3 md:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <UsersRound className="w-7 h-7 text-primary" /> Transferências em lote
        </h1>
        <p className="text-sm text-muted-foreground">
          Cadastro por colagem do Excel e registro coletivo de chegada ou saída do Service.
        </p>
      </div>

      <Tabs defaultValue="cadastro">
        <TabsList>
          <TabsTrigger value="cadastro">Cadastrar veículos</TabsTrigger>
          <TabsTrigger value="marcos">Registrar marcos</TabsTrigger>
        </TabsList>

        <TabsContent value="cadastro" className="mt-4">
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2 font-semibold">
              <ClipboardPaste className="w-5 h-5" /> Colar dados do Excel
            </div>
            <p className="text-sm text-muted-foreground">
              Copie quatro colunas nesta ordem: Service, Motorista, Placa e Tipo de veículo. São aceitos tabulação, ponto e vírgula ou vírgula.
            </p>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={10}
              placeholder={"SSP34\tMarcos\tCUB8378\tTruck\nSSP34\tJoão\tABC1D23\tCarreta"}
              className="font-mono"
            />
            <div className="text-sm">
              <b>{linhas.length}</b> linha(s) identificada(s).
            </div>
            <Button
              onClick={() => criar.mutate()}
              disabled={criar.isPending || linhas.length === 0 || linhas.some((l) => !l.service || !l.motorista || l.placa.length < 5)}
            >
              {criar.isPending ? "Criando…" : `Criar ${linhas.length} transferência(s)`}
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="marcos" className="mt-4 space-y-4">
          <Card className="p-4 space-y-4">
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <Label>Etapa</Label>
                <div className="flex gap-2 mt-2">
                  <Button
                    type="button"
                    variant={etapa === "chegada_service" ? "default" : "outline"}
                    onClick={() => { setEtapa("chegada_service"); setSelecionados([]); }}
                  >
                    Chegada no Service
                  </Button>
                  <Button
                    type="button"
                    variant={etapa === "saida_service" ? "default" : "outline"}
                    onClick={() => { setEtapa("saida_service"); setSelecionados([]); }}
                  >
                    Saída do Service
                  </Button>
                </div>
              </div>
              <div>
                <Label>Data e horário comuns</Label>
                <Input type="datetime-local" value={ocorridoEm} onChange={(e) => setOcorridoEm(e.target.value)} />
              </div>
              <div>
                <Label>Localização</Label>
                <Input value={localizacao} onChange={(e) => setLocalizacao(e.target.value)} placeholder="Service / portaria" />
              </div>
            </div>

            {etapa === "saida_service" && new Date(ocorridoEm).getHours() >= 9 && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                Saída após 09:00: o sistema registrará automaticamente responsabilidade <b>Mercado Livre</b> e motivo <b>Atraso no carregamento</b>.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setSelecionados(elegiveis.map((t) => t.id))}>
                Selecionar todos ({elegiveis.length})
              </Button>
              <Button variant="ghost" onClick={() => setSelecionados([])}>Limpar seleção</Button>
            </div>

            <div className="border rounded divide-y max-h-[420px] overflow-auto">
              {elegiveis.map((t) => (
                <label key={t.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/40">
                  <input type="checkbox" checked={selecionados.includes(t.id)} onChange={() => toggle(t.id)} />
                  <Truck className="w-4 h-4 text-primary" />
                  <span className="font-mono text-sm">{t.placa}</span>
                  <span className="text-sm flex-1">{t.motorista}</span>
                  <span className="text-xs text-muted-foreground">{t.service}</span>
                </label>
              ))}
              {!lista.isLoading && elegiveis.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum veículo disponível para esta etapa.
                </div>
              )}
            </div>

            <Button
              onClick={() => registrar.mutate()}
              disabled={registrar.isPending || selecionados.length === 0 || localizacao.trim().length < 2}
            >
              {registrar.isPending ? "Registrando…" : `Registrar ${selecionados.length} veículo(s)`}
            </Button>
          </Card>
        </TabsContent>
      </Tabs>

      {resultado && (
        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">Resultado da última operação</h2>
          <p className="text-sm">{resultado.sucessos} sucesso(s) · {resultado.falhas} falha(s)</p>
          <div className="max-h-52 overflow-auto text-xs font-mono space-y-1">
            {resultado.detalhes.map((d, i) => (
              <div key={`${d.referencia}-${i}`} className={d.ok ? "text-foreground" : "text-destructive"}>
                {d.ok ? "OK" : "ERRO"} · {d.referencia} · {d.mensagem}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
