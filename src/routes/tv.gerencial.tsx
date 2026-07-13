import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { gerencialData, type OperadorProd } from "@/lib/gerencial.functions";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Line, LineChart, Legend,
} from "recharts";
import { Activity, Award, Clock, PackageCheck, AlertTriangle, Users, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/tv/gerencial")({
  head: () => ({ meta: [{ title: "TV — Gerencial" }] }),
  component: TvGerencial,
});

type Periodo = "hoje" | "7d" | "30d";

function TvGerencial() {
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const fn = useServerFn(gerencialData);
  const q = useQuery({
    queryKey: ["tv-gerencial", periodo],
    queryFn: () => fn({ data: { periodo } }),
    refetchInterval: 15_000,
  });
  const d = q.data;
  const now = new Date().toLocaleTimeString("pt-BR");
  const fmtTempo = (ms: number | null) => (ms ? `${(ms / 1000).toFixed(1)}s` : "—");

  return (
    <div className="p-6 xl:p-10 space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-4xl xl:text-5xl font-black tracking-tight">Painel Gerencial</h1>
          <p className="text-white/60 mt-1">
            {periodo === "hoje" ? "Hoje" : periodo === "7d" ? "Últimos 7 dias" : "Últimos 30 dias"} · atualizado {q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString("pt-BR") : now}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-white/15 bg-white/5 p-1">
            {(["hoje", "7d", "30d"] as Periodo[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-3 py-1.5 text-sm rounded font-medium ${
                  periodo === p ? "bg-[var(--brand-yellow)] text-[var(--brand-navy)]" : "text-white/70 hover:text-white"
                }`}
              >
                {p === "hoje" ? "Hoje" : p === "7d" ? "7 dias" : "30 dias"}
              </button>
            ))}
          </div>
          <div className="font-display text-3xl xl:text-4xl font-bold tabular-nums text-[var(--brand-yellow)]">{now}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <TvKpi label="Leituras" value={d?.totais.total_leituras ?? "—"} icon={Activity} />
        <TvKpi label="Sucesso" value={d?.totais.ok ?? "—"} icon={PackageCheck} tone="success" />
        <TvKpi label="Erros" value={d?.totais.erros ?? "—"} icon={AlertTriangle} tone="danger" />
        <TvKpi label="Operadores" value={d?.totais.operadores_ativos ?? "—"} icon={Users} tone="info" />
        <TvKpi label="T. médio" value={fmtTempo(d?.totais.tempo_medio_ms ?? null)} icon={Clock} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <TvCard title="Top 3 mais produtivos" icon={<Award className="w-5 h-5 text-emerald-400" />}>
          <Ranking rows={d?.top3 ?? []} tone="top" />
        </TvCard>
        <TvCard title="Bottom 3 — atenção" icon={<TrendingDown className="w-5 h-5 text-amber-300" />}>
          <Ranking rows={d?.bottom3 ?? []} tone="bottom" />
        </TvCard>
      </div>

      <TvCard title="Evolução diária">
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={d?.porDia ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="dia" tick={{ fontSize: 13, fill: "rgba(255,255,255,0.7)" }} />
              <YAxis tick={{ fontSize: 13, fill: "rgba(255,255,255,0.7)" }} />
              <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.15)", color: "#fff" }} />
              <Legend wrapperStyle={{ color: "#fff", fontSize: 13 }} />
              <Line type="monotone" dataKey="ok" name="Sucesso" stroke="#34d399" strokeWidth={3} />
              <Line type="monotone" dataKey="erros" name="Erros" stroke="#fb7185" strokeWidth={3} />
              <Line type="monotone" dataKey="total" name="Total" stroke="var(--brand-yellow)" strokeWidth={2} strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </TvCard>

      <TvCard title="Comparativo Top 10 — hoje / 7d / 30d">
        <div className="h-80">
          <ResponsiveContainer>
            <BarChart data={d?.comparativo ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="operador" tick={{ fontSize: 11, fill: "rgba(255,255,255,0.7)" }} interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis tick={{ fontSize: 12, fill: "rgba(255,255,255,0.7)" }} />
              <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.15)", color: "#fff" }} />
              <Legend wrapperStyle={{ color: "#fff", fontSize: 13 }} />
              <Bar dataKey="hoje" name="Hoje" fill="var(--brand-yellow)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="semana" name="7 dias" fill="#60a5fa" radius={[4, 4, 0, 0]} />
              <Bar dataKey="mes" name="30 dias" fill="rgba(255,255,255,0.4)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </TvCard>
    </div>
  );
}

function Ranking({ rows, tone }: { rows: OperadorProd[]; tone: "top" | "bottom" }) {
  if (rows.length === 0) return <p className="text-white/50 text-sm">Sem dados no período.</p>;
  return (
    <ol className="space-y-3">
      {rows.map((op, i) => (
        <li key={op.operador_id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-black/25">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-full grid place-items-center font-black text-lg ${
              tone === "top"
                ? i === 0 ? "bg-[var(--brand-yellow)] text-[var(--brand-navy)]" : "bg-white/10 text-white"
                : "bg-amber-500/20 text-amber-300"
            }`}>{i + 1}</div>
            <div className="min-w-0">
              <div className="font-semibold text-lg truncate">{op.nome}</div>
              <div className="text-xs text-white/60">{op.rotas_atendidas} rota(s) · {op.taxa_acerto.toFixed(0)}% acerto</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-display font-black text-3xl tabular-nums text-[var(--brand-yellow)]">{op.total_leituras}</div>
            <div className="text-[10px] text-white/50 uppercase tracking-wider">leituras</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TvKpi({
  label, value, icon: Icon, tone,
}: {
  label: string; value: string | number;
  icon: typeof Activity;
  tone?: "success" | "warning" | "danger" | "info";
}) {
  const color =
    tone === "success" ? "text-emerald-400"
    : tone === "warning" ? "text-amber-300"
    : tone === "danger" ? "text-rose-400"
    : tone === "info" ? "text-sky-300"
    : "text-[var(--brand-yellow)]";
  return (
    <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-5 xl:p-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-widest text-white/60 font-semibold">{label}</span>
        <Icon className={`w-6 h-6 ${color}`} />
      </div>
      <div className={`font-display text-4xl xl:text-5xl font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function TvCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-5">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-sm uppercase tracking-widest text-white/70 font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}