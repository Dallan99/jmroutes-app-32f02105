import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const inputSchema = z.object({
  periodo: z.enum(["hoje", "7d", "30d"]).default("7d"),
});

export type OperadorProd = {
  operador_id: string;
  nome: string;
  total_leituras: number;
  ok: number;
  erros: number;
  rotas_atendidas: number;
  tempo_medio_ms: number | null;
  taxa_acerto: number;
};

export type GerencialData = {
  periodo: "hoje" | "7d" | "30d";
  totais: {
    total_leituras: number;
    ok: number;
    erros: number;
    operadores_ativos: number;
    tempo_medio_ms: number | null;
  };
  porOperador: OperadorProd[];
  top3: OperadorProd[];
  bottom3: OperadorProd[];
  porDia: { dia: string; total: number; ok: number; erros: number }[];
  comparativo: { operador: string; hoje: number; semana: number; mes: number }[];
};

export type RotaBaseRow = {
  base_id: string;
  base_codigo: string;
  base_nome: string;
  nro_rota: string;
  total: number;
  recebido: number;
  devolvido: number;
  faltando: number;
  pct: number;
  status: "completa" | "parcial" | "vazia";
};

export type RotasPorBaseData = {
  data: string;
  bases: {
    base_id: string;
    codigo: string;
    nome: string;
    total_rotas: number;
    rotas_completas: number;
    rotas_parciais: number;
    total_pacotes: number;
    recebidos: number;
    devolvidos: number;
    faltando: number;
    pct: number;
  }[];
  rotas: RotaBaseRow[];
};

function inicioPeriodo(p: "hoje" | "7d" | "30d") {
  const now = new Date();
  if (p === "hoje") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const dias = p === "7d" ? 7 : 30;
  return new Date(now.getTime() - dias * 24 * 3600 * 1000);
}

export const gerencialData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GerencialData> => {
    const { supabase } = context;
    const desde = inicioPeriodo(data.periodo);

    const inicioHoje = inicioPeriodo("hoje");
    const inicioSemana = inicioPeriodo("7d");
    const inicioMes = inicioPeriodo("30d");

    const { data: recebimentos, error } = await supabase
      .from("recebimentos")
      .select("created_at, resultado, tempo_desde_ultima_ms, operador_id, rota_id")
      .gte("created_at", inicioMes.toISOString())
      .order("created_at", { ascending: false })
      .limit(20000);
    if (error) throw new Error(error.message);

    type Rec = {
      created_at: string;
      resultado: string;
      tempo_desde_ultima_ms: number | null;
      operador_id: string | null;
      rota_id: string | null;
    };
    const all = (recebimentos ?? []) as Rec[];
    const periodoRows = all.filter((r) => new Date(r.created_at) >= desde);

    const operadorIds = Array.from(
      new Set(all.map((r) => r.operador_id).filter(Boolean)),
    ) as string[];
    const { data: profs } = operadorIds.length
      ? await supabase.from("profiles").select("id, nome, email").in("id", operadorIds)
      : { data: [] as { id: string; nome: string; email: string }[] };
    const perfilMap = new Map((profs ?? []).map((p) => [p.id, p.nome ?? p.email ?? "—"] as const));

    const OK = new Set(["ok", "primeira_leitura", "concluiu_rota"]);

    // Agrupamento por operador no período
    const grupos = new Map<string, Rec[]>();
    for (const r of periodoRows) {
      if (!r.operador_id) continue;
      const arr = grupos.get(r.operador_id) ?? [];
      arr.push(r);
      grupos.set(r.operador_id, arr);
    }

    const porOperador: OperadorProd[] = Array.from(grupos.entries()).map(([id, arr]) => {
      const ok = arr.filter((r) => OK.has(r.resultado)).length;
      const total = arr.length;
      const erros = total - ok;
      const rotas = new Set(arr.map((r) => r.rota_id).filter(Boolean)).size;
      const tempos = arr.map((r) => r.tempo_desde_ultima_ms).filter((v): v is number => typeof v === "number" && v > 0 && v < 300000);
      const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
      return {
        operador_id: id,
        nome: perfilMap.get(id) ?? "—",
        total_leituras: total,
        ok,
        erros,
        rotas_atendidas: rotas,
        tempo_medio_ms: tempoMedio,
        taxa_acerto: total ? (ok / total) * 100 : 0,
      };
    });
    porOperador.sort((a, b) => b.total_leituras - a.total_leituras);

    const totais = {
      total_leituras: periodoRows.length,
      ok: periodoRows.filter((r) => OK.has(r.resultado)).length,
      erros: periodoRows.filter((r) => !OK.has(r.resultado)).length,
      operadores_ativos: porOperador.length,
      tempo_medio_ms: (() => {
        const t = periodoRows.map((r) => r.tempo_desde_ultima_ms).filter((v): v is number => typeof v === "number" && v > 0 && v < 300000);
        return t.length ? t.reduce((a, b) => a + b, 0) / t.length : null;
      })(),
    };

    // Série por dia
    const porDiaMap = new Map<string, { total: number; ok: number; erros: number }>();
    for (const r of periodoRows) {
      const dia = r.created_at.slice(0, 10);
      const cur = porDiaMap.get(dia) ?? { total: 0, ok: 0, erros: 0 };
      cur.total++;
      if (OK.has(r.resultado)) cur.ok++;
      else cur.erros++;
      porDiaMap.set(dia, cur);
    }
    const porDia = Array.from(porDiaMap.entries())
      .map(([dia, v]) => ({ dia, ...v }))
      .sort((a, b) => a.dia.localeCompare(b.dia));

    // Comparativo hoje / semana / mês por operador (top 10)
    const contar = (rows: Rec[], id: string) => rows.filter((r) => r.operador_id === id).length;
    const rowsHoje = all.filter((r) => new Date(r.created_at) >= inicioHoje);
    const rowsSem = all.filter((r) => new Date(r.created_at) >= inicioSemana);
    const rowsMes = all;
    const comparativo = porOperador.slice(0, 10).map((op) => ({
      operador: op.nome,
      hoje: contar(rowsHoje, op.operador_id),
      semana: contar(rowsSem, op.operador_id),
      mes: contar(rowsMes, op.operador_id),
    }));

    return {
      periodo: data.periodo,
      totais,
      porOperador,
      top3: porOperador.slice(0, 3),
      bottom3: [...porOperador].filter((o) => o.total_leituras > 0).sort((a, b) => a.total_leituras - b.total_leituras).slice(0, 3),
      porDia,
      comparativo,
    };
  });

const rotasInputSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  baseId: z.string().uuid().optional(),
});

function hojeYMD(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

export const rotasPorBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rotasInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<RotasPorBaseData> => {
    const { supabase, userId } = context;
    let dia = data.data ?? hojeYMD();

    // Bases permitidas ao usuário (RLS já filtra, mas garantimos ordenação/uso)
    const { data: bases, error: eb } = await supabase
      .from("bases")
      .select("id, codigo, nome")
      .order("nome");
    if (eb) throw new Error(eb.message);
    const allowedBases = (bases ?? []).filter((b) => !data.baseId || b.id === data.baseId);
    const baseMap = new Map(allowedBases.map((b) => [b.id, b] as const));

    if (allowedBases.length === 0) {
      return { data: dia, bases: [], rotas: [] };
    }

    // Importações ativas no dia para essas bases
    let { data: imports, error: ei } = await supabase
      .from("importacoes_escala")
      .select("id, base_id")
      .eq("data_operacional", dia)
      .eq("ativa", true)
      .in("base_id", allowedBases.map((b) => b.id));
    if (ei) throw new Error(ei.message);

    // Sem importação para o dia solicitado — usa o dia mais recente com dados.
    if (!data.data && (imports ?? []).length === 0) {
      const { data: recente } = await supabase
        .from("importacoes_escala")
        .select("data_operacional")
        .eq("ativa", true)
        .in("base_id", allowedBases.map((b) => b.id))
        .order("data_operacional", { ascending: false })
        .limit(1);
      const nova = recente?.[0]?.data_operacional as string | undefined;
      if (nova && nova !== dia) {
        dia = nova;
        const r2 = await supabase
          .from("importacoes_escala")
          .select("id, base_id")
          .eq("data_operacional", dia)
          .eq("ativa", true)
          .in("base_id", allowedBases.map((b) => b.id));
        imports = r2.data ?? [];
      }
    }

    const importIds = (imports ?? []).map((i) => i.id);
    const importBaseMap = new Map((imports ?? []).map((i) => [i.id, i.base_id] as const));

    let escalas: { nro_rota: string | null; recebido: boolean | null; devolvido: boolean | null; importacao_id: string | null; base_operacional_id: string | null }[] = [];
    if (importIds.length > 0) {
      const { data: es, error: ee } = await supabase
        .from("escalas")
        .select("nro_rota, recebido, devolvido, importacao_id, base_operacional_id")
        .in("importacao_id", importIds)
        .limit(50000);
      if (ee) throw new Error(ee.message);
      escalas = es ?? [];
    }

    // Agrupamento por base+rota
    const grupos = new Map<string, RotaBaseRow>();
    for (const e of escalas) {
      const baseId = importBaseMap.get(e.importacao_id ?? "") ?? e.base_operacional_id;
      if (!baseId) continue;
      const b = baseMap.get(baseId);
      if (!b) continue;
      const rota = (e.nro_rota ?? "").trim() || "—";
      const key = `${baseId}::${rota}`;
      const cur = grupos.get(key) ?? {
        base_id: baseId,
        base_codigo: b.codigo,
        base_nome: b.nome,
        nro_rota: rota,
        total: 0,
        recebido: 0,
        devolvido: 0,
        faltando: 0,
        pct: 0,
        status: "vazia" as const,
      };
      cur.total++;
      if (e.recebido) cur.recebido++;
      if (e.devolvido) cur.devolvido++;
      grupos.set(key, cur);
    }

    const rotas: RotaBaseRow[] = Array.from(grupos.values()).map((r) => {
      const processados = r.recebido + r.devolvido;
      const faltando = Math.max(0, r.total - processados);
      const pct = r.total ? (r.recebido / r.total) * 100 : 0;
      const status: RotaBaseRow["status"] =
        processados === 0 ? "vazia" : r.recebido >= r.total ? "completa" : "parcial";
      return { ...r, faltando, pct, status };
    });
    rotas.sort((a, b) =>
      a.base_nome.localeCompare(b.base_nome) || a.nro_rota.localeCompare(b.nro_rota, "pt-BR", { numeric: true }),
    );

    const resumoBases = allowedBases.map((b) => {
      const rs = rotas.filter((r) => r.base_id === b.id);
      const total_pacotes = rs.reduce((s, r) => s + r.total, 0);
      const recebidos = rs.reduce((s, r) => s + r.recebido, 0);
      const devolvidos = rs.reduce((s, r) => s + r.devolvido, 0);
      const faltando = rs.reduce((s, r) => s + r.faltando, 0);
      return {
        base_id: b.id,
        codigo: b.codigo,
        nome: b.nome,
        total_rotas: rs.length,
        rotas_completas: rs.filter((r) => r.status === "completa").length,
        rotas_parciais: rs.filter((r) => r.status === "parcial").length,
        total_pacotes,
        recebidos,
        devolvidos,
        faltando,
        pct: total_pacotes ? (recebidos / total_pacotes) * 100 : 0,
      };
    });

    // Silence unused var
    void userId;

    return { data: dia, bases: resumoBases, rotas };
  });
