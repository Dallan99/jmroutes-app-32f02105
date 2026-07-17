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

export type TransferenciasGerencialData = {
  periodo: "hoje" | "7d" | "30d";
  totais: {
    total: number;
    disponibilizados_ate_7: number;
    aguardando_carga: number;
    saidas_apos_9: number;
    taxa_disponibilizacao: number;
    media_service_min: number | null;
    maior_service_min: number | null;
    media_deslocamento_min: number | null;
  };
  porBase: {
    base_id: string;
    base_codigo: string;
    base_nome: string;
    total: number;
    disponibilizados_ate_7: number;
    aguardando_carga: number;
    saidas_apos_9: number;
    media_service_min: number | null;
    media_deslocamento_min: number | null;
  }[];
  rankingMotoristas: {
    motorista: string;
    viagens_atrasadas: number;
    minutos_atraso: number;
  }[];
  motivos: {
    motivo: string;
    responsabilidade: string;
    ocorrencias: number;
    minutos_atraso: number;
  }[];
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
export const transferenciasGerencial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<TransferenciasGerencialData> => {
    const { supabase } = context;
    const desde = inicioPeriodo(data.periodo).toISOString().slice(0, 10);

    const { data: transferencias, error } = await supabase
      .from("transferencias")
      .select("id, base_id, motorista, status")
      .gte("data_operacional", desde)
      .order("data_operacional", { ascending: false })
      .limit(20000);
    if (error) throw new Error(error.message);

    type TransferenciaRow = {
      id: string;
      base_id: string;
      motorista: string;
      status: string;
    };
    type EventoRow = {
      transferencia_id: string;
      etapa: "chegada_service" | "saida_service" | "chegada_xpt" | "saida_xpt";
      ocorrido_em: string;
    };
    type OcorrenciaRow = {
      transferencia_id: string;
      motivo_id: string | null;
      responsabilidade: string;
      minutos_atraso: number;
    };

    const rows = ((transferencias ?? []) as TransferenciaRow[]).filter(
      (t) => t.status !== "cancelada",
    );
    if (!rows.length) {
      return {
        periodo: data.periodo,
        totais: {
          total: 0,
          disponibilizados_ate_7: 0,
          aguardando_carga: 0,
          saidas_apos_9: 0,
          taxa_disponibilizacao: 0,
          media_service_min: null,
          maior_service_min: null,
          media_deslocamento_min: null,
        },
        porBase: [],
        rankingMotoristas: [],
        motivos: [],
      };
    }

    const ids = rows.map((t) => t.id);
    const eventos: EventoRow[] = [];
    const ocorrencias: OcorrenciaRow[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200);
      const [eventosRes, ocorrenciasRes] = await Promise.all([
        supabase
          .from("transferencia_eventos")
          .select("transferencia_id, etapa, ocorrido_em")
          .in("transferencia_id", lote),
        supabase
          .from("transferencia_ocorrencias")
          .select("transferencia_id, motivo_id, responsabilidade, minutos_atraso")
          .in("transferencia_id", lote)
          .gt("minutos_atraso", 0),
      ]);
      if (eventosRes.error) throw new Error(eventosRes.error.message);
      if (ocorrenciasRes.error) throw new Error(ocorrenciasRes.error.message);
      eventos.push(...((eventosRes.data ?? []) as EventoRow[]));
      ocorrencias.push(...((ocorrenciasRes.data ?? []) as OcorrenciaRow[]));
    }

    const baseIds = Array.from(new Set(rows.map((t) => t.base_id)));
    const motivoIds = Array.from(
      new Set(ocorrencias.map((o) => o.motivo_id).filter(Boolean)),
    ) as string[];
    const [basesRes, motivosRes] = await Promise.all([
      supabase.from("bases").select("id, codigo, nome").in("id", baseIds),
      motivoIds.length
        ? supabase.from("transferencia_motivos").select("id, nome").in("id", motivoIds)
        : Promise.resolve({ data: [] as { id: string; nome: string }[], error: null }),
    ]);
    if (basesRes.error) throw new Error(basesRes.error.message);
    if (motivosRes.error) throw new Error(motivosRes.error.message);

    const baseMap = new Map((basesRes.data ?? []).map((b) => [b.id, b] as const));
    const motivoMap = new Map((motivosRes.data ?? []).map((m) => [m.id, m.nome] as const));
    const eventosMap = new Map<string, EventoRow[]>();
    for (const evento of eventos) {
      const lista = eventosMap.get(evento.transferencia_id) ?? [];
      lista.push(evento);
      eventosMap.set(evento.transferencia_id, lista);
    }

    const minutosEntre = (inicio?: string, fim?: string) =>
      inicio && fim
        ? Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 60000))
        : null;
    const minutosDoDiaEmSaoPaulo = (iso?: string) => {
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
    };
    const metricas = rows.map((t) => {
      const lista = eventosMap.get(t.id) ?? [];
      const chegadaService = lista.find((e) => e.etapa === "chegada_service")?.ocorrido_em;
      const saidaService = lista.find((e) => e.etapa === "saida_service")?.ocorrido_em;
      const chegadaXpt = lista.find((e) => e.etapa === "chegada_xpt")?.ocorrido_em;
      const saidaXpt = lista.find((e) => e.etapa === "saida_xpt")?.ocorrido_em;
      return {
        ...t,
        chegadaService,
        saidaService,
        disponibilizadaAte7: (minutosDoDiaEmSaoPaulo(chegadaService) ?? Infinity) <= 7 * 60,
        aguardandoCarga: !!chegadaService && !saidaService,
        saidaApos9: (minutosDoDiaEmSaoPaulo(saidaService) ?? -Infinity) > 9 * 60,
        permanencia: minutosEntre(chegadaService, saidaService),
        deslocamento: minutosEntre(saidaService, chegadaXpt),
        concluida: !!saidaXpt,
      };
    });

    const media = (valores: Array<number | null>) => {
      const validos = valores.filter((v): v is number => v !== null);
      return validos.length
        ? Math.round(validos.reduce((total, valor) => total + valor, 0) / validos.length)
        : null;
    };
    const contarService = (lista: typeof metricas) => ({
      disponibilizados_ate_7: lista.filter((t) => t.disponibilizadaAte7).length,
      aguardando_carga: lista.filter((t) => t.aguardandoCarga).length,
      saidas_apos_9: lista.filter((t) => t.saidaApos9).length,
    });

    const service = contarService(metricas);
    const permanencias = metricas.map((t) => t.permanencia).filter((valor): valor is number => valor !== null);
    const totais: TransferenciasGerencialData["totais"] = {
      total: metricas.length,
      ...service,
      taxa_disponibilizacao: metricas.length ? (service.disponibilizados_ate_7 / metricas.length) * 100 : 0,
      media_service_min: media(permanencias),
      maior_service_min: permanencias.length ? Math.max(...permanencias) : null,
      media_deslocamento_min: media(metricas.map((t) => t.deslocamento)),
    };

    const porBase = baseIds
      .map((baseId) => {
        const lista = metricas.filter((t) => t.base_id === baseId);
        const base = baseMap.get(baseId);
        return {
          base_id: baseId,
          base_codigo: base?.codigo ?? "—",
          base_nome: base?.nome ?? "Base não encontrada",
          total: lista.length,
          ...contarService(lista),
          media_service_min: media(lista.map((t) => t.permanencia)),
          media_deslocamento_min: media(lista.map((t) => t.deslocamento)),
        };
      })
      .sort((a, b) => b.saidas_apos_9 - a.saidas_apos_9 || b.total - a.total);

    const motoristasMap = new Map<string, { viagens_atrasadas: number; minutos_atraso: number }>();
    for (const t of metricas) {
      if (t.permanencia === null) continue;
      const atual = motoristasMap.get(t.motorista) ?? { viagens_atrasadas: 0, minutos_atraso: 0 };
      atual.viagens_atrasadas++;
      atual.minutos_atraso += t.permanencia;
      motoristasMap.set(t.motorista, atual);
    }
    const rankingMotoristas = Array.from(motoristasMap.entries())
      .map(([motorista, valores]) => ({ motorista, ...valores }))
      .sort(
        (a, b) => b.minutos_atraso - a.minutos_atraso || b.viagens_atrasadas - a.viagens_atrasadas,
      )
      .slice(0, 10);

    const motivosMap = new Map<
      string,
      { motivo: string; responsabilidade: string; ocorrencias: number; minutos_atraso: number }
    >();
    for (const ocorrencia of ocorrencias) {
      const motivo = ocorrencia.motivo_id
        ? (motivoMap.get(ocorrencia.motivo_id) ?? "Motivo não encontrado")
        : "Em análise";
      const chave = `${ocorrencia.responsabilidade}::${motivo}`;
      const atual = motivosMap.get(chave) ?? {
        motivo,
        responsabilidade: ocorrencia.responsabilidade,
        ocorrencias: 0,
        minutos_atraso: 0,
      };
      atual.ocorrencias++;
      atual.minutos_atraso += ocorrencia.minutos_atraso;
      motivosMap.set(chave, atual);
    }
    const motivos = Array.from(motivosMap.values())
      .sort((a, b) => b.minutos_atraso - a.minutos_atraso || b.ocorrencias - a.ocorrencias)
      .slice(0, 10);

    return { periodo: data.periodo, totais, porBase, rankingMotoristas, motivos };
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
    const importacoesIniciais = await supabase
      .from("importacoes_escala")
      .select("id, base_id")
      .eq("data_operacional", dia)
      .eq("ativa", true)
      .in("base_id", allowedBases.map((b) => b.id));
    let imports = importacoesIniciais.data;
    if (importacoesIniciais.error) throw new Error(importacoesIniciais.error.message);

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
