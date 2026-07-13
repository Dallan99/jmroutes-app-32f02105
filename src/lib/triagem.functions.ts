import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const bipSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .transform((s) => s.replace(/[^0-9A-Za-z]/g, "")),
  baseId: z.string().uuid(),
  dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tempoDesdeUltimaMs: z.number().int().nonnegative().optional(),
  rotaSelecionada: z.string().trim().min(1).max(120).optional(),
});

export type TriagemResult = {
  resultado:
    | "ok"
    | "duplicado"
    | "inexistente"
    | "nao_recebido"
    | "outra_base"
    | "rota_divergente"
    | "cancelada"
    | "encerrada";
  mensagem: string;
  hora: string;
  rota?: {
    id: string;
    codigo: string;
    cidade: string;
    base_codigo: string | null;
    base_nome: string | null;
    rota_final: string | null;
    destinatario_nome: string | null;
    destinatario_cep: string | null;
    quantidade_prevista: number;
    quantidade_triada: number;
    percentual_triagem: number;
  };
  volume?: { codigo: string; sequencia: number; total: number };
};

/**
 * Bipagem de Triagem — trabalha em cima da PLANILHA importada (escala).
 * Cada linha da planilha = 1 Shipment bipável, escopado por Base + Dia Operacional.
 */
export const biparTriagem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bipSchema.parse(data))
  .handler(async ({ data, context }): Promise<TriagemResult> => {
    const { supabase, userId } = context;
    const { auditRequestMeta, registrarAuditInterno } = await import("./audit.server");
    const hora = new Date().toISOString();
    const { ip, user_agent: userAgent } = auditRequestMeta();
    const tempo = data.tempoDesdeUltimaMs ?? null;

    async function log(
      resultado: TriagemResult["resultado"],
      mensagem: string,
      baseId: string | null,
      escalaId: string | null,
    ) {
      const mapped =
        resultado === "nao_recebido"
          ? "inexistente"
          : resultado === "rota_divergente"
            ? "outra_rota"
            : resultado;
      await supabase.from("recebimentos").insert({
        codigo_bipado: data.codigo,
        rota_id: null,
        volume_id: null,
        base_id: baseId,
        operador_id: userId,
        resultado: mapped,
        mensagem,
        ip,
        user_agent: userAgent,
        tempo_desde_ultima_ms: tempo,
        stage: "triagem",
      });
      await registrarAuditInterno(supabase, userId, {
        acao: `triagem.${resultado}`,
        entidade: "escala",
        entidade_id: escalaId,
        detalhes: { codigo: data.codigo, mensagem, base_id: baseId, dia: data.dataOperacional },
      });
    }

    // 1) Importação ativa da Base + Dia
    const { data: impAtiva } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();

    // 2) Procura o Shipment dentro dessa importação
    let escala: {
      id: string;
      shipment: string | null;
      planejada: string | null;
      otimizada: string | null;
      cidade: string | null;
      cep: string | null;
      triado: boolean;
      base_id: string | null;
      importacao_id: string | null;
    } | null = null;
    if (impAtiva) {
      const { data: row } = await supabase
        .from("escalas")
        .select("id, shipment, planejada, otimizada, cidade, cep, triado, base_id, importacao_id")
        .eq("importacao_id", impAtiva.id)
        .eq("shipment", data.codigo)
        .maybeSingle();
      escala = row ?? null;
    }

    // 3) Não achou? Verifica se pertence a outra Base ativa
    if (!escala) {
      const { data: outros } = await supabase
        .from("escalas")
        .select("id, base_id, bases:base_id(codigo, nome), importacoes_escala!inner(ativa)")
        .eq("shipment", data.codigo)
        .eq("importacoes_escala.ativa", true)
        .limit(1);
      const outro = outros?.[0] as
        | { id: string; base_id: string; bases: { codigo: string; nome: string } | null }
        | undefined;
      if (outro) {
        const msg = `Pedido pertence a outra operação — base ${outro.bases?.codigo ?? "?"} ${outro.bases?.nome ?? ""}.`;
        await log("outra_base", msg, outro.base_id, outro.id);
        return { resultado: "outra_base", mensagem: msg, hora };
      }
      const msg = "Shipment não encontrado nas planilhas importadas.";
      await log("inexistente", msg, data.baseId, null);
      return { resultado: "inexistente", mensagem: msg, hora };
    }

    // 4) Métricas por rota planejada
    // A operação confere por Rota Otimizada (coluna "Rota Otimizada" da planilha).
    const rotaCodigo = escala.otimizada ?? escala.planejada ?? "—";

    // 4.a) Se o operador escolheu uma rota, o shipment tem que pertencer a ela
    if (data.rotaSelecionada && rotaCodigo !== data.rotaSelecionada) {
      const msg = `Shipment pertence à rota ${rotaCodigo}, mas a rota selecionada é ${data.rotaSelecionada}.`;
      await log("outra_base", msg, escala.base_id, escala.id);
      return { resultado: "rota_divergente", mensagem: msg, hora };
    }

    const countRota = async () => {
      const [{ count: prev }, { count: tri }] = await Promise.all([
        supabase
          .from("escalas")
          .select("id", { count: "exact", head: true })
          .eq("importacao_id", escala!.importacao_id!)
          .eq("otimizada", escala!.otimizada ?? ""),
        supabase
          .from("escalas")
          .select("id", { count: "exact", head: true })
          .eq("importacao_id", escala!.importacao_id!)
          .eq("otimizada", escala!.otimizada ?? "")
          .eq("triado", true),
      ]);
      return { prev: prev ?? 0, tri: tri ?? 0 };
    };
    const build = async () => {
      const { prev, tri } = await countRota();
      return {
        id: escala!.id,
        codigo: rotaCodigo,
        cidade: escala!.cidade ?? "",
        base_codigo: null,
        base_nome: null,
        rota_final: escala!.otimizada,
        destinatario_nome: null,
        destinatario_cep: escala!.cep,
        quantidade_prevista: prev,
        quantidade_triada: tri,
        percentual_triagem: prev ? Math.round((tri / prev) * 100) : 0,
      };
    };

    // 5) Duplicado
    if (escala.triado) {
      const msg = `Shipment ${escala.shipment} já foi triado.`;
      await log("duplicado", msg, escala.base_id, escala.id);
      return {
        resultado: "duplicado",
        mensagem: msg,
        hora,
        rota: await build(),
        volume: { codigo: escala.shipment ?? data.codigo, sequencia: 1, total: 1 },
      };
    }

    // 6) Marca triado
    const { error: upErr } = await supabase
      .from("escalas")
      .update({ triado: true, triado_em: hora, triado_por: userId })
      .eq("id", escala.id);
    if (upErr) throw new Error(upErr.message);

    const rotaInfo = await build();
    const mensagem =
      rotaInfo.quantidade_triada >= rotaInfo.quantidade_prevista
        ? `Triagem COMPLETA da rota ${rotaCodigo}.`
        : `Shipment triado — rota ${rotaCodigo} (${rotaInfo.quantidade_triada}/${rotaInfo.quantidade_prevista}).`;
    await log("ok", mensagem, escala.base_id, escala.id);

    return {
      resultado: "ok",
      mensagem,
      hora,
      rota: rotaInfo,
      volume: { codigo: escala.shipment ?? data.codigo, sequencia: 1, total: 1 },
    };
  });

export const triagemRotasDoDia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      baseId: z.string().uuid(),
      dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: impAtiva } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();
    if (!impAtiva) return [] as Array<{ rota: string; previstos: number; triados: number; pendentes: number; percentual: number; status: "aberta" | "fechada" }>;

    // PostgREST limita a 1000 linhas por página. Como a planilha pode ter
    // milhares de shipments, precisamos paginar para não perder rotas.
    const PAGE = 1000;
    const linhas: Array<{ planejada: string | null; otimizada: string | null; triado: boolean | null }> = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabase
        .from("escalas")
        .select("planejada, otimizada, triado")
        .eq("importacao_id", impAtiva.id)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!page || page.length === 0) break;
      linhas.push(...page);
      if (page.length < PAGE) break;
    }

    const acc = new Map<string, { previstos: number; triados: number }>();
    for (const l of linhas) {
      const rota = (l.otimizada as string | null) ?? (l.planejada as string | null) ?? "—";
      const cur = acc.get(rota) ?? { previstos: 0, triados: 0 };
      cur.previstos += 1;
      if (l.triado) cur.triados += 1;
      acc.set(rota, cur);
    }

    return Array.from(acc.entries())
      .map(([rota, v]) => {
        const pendentes = Math.max(v.previstos - v.triados, 0);
        const percentual = v.previstos ? Math.round((v.triados / v.previstos) * 100) : 0;
        return {
          rota,
          previstos: v.previstos,
          triados: v.triados,
          pendentes,
          percentual,
          status: pendentes === 0 ? ("fechada" as const) : ("aberta" as const),
        };
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "aberta" ? -1 : 1;
        return a.rota.localeCompare(b.rota, "pt-BR", { numeric: true });
      });
  });

export const ultimasTriagens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("recebimentos")
      .select("id, codigo_bipado, resultado, mensagem, created_at")
      .eq("stage", "triagem")
      .order("created_at", { ascending: false })
      .limit(20);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      codigo_bipado: r.codigo_bipado as string,
      resultado: r.resultado as string,
      mensagem: (r.mensagem as string) ?? null,
      created_at: r.created_at as string,
      rotas: null as { codigo: string } | null,
    }));
  });

export const triagemResumoDia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      baseId: z.string().uuid(),
      dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data: impAtiva } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();

    let totalPrev = 0;
    let triados = 0;
    if (impAtiva) {
      const [{ count: p }, { count: t }] = await Promise.all([
        supabase
          .from("escalas")
          .select("id", { count: "exact", head: true })
          .eq("importacao_id", impAtiva.id),
        supabase
          .from("escalas")
          .select("id", { count: "exact", head: true })
          .eq("importacao_id", impAtiva.id)
          .eq("triado", true),
      ]);
      totalPrev = p ?? 0;
      triados = t ?? 0;
    }

    const { count: meus } = await supabase
      .from("recebimentos")
      .select("id", { count: "exact", head: true })
      .eq("stage", "triagem")
      .eq("operador_id", userId)
      .eq("resultado", "ok")
      .gte("created_at", start.toISOString());

    return {
      totalPrevistos: totalPrev,
      totalTriados: triados,
      pendentes: Math.max(totalPrev - triados, 0),
      meusHoje: meus ?? 0,
      temImportacao: !!impAtiva,
    };
  });

export const triagemShipmentsPendentes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      baseId: z.string().uuid(),
      dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      rota: z.string().trim().min(1).max(120),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: impAtiva } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();
    if (!impAtiva)
      return {
        rota: data.rota,
        pendentes: [] as Array<{ shipment: string; cidade: string | null }>,
        triados: [] as Array<{ shipment: string; cidade: string | null }>,
      };

    const PAGE = 1000;
    const rows: Array<{ shipment: string | null; cidade: string | null; triado: boolean | null }> = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabase
        .from("escalas")
        .select("shipment, cidade, triado")
        .eq("importacao_id", impAtiva.id)
        .eq("otimizada", data.rota)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!page || page.length === 0) break;
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    const pendentes = rows
      .filter((r) => !r.triado && r.shipment)
      .map((r) => ({ shipment: r.shipment as string, cidade: r.cidade }))
      .sort((a, b) => a.shipment.localeCompare(b.shipment));
    const triados = rows
      .filter((r) => r.triado && r.shipment)
      .map((r) => ({ shipment: r.shipment as string, cidade: r.cidade }))
      .sort((a, b) => a.shipment.localeCompare(b.shipment));
    return { rota: data.rota, pendentes, triados };
  });