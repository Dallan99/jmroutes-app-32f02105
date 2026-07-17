import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { gerencialData, rotasPorBase, transferenciasGerencial, type OperadorProd, type RotaBaseRow, type TransferenciasGerencialData } from "@/lib/gerencial.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Line, LineChart, Legend,
} from "recharts";
import { Activity, AlertTriangle, Award, CheckCircle2, Clock, MapPin, PackageCheck, TrendingDown, TrendingUp, Truck, Tv, Users, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/gerencial")({
  head: () => ({ meta: [{ title: "Dashboard Gerencial — JM Transportes" }] }),
  component: GerencialPage,
});

type Periodo = "hoje" | "7d" | "30d";

function GerencialPage() {
  const [periodo, setPeriodo] = useState<Periodo>("7d");
  const fn = useServerFn(gerencialData);
  const transferenciasFn = useServerFn(transferenciasGerencial);
  const q = useQuery({
    queryKey: ["gerencial", periodo],
    queryFn: () => fn({ data: { periodo } }),
    refetchInterval: 30_000,
  });
  const d = q.data;
  const transferenciasQuery = useQuery({
    queryKey: ["gerencial-transferencias", periodo],
    queryFn: () => transferenciasFn({ data: { periodo } }),
    refetchInterval: 30_000,
  });

  const fmtTempo = (ms: number | null) => (ms ? `${(ms / 1000).toFixed(1)}s` : "—");
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Dashboard Gerencial</h1>
          <p className="text-sm text-muted-foreground">
            Produtividade por operador, comparativos e ranking de desempenho.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/tv/gerencial">
            <Button size="sm">
              <Tv className="w-4 h-4 mr-2" /> Modo TV
            </Button>
          </Link>
          <div className="inline-flex rounded-md border border-border bg-card p-1">
          {(["hoje", "7d", "30d"] as Periodo[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className={`px-3 py-1.5 text-sm rounded ${
                periodo === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "hoje" ? "Hoje" : p === "7d" ? "7 dias" : "30 dias"}
            </button>
          ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
        <Kpi label="Total leituras" value={d?.totais.total_leituras ?? "—"} icon={Activity} />
        <Kpi label="Sucesso" value={d?.totais.ok ?? "—"} icon={PackageCheck} accent="success" />
        <Kpi label="Erros/Divergências" value={d?.totais.erros ?? "—"} icon={AlertTriangle} accent="destructive" />
        <Kpi label="Operadores ativos" value={d?.totais.operadores_ativos ?? "—"} icon={Users} accent="info" />
        <Kpi label="Tempo médio/leitura" value={fmtTempo(d?.totais.tempo_medio_ms ?? null)} icon={Clock} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award className="w-4 h-4 text-success" />
            <h2 className="text-sm font-semibold">Top 3 — mais produtivos</h2>
          </div>
          <RankingLista rows={d?.top3 ?? []} tipo="top" />
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-warning" />
            <h2 className="text-sm font-semibold">Bottom 3 — atenção necessária</h2>
          </div>
          <RankingLista rows={d?.bottom3 ?? []} tipo="bottom" />
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">Evolução diária</h2>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={d?.porDia ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="ok" name="Sucesso" stroke="var(--success)" strokeWidth={2} />
              <Line type="monotone" dataKey="erros" name="Erros" stroke="var(--destructive)" strokeWidth={2} />
              <Line type="monotone" dataKey="total" name="Total" stroke="var(--brand-navy)" strokeWidth={2} strokeDasharray="4 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Comparativo Hoje × 7 dias × 30 dias (Top 10)</h2>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={d?.comparativo ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="operador" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="hoje" name="Hoje" fill="var(--brand-yellow)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="semana" name="7 dias" fill="var(--brand-navy)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="mes" name="30 dias" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">Produtividade por operador — {periodo === "hoje" ? "hoje" : periodo === "7d" ? "últimos 7 dias" : "últimos 30 dias"}</h2>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Operador</th>
                <th className="py-2 pr-3 text-right">Leituras</th>
                <th className="py-2 pr-3 text-right">Sucesso</th>
                <th className="py-2 pr-3 text-right">Erros</th>
                <th className="py-2 pr-3 text-right">Rotas</th>
                <th className="py-2 pr-3 text-right">Taxa acerto</th>
                <th className="py-2 pr-3 text-right">Tempo médio</th>
              </tr>
            </thead>
            <tbody>
              {(d?.porOperador ?? []).map((op, i) => (
                <tr key={op.operador_id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 pr-3 font-medium">{op.nome}</td>
                  <td className="py-2 pr-3 text-right font-mono">{op.total_leituras}</td>
                  <td className="py-2 pr-3 text-right font-mono text-success">{op.ok}</td>
                  <td className="py-2 pr-3 text-right font-mono text-destructive">{op.erros}</td>
                  <td className="py-2 pr-3 text-right font-mono">{op.rotas_atendidas}</td>
                  <td className="py-2 pr-3 text-right">
                    <Badge variant={op.taxa_acerto >= 95 ? "default" : op.taxa_acerto >= 85 ? "secondary" : "destructive"}>
                      {fmtPct(op.taxa_acerto)}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{fmtTempo(op.tempo_medio_ms)}</td>
                </tr>
              ))}
              {!q.isLoading && (d?.porOperador?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    Sem leituras no período selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {q.isLoading && <p className="text-center text-sm text-muted-foreground">Carregando…</p>}
      {q.error && (
        <Card className="p-4 border-destructive">
          <p className="text-sm text-destructive">Erro ao carregar dados: {(q.error as Error).message}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => q.refetch()}>Tentar novamente</Button>
        </Card>
      )}

      <TransferenciasSection
        data={transferenciasQuery.data}
        loading={transferenciasQuery.isLoading}
        error={transferenciasQuery.error}
        onRetry={() => transferenciasQuery.refetch()}
      />

      <RotasPorBaseSection />
    </div>
  );
}
function todayYMD() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function RotasPorBaseSection() {
  const [dia, setDia] = useState<string>(todayYMD());
  const [diaTocado, setDiaTocado] = useState(false);
  const [baseId, setBaseId] = useState<string>("todas");
  const fn = useServerFn(rotasPorBase);
  const q = useQuery({
    queryKey: ["rotas-por-base", dia, baseId],
    queryFn: () => fn({ data: { data: diaTocado ? dia : undefined, baseId: baseId === "todas" ? undefined : baseId } }),
    refetchInterval: 30_000,
  });
  const d = q.data;

  // Sincroniza o input de data com o dia efetivo retornado pelo backend
  // (quando o usuário ainda não escolheu manualmente).
  useEffect(() => {
    if (d?.data && !diaTocado && d.data !== dia) setDia(d.data);
  }, [d?.data, dia, diaTocado]);

  const rotasFiltradas: RotaBaseRow[] = d?.rotas ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl md:text-2xl font-bold flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" /> Rotas por Base
          </h2>
          <p className="text-sm text-muted-foreground">
            Rotas criadas no dia, com % de conclusão e pacotes faltando.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dia}
            onChange={(e) => {
              setDiaTocado(true);
              setDia(e.target.value || todayYMD());
            }}
            className="w-[160px]"
          />
          <Select value={baseId} onValueChange={setBaseId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Todas as bases" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as bases</SelectItem>
              {(d?.bases ?? []).map((b) => (
                <SelectItem key={b.base_id} value={b.base_id}>
                  {b.nome} ({b.codigo})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {(d?.bases ?? []).filter((b) => baseId === "todas" || b.base_id === baseId).map((b) => (
          <Card key={b.base_id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-display font-bold">{b.nome}</div>
                <div className="text-xs text-muted-foreground font-mono">{b.codigo}</div>
              </div>
              <Badge variant={b.pct >= 100 ? "default" : b.pct >= 80 ? "secondary" : "destructive"}>
                {b.pct.toFixed(0)}%
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <div className="font-display text-lg font-bold">{b.total_rotas}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Rotas</div>
              </div>
              <div>
                <div className="font-display text-lg font-bold text-success">{b.rotas_completas}</div>
                <div className="text-[10px] text-muted-foreground uppercase">100%</div>
              </div>
              <div>
                <div className="font-display text-lg font-bold text-warning">{b.faltando}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Faltando</div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground flex justify-between">
              <span>Recebidos: <b className="text-success">{b.recebidos}</b>/{b.total_pacotes}</span>
              <span>Devolvidos: <b className="text-warning">{b.devolvidos}</b></span>
            </div>
          </Card>
        ))}
        {!q.isLoading && (d?.bases?.length ?? 0) === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground md:col-span-3">
            Nenhuma base com escala ativa nessa data.
          </Card>
        )}
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">
          Detalhe por rota — {new Date(dia + "T00:00:00").toLocaleDateString("pt-BR")}
        </h3>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">Base</th>
                <th className="py-2 pr-3">Rota</th>
                <th className="py-2 pr-3 text-right">Previsto</th>
                <th className="py-2 pr-3 text-right">Recebido</th>
                <th className="py-2 pr-3 text-right">Devolvido</th>
                <th className="py-2 pr-3 text-right">Faltando</th>
                <th className="py-2 pr-3 text-right">% Conclusão</th>
                <th className="py-2 pr-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {rotasFiltradas.map((r) => (
                <tr key={`${r.base_id}-${r.nro_rota}`} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{r.base_nome}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{r.base_codigo}</div>
                  </td>
                  <td className="py-2 pr-3 font-mono">{r.nro_rota}</td>
                  <td className="py-2 pr-3 text-right font-mono">{r.total}</td>
                  <td className="py-2 pr-3 text-right font-mono text-success">{r.recebido}</td>
                  <td className="py-2 pr-3 text-right font-mono text-warning">{r.devolvido}</td>
                  <td className="py-2 pr-3 text-right font-mono text-destructive">{r.faltando}</td>
                  <td className="py-2 pr-3 text-right">
                    <Badge variant={r.pct >= 100 ? "default" : r.pct >= 80 ? "secondary" : "destructive"}>
                      {r.pct.toFixed(0)}%
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-center">
                    {r.status === "completa" ? (
                      <span className="inline-flex items-center gap-1 text-success text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Completa
                      </span>
                    ) : r.status === "parcial" ? (
                      <span className="inline-flex items-center gap-1 text-warning text-xs">
                        <AlertTriangle className="w-3.5 h-3.5" /> Parcial
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                        <XCircle className="w-3.5 h-3.5" /> Sem leitura
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!q.isLoading && rotasFiltradas.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    Sem rotas para essa data/base.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {q.error && (
          <p className="text-sm text-destructive mt-2">Erro: {(q.error as Error).message}</p>
        )}
      </Card>
    </div>
  );
}

function TransferenciasSection({
  data,
  loading,
  error,
  onRetry,
}: {
  data?: TransferenciasGerencialData;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const minutos = (valor: number | null) => (valor === null ? "—" : `${valor} min`);
  const responsabilidade = (valor: string) =>
    ({
      JM_FROTA: "JM / Frota",
      MELI: "Mercado Livre",
      EXTERNO: "Fator externo",
      EM_ANALISE: "Em análise",
    })[valor] ?? valor;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-xl md:text-2xl font-bold flex items-center gap-2">
          <Truck className="w-5 h-5 text-primary" /> Transferências Service → XPT
        </h2>
        <p className="text-sm text-muted-foreground">
          Evidências de disponibilização da frota JM e do tempo aguardando carregamento/liberação no Service.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Veículos" value={data?.totais.total ?? "—"} icon={Truck} />
        <Kpi
          label="Disponíveis até 07h"
          value={data?.totais.disponibilizados_ate_7 ?? "—"}
          icon={CheckCircle2}
          accent="success"
        />
        <Kpi
          label="Aguardando carga"
          value={data?.totais.aguardando_carga ?? "—"}
          icon={Clock}
          accent="warning"
        />
        <Kpi
          label="Saídas após 09h (MELI)"
          value={data?.totais.saidas_apos_9 ?? "—"}
          icon={AlertTriangle}
          accent="destructive"
        />
        <Kpi
          label="Média aguardando carga"
          value={minutos(data?.totais.media_service_min ?? null)}
          icon={Clock}
          accent="warning"
        />
        <Kpi
          label="Maior espera por carga"
          value={minutos(data?.totais.maior_service_min ?? null)}
          icon={AlertTriangle}
          accent="destructive"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold">Desempenho por base</h3>
            <div className="text-xs text-muted-foreground">
              Deslocamento (complementar): <b>{minutos(data?.totais.media_deslocamento_min ?? null)}</b>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3">Base</th>
                  <th className="py-2 pr-3 text-right">Veículos</th>
                  <th className="py-2 pr-3 text-right">Até 07h</th>
                  <th className="py-2 pr-3 text-right">Aguardando carga</th>
                  <th className="py-2 pr-3 text-right">Saídas após 09h</th>
                  <th className="py-2 pr-3 text-right">Média espera</th>
                  <th className="py-2 text-right">Média trajeto</th>
                </tr>
              </thead>
              <tbody>
                {(data?.porBase ?? []).map((base) => (
                  <tr key={base.base_id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 pr-3">
                      <b>{base.base_nome}</b>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {base.base_codigo}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{base.total}</td>
                    <td className="py-2 pr-3 text-right font-mono text-success">{base.disponibilizados_ate_7}</td>
                    <td className="py-2 pr-3 text-right font-mono text-warning">{base.aguardando_carga}</td>
                    <td className="py-2 pr-3 text-right font-mono text-destructive">
                      {base.saidas_apos_9}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{minutos(base.media_service_min)}</td>
                    <td className="py-2 text-right font-mono">
                      {minutos(base.media_deslocamento_min)}
                    </td>
                  </tr>
                ))}
                {!loading && (data?.porBase.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      Sem transferências no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Maiores esperas por carregamento</h3>
          <ol className="space-y-2">
            {(data?.rankingMotoristas ?? []).slice(0, 5).map((item, index) => (
              <li
                key={item.motorista}
                className="flex items-center justify-between gap-3 rounded bg-muted/30 p-2"
              >
                <div className="min-w-0">
                  <b className="truncate block">
                    {index + 1}. {item.motorista}
                  </b>
                  <span className="text-xs text-muted-foreground">
                    {item.viagens_atrasadas} espera(s) registrada(s)
                  </span>
                </div>
                <span className="font-mono text-sm text-destructive">
                  {item.minutos_atraso} min
                </span>
              </li>
            ))}
            {!loading && (data?.rankingMotoristas.length ?? 0) === 0 && (
              <li className="text-sm text-muted-foreground">Nenhum tempo de espera completo registrado.</li>
            )}
          </ol>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Principais motivos e responsabilidades</h3>
        <div className="grid md:grid-cols-2 gap-2">
          {(data?.motivos ?? []).map((item) => (
            <div
              key={`${item.responsabilidade}-${item.motivo}`}
              className="flex items-center justify-between gap-3 rounded border border-border p-3"
            >
              <div>
                <b className="text-sm">{item.motivo}</b>
                <div className="text-xs text-muted-foreground">
                  {responsabilidade(item.responsabilidade)} · {item.ocorrencias} ocorrência(s)
                </div>
              </div>
              <span className="font-mono text-sm text-destructive">{item.minutos_atraso} min</span>
            </div>
          ))}
          {!loading && (data?.motivos.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma ocorrência de atraso registrada.
            </p>
          )}
        </div>
      </Card>

      {loading && (
        <p className="text-center text-sm text-muted-foreground">
          Carregando indicadores de transferências…
        </p>
      )}
      {error && (
        <Card className="p-4 border-destructive">
          <p className="text-sm text-destructive">
            Erro ao carregar transferências: {error.message}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            Tentar novamente
          </Button>
        </Card>
      )}
    </section>
  );
}

function RankingLista({ rows, tipo }: { rows: OperadorProd[]; tipo: "top" | "bottom" }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Sem dados no período.</p>;
  return (
    <ol className="space-y-2">
      {rows.map((op, i) => (
        <li key={op.operador_id} className="flex items-center justify-between gap-3 p-2 rounded bg-muted/30">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-sm ${
              tipo === "top"
                ? i === 0 ? "bg-[var(--brand-yellow)] text-[var(--brand-navy)]" : "bg-muted text-foreground"
                : "bg-warning/20 text-warning"
            }`}>{i + 1}</div>
            <div className="min-w-0">
              <div className="font-medium truncate">{op.nome}</div>
              <div className="text-xs text-muted-foreground">{op.rotas_atendidas} rota(s) · {op.taxa_acerto.toFixed(0)}% acerto</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-display font-bold text-lg">{op.total_leituras}</div>
            <div className="text-[10px] text-muted-foreground uppercase">leituras</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Kpi({
  label, value, icon: Icon, accent,
}: {
  label: string; value: string | number;
  icon: typeof Activity;
  accent?: "success" | "warning" | "destructive" | "info";
}) {
  const ring =
    accent === "success" ? "text-success"
    : accent === "warning" ? "text-warning"
    : accent === "destructive" ? "text-destructive"
    : accent === "info" ? "text-[var(--info)]"
    : "text-primary";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${ring}`} />
      </div>
      <div className="font-display text-2xl md:text-3xl font-bold">{value}</div>
    </Card>
  );
}
