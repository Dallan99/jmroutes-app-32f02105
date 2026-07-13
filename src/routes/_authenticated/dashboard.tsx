import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardData, dashboardFiltrosOpcoes, type DashboardFilters } from "@/lib/dashboard.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Line, LineChart, Pie, PieChart, Cell, Legend,
} from "recharts";
import {
  Activity, AlertOctagon, AlertTriangle, CheckCircle2, Clock, Filter, Gauge,
  Package, PackageCheck, PackageSearch, RefreshCcw, Timer, TrendingUp, Truck, Tv, UserCog,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — JM Transportes" }] }),
  component: DashboardPage,
});

const NONE = "__all";
const PIE_COLORS = ["var(--brand-navy)", "var(--brand-yellow)", "var(--info)", "var(--warning)"];

function fmtDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function DashboardPage() {
  const qc = useQueryClient();
  const fetchOpcoes = useServerFn(dashboardFiltrosOpcoes);
  const fetchDados = useServerFn(dashboardData);

  const [filters, setFilters] = useState<DashboardFilters>({
    date: null, base_id: null, operador_id: null, motorista_id: null, transportadora: null, turno: null,
  });
  const cleanFilters = useMemo(() => {
    const c: DashboardFilters = {};
    for (const [k, v] of Object.entries(filters)) if (v) (c as any)[k] = v;
    return c;
  }, [filters]);

  const opcoesQuery = useQuery({
    queryKey: ["dashboard-opcoes"],
    queryFn: () => fetchOpcoes(),
    staleTime: 5 * 60_000,
  });
  const dadosQuery = useQuery({
    queryKey: ["dashboard", cleanFilters],
    queryFn: () => fetchDados({ data: cleanFilters }),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel("dashboard-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "recebimentos" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "rotas" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const d = dadosQuery.data;
  const op = opcoesQuery.data;

  function setF<K extends keyof DashboardFilters>(k: K, v: DashboardFilters[K]) {
    setFilters((prev) => ({ ...prev, [k]: v }));
  }
  function clearAll() {
    setFilters({ date: null, base_id: null, operador_id: null, motorista_id: null, transportadora: null, turno: null });
  }

  const activeFiltersCount = Object.values(cleanFilters).filter(Boolean).length;

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
            Dashboard Operacional
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> ao vivo
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {filters.date ? `Dia ${new Date(filters.date + "T00:00:00").toLocaleDateString("pt-BR")}` : "Últimas 24 horas"}
            {" · "}atualizado {dadosQuery.dataUpdatedAt ? new Date(dadosQuery.dataUpdatedAt).toLocaleTimeString("pt-BR") : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/tv/dashboard">
            <Button variant="default" size="sm">
              <Tv className="w-4 h-4 mr-2" /> Modo TV
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["dashboard"] })}>
            <RefreshCcw className="w-4 h-4 mr-2" /> Atualizar
          </Button>
        </div>
      </header>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Filter className="w-4 h-4" /> Filtros
            {activeFiltersCount > 0 && <Badge variant="secondary">{activeFiltersCount}</Badge>}
          </div>
          {activeFiltersCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>Limpar</Button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Data</Label>
            <Input type="date" value={filters.date ?? ""} onChange={(e) => setF("date", e.target.value || null)} />
          </div>
          <FilterSelect label="Base" value={filters.base_id} onChange={(v) => setF("base_id", v)}
            options={(op?.bases ?? []).map((b) => ({ value: b.id, label: `${b.codigo} — ${b.nome}` }))} />
          <FilterSelect label="Operador" value={filters.operador_id} onChange={(v) => setF("operador_id", v)}
            options={(op?.operadores ?? []).map((o) => ({ value: o.id, label: o.nome }))} />
          <FilterSelect label="Motorista" value={filters.motorista_id} onChange={(v) => setF("motorista_id", v)}
            options={(op?.motoristas ?? []).map((m) => ({ value: m.id, label: m.nome }))} />
          <FilterSelect label="Transportadora" value={filters.transportadora} onChange={(v) => setF("transportadora", v)}
            options={(op?.transportadoras ?? []).map((t) => ({ value: t, label: t }))} />
          <FilterSelect label="Turno" value={filters.turno ?? null} onChange={(v) => setF("turno", v as any)}
            options={[
              { value: "madrugada", label: "Madrugada (00-06)" },
              { value: "manha", label: "Manhã (06-12)" },
              { value: "tarde", label: "Tarde (12-18)" },
              { value: "noite", label: "Noite (18-24)" },
            ]} />
        </div>
      </Card>

      {/* KPIs — Rotas */}
      <SectionLabel>Rotas</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Previstas" value={d?.rotasPrevistas ?? "—"} icon={Truck} />
        <Kpi label="Recebidas" value={d?.rotasRecebidas ?? "—"} icon={PackageCheck} accent="info" />
        <Kpi label="Em triagem" value={d?.rotasEmTriagem ?? "—"} icon={Activity} accent="warning" />
        <Kpi label="Finalizadas" value={d?.rotasFinalizadas ?? "—"} icon={CheckCircle2} accent="success" />
      </div>

      {/* KPIs — Volumes */}
      <SectionLabel>Volumes</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Previstos" value={d?.volumesPrevistos ?? "—"} icon={Package} />
        <Kpi label="Bipados" value={d?.volumesBipados ?? "—"} icon={PackageCheck} accent="success" />
        <Kpi label="Pendentes" value={d?.volumesPendentes ?? "—"} icon={PackageSearch} accent="warning" />
        <Kpi label="Eficiência" value={d ? `${d.eficiencia}%` : "—"} icon={Gauge} accent={d && d.eficiencia >= 90 ? "success" : d && d.eficiencia >= 60 ? "info" : "warning"} />
      </div>

      {/* KPIs — Performance */}
      <SectionLabel>Performance & alertas</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Prod. por hora" value={d ? `${d.produtividadeHora}/h` : "—"} icon={TrendingUp} accent="info" />
        <Kpi label="Tempo médio/rota" value={fmtDuration(d?.tempoMedioRotaMs)} icon={Timer} />
        <Kpi label="Tempo médio/operador" value={fmtDuration(d?.tempoMedioOperadorMs)} icon={UserCog} />
        <Kpi label="Alertas" value={d?.alertas ?? "—"} icon={AlertOctagon} accent={d && d.alertas > 0 ? "destructive" : "success"} />
      </div>

      {/* Gráficos */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3">Bipagens por hora</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={d?.porHora ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hora" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Line type="monotone" dataKey="total" stroke="var(--brand-navy)" strokeWidth={2} dot={{ fill: "var(--brand-yellow)", r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Status das rotas</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={d?.porStatus ?? []} dataKey="total" nameKey="status" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {(d?.porStatus ?? []).map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Bipagens por operador</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={d?.porOperador ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="operador" tick={{ fontSize: 11 }} width={120} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Bar dataKey="total" fill="var(--brand-navy)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3">Bipagens por base</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={d?.porBase ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="base" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Bar dataKey="total" fill="var(--brand-yellow)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Ocorrências */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" /> Últimas ocorrências
          </h2>
          <span className="text-xs text-muted-foreground">{d?.ocorrencias?.length ?? 0} exibidas</span>
        </div>
        {(!d?.ocorrencias || d.ocorrencias.length === 0) ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Nenhuma ocorrência no período.</div>
        ) : (
          <ScrollArea className="h-56">
            <ul className="divide-y">
              {d.ocorrencias.map((o) => (
                <li key={o.id} className="py-2 flex items-start gap-3 text-sm">
                  <Badge variant="outline" className="uppercase text-[10px] mt-0.5">{o.tipo.replace(/_/g, " ")}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{o.mensagem ?? "—"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(o.created_at).toLocaleString("pt-BR")} {o.operador ? `· ${o.operador}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </Card>

      <div className="text-[10px] text-muted-foreground flex items-center gap-2 justify-end">
        <Clock className="w-3 h-3" /> atualização automática a cada 10s + realtime
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mt-2">
      {children}
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Todos</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Kpi({
  label, value, icon: Icon, accent,
}: {
  label: string;
  value: string | number;
  icon: typeof Truck;
  accent?: "success" | "warning" | "destructive" | "info";
}) {
  const ring =
    accent === "success" ? "text-success"
    : accent === "warning" ? "text-warning"
    : accent === "destructive" ? "text-destructive"
    : accent === "info" ? "text-[var(--info)]"
    : "text-primary";
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${ring}`} />
      </div>
      <div className="font-display text-2xl md:text-3xl font-bold">{value}</div>
    </Card>
  );
}