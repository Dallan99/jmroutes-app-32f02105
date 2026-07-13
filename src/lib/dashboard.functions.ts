import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type Turno = "madrugada" | "manha" | "tarde" | "noite";

export type DashboardFilters = {
  date?: string | null;         // YYYY-MM-DD (data_expedicao das rotas / dia dos recebimentos)
  base_id?: string | null;
  operador_id?: string | null;
  motorista_id?: string | null;
  transportadora?: string | null;
  turno?: Turno | null;
};

const filtersSchema = z.object({
  date: z.string().optional().nullable(),
  base_id: z.string().uuid().optional().nullable(),
  operador_id: z.string().uuid().optional().nullable(),
  motorista_id: z.string().uuid().optional().nullable(),
  transportadora: z.string().optional().nullable(),
  turno: z.enum(["madrugada", "manha", "tarde", "noite"]).optional().nullable(),
}).partial();

function turnoDeHora(h: number): Turno {
  if (h < 6) return "madrugada";
  if (h < 12) return "manha";
  if (h < 18) return "tarde";
  return "noite";
}

export type DashboardData = {
  // Rotas
  rotasPrevistas: number;
  rotasRecebidas: number;
  rotasEmTriagem: number;
  rotasFinalizadas: number;
  // Volumes
  volumesPrevistos: number;
  volumesBipados: number;
  volumesPendentes: number;
  // Performance
  produtividadeHora: number;        // bipagens/hora (média nas horas ativas)
  tempoMedioRotaMs: number | null;  // tempo médio p/ finalizar rota
  tempoMedioOperadorMs: number | null; // tempo médio entre bipagens do operador
  eficiencia: number;               // % volumes bipados / previstos
  alertas: number;                  // eventos de divergência
  ocorrencias: Array<{ id: string; created_at: string; tipo: string; mensagem: string | null; operador: string | null }>;
  // Séries para gráficos
  porHora: { hora: string; total: number }[];
  porOperador: { operador: string; total: number }[];
  porBase: { base: string; total: number }[];
  porStatus: { status: string; total: number }[]; // pizza
};

export const dashboardData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filtersSchema.parse(d ?? {}))
  .handler(async ({ context, data }): Promise<DashboardData> => {
    const { supabase } = context;
    const filters = data as DashboardFilters;

    // Janela temporal: dia escolhido (00:00 → 24:00) ou últimas 24h
    let fromIso: string;
    let toIso: string;
    if (filters.date) {
      const start = new Date(`${filters.date}T00:00:00`);
      const end = new Date(start.getTime() + 24 * 3600 * 1000);
      fromIso = start.toISOString();
      toIso = end.toISOString();
    } else {
      toIso = new Date().toISOString();
      fromIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    }

    // ── Rotas
    let rotasQ = supabase
      .from("rotas")
      .select("id, status, quantidade_prevista, base_id, motorista_id, transportadora, data_expedicao, created_at, updated_at, bases!rotas_base_id_fkey(codigo,nome)");
    if (filters.base_id) rotasQ = rotasQ.eq("base_id", filters.base_id);
    if (filters.motorista_id) rotasQ = rotasQ.eq("motorista_id", filters.motorista_id);
    if (filters.transportadora) rotasQ = rotasQ.eq("transportadora", filters.transportadora);
    if (filters.date) rotasQ = rotasQ.eq("data_expedicao", filters.date);
    const { data: rotas } = await rotasQ;

    const rotaIds = (rotas ?? []).map((r: any) => r.id);

    // ── Volumes das rotas filtradas
    const { data: volumes } = rotaIds.length
      ? await supabase.from("volumes").select("recebido, rota_id").in("rota_id", rotaIds)
      : { data: [] as { recebido: boolean; rota_id: string }[] };

    // ── Recebimentos (janela temporal + filtros)
    let recQ = supabase
      .from("recebimentos")
      .select("id, created_at, resultado, tempo_desde_ultima_ms, operador_id, base_id, rota_id, mensagem, bases(codigo)")
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (filters.base_id) recQ = recQ.eq("base_id", filters.base_id);
    if (filters.operador_id) recQ = recQ.eq("operador_id", filters.operador_id);
    if (rotaIds.length && (filters.motorista_id || filters.transportadora || filters.date)) {
      recQ = recQ.in("rota_id", rotaIds);
    }
    const { data: recebimentos } = await recQ;

    const operadorIds = Array.from(new Set((recebimentos ?? []).map((r) => r.operador_id).filter(Boolean)));
    const { data: profs } = operadorIds.length
      ? await supabase.from("profiles").select("id, nome").in("id", operadorIds)
      : { data: [] as { id: string; nome: string }[] };
    const nomePorId = new Map((profs ?? []).map((p) => [p.id, p.nome] as const));

    type RotaRow = {
      id: string;
      status: string;
      quantidade_prevista: number;
      created_at: string;
      updated_at: string;
      bases: { codigo: string; nome: string } | null;
    };
    type RecRow = {
      id: string;
      created_at: string;
      resultado: string;
      tempo_desde_ultima_ms: number | null;
      operador_id: string;
      rota_id: string | null;
      mensagem: string | null;
      bases: { codigo: string } | null;
    };

    const rotasArr = (rotas ?? []) as unknown as RotaRow[];
    let recArr = (recebimentos ?? []) as unknown as RecRow[];

    // Filtro de turno (aplicado localmente sobre o horário do recebimento)
    if (filters.turno) {
      recArr = recArr.filter((r) => turnoDeHora(new Date(r.created_at).getHours()) === filters.turno);
    }

    // KPIs de rotas
    const rotasPrevistas = rotasArr.length;
    const rotasFinalizadas = rotasArr.filter((r) => r.status === "recebida_completa").length;
    const rotasEmTriagem = rotasArr.filter((r) => r.status === "em_recebimento").length;
    const rotasRecebidas = rotasArr.filter((r) =>
      ["em_recebimento", "recebida_parcial", "recebida_completa"].includes(r.status),
    ).length;

    // KPIs de volumes
    const volumesPrevistos = rotasArr.reduce((a, r) => a + (r.quantidade_prevista || 0), 0);
    const volumesBipados = (volumes ?? []).filter((v: any) => v.recebido).length;
    const volumesPendentes = Math.max(volumesPrevistos - volumesBipados, 0);
    const eficiencia = volumesPrevistos > 0 ? Math.round((volumesBipados / volumesPrevistos) * 1000) / 10 : 0;

    // Divergências / alertas / ocorrências
    const divergenciaTipos = new Set([
      "duplicado", "inexistente", "outra_rota", "outra_base",
      "volume_repetido", "cancelada", "encerrada",
    ]);
    const divergencias = recArr.filter((r) => divergenciaTipos.has(r.resultado));
    const alertas = divergencias.length;
    const ocorrencias = divergencias.slice(0, 20).map((d) => ({
      id: d.id,
      created_at: d.created_at,
      tipo: d.resultado,
      mensagem: d.mensagem,
      operador: nomePorId.get(d.operador_id) ?? null,
    }));

    // Tempo médio por operador (entre bipagens)
    const temposOp = recArr
      .map((r) => r.tempo_desde_ultima_ms)
      .filter((t): t is number => typeof t === "number" && t > 0 && t < 60_000);
    const tempoMedioOperadorMs = temposOp.length
      ? Math.round(temposOp.reduce((a, b) => a + b, 0) / temposOp.length)
      : null;

    // Tempo médio por rota (created_at → updated_at das rotas finalizadas)
    const temposRota = rotasArr
      .filter((r) => r.status === "recebida_completa" && r.created_at && r.updated_at)
      .map((r) => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime())
      .filter((t) => t > 0 && t < 48 * 3600 * 1000);
    const tempoMedioRotaMs = temposRota.length
      ? Math.round(temposRota.reduce((a, b) => a + b, 0) / temposRota.length)
      : null;

    // Séries
    const porOperadorMap = new Map<string, number>();
    for (const r of recArr) {
      const nome = nomePorId.get(r.operador_id) ?? "—";
      porOperadorMap.set(nome, (porOperadorMap.get(nome) ?? 0) + 1);
    }
    const porOperador = [...porOperadorMap.entries()]
      .map(([operador, total]) => ({ operador, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const porBaseMap = new Map<string, number>();
    for (const r of recArr) {
      const b = r.bases?.codigo ?? "—";
      porBaseMap.set(b, (porBaseMap.get(b) ?? 0) + 1);
    }
    const porBase = [...porBaseMap.entries()]
      .map(([base, total]) => ({ base, total }))
      .sort((a, b) => b.total - a.total);

    const porHoraMap = new Map<string, number>();
    for (const r of recArr) {
      const h = new Date(r.created_at).toLocaleString("pt-BR", { hour: "2-digit" });
      porHoraMap.set(h, (porHoraMap.get(h) ?? 0) + 1);
    }
    const porHora = [...porHoraMap.entries()]
      .map(([hora, total]) => ({ hora, total }))
      .sort((a, b) => a.hora.localeCompare(b.hora));

    // Produtividade média por hora (bipagens/hora, considerando horas com atividade)
    const horasAtivas = porHora.length || 1;
    const totalBipagens = recArr.length;
    const produtividadeHora = Math.round(totalBipagens / horasAtivas);

    const porStatusMap = new Map<string, number>([
      ["Aguardando", 0],
      ["Em triagem", 0],
      ["Parcial", 0],
      ["Finalizada", 0],
    ]);
    for (const r of rotasArr) {
      if (r.status === "recebida_completa") porStatusMap.set("Finalizada", (porStatusMap.get("Finalizada") ?? 0) + 1);
      else if (r.status === "recebida_parcial") porStatusMap.set("Parcial", (porStatusMap.get("Parcial") ?? 0) + 1);
      else if (r.status === "em_recebimento") porStatusMap.set("Em triagem", (porStatusMap.get("Em triagem") ?? 0) + 1);
      else porStatusMap.set("Aguardando", (porStatusMap.get("Aguardando") ?? 0) + 1);
    }
    const porStatus = [...porStatusMap.entries()].map(([status, total]) => ({ status, total }));

    return {
      rotasPrevistas,
      rotasRecebidas,
      rotasEmTriagem,
      rotasFinalizadas,
      volumesPrevistos,
      volumesBipados,
      volumesPendentes,
      produtividadeHora,
      tempoMedioRotaMs,
      tempoMedioOperadorMs,
      eficiencia,
      alertas,
      ocorrencias,
      porHora,
      porOperador,
      porBase,
      porStatus,
    };
  });

// ─── Filtros: opções para a UI
export type DashboardFiltrosOpcoes = {
  bases: { id: string; codigo: string; nome: string }[];
  operadores: { id: string; nome: string }[];
  motoristas: { id: string; nome: string; transportadora: string | null }[];
  transportadoras: string[];
};

export const dashboardFiltrosOpcoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardFiltrosOpcoes> => {
    const { supabase } = context;
    const [b, o, m] = await Promise.all([
      supabase.from("bases").select("id, codigo, nome").eq("ativa", true).order("codigo"),
      supabase.from("profiles").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("motoristas").select("id, nome, transportadora").eq("ativo", true).order("nome"),
    ]);
    const transportadoras = Array.from(
      new Set((m.data ?? []).map((x: any) => x.transportadora).filter(Boolean)),
    ).sort() as string[];
    return {
      bases: (b.data ?? []) as any,
      operadores: (o.data ?? []) as any,
      motoristas: (m.data ?? []) as any,
      transportadoras,
    };
  });