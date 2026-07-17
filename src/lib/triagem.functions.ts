import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { normalizarCodigoTriagem, resumirRotasTriagem, rotaEfetivaTriagem } from "./triagem-domain";

const bipSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .transform(normalizarCodigoTriagem),
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

export type LocalizacaoShipmentTriagem =
  | {
      encontrado: true;
      shipment: string;
      rota: string;
      planejada: string | null;
      otimizada: string | null;
      cidade: string | null;
      triado: boolean;
    }
  | { encontrado: false; shipment: string; mensagem: string };
  
  const concluirRotaRessalvaSchema = z.object({
  baseId: z.string().uuid(),
  dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rota: z.string().trim().min(1).max(120),
  motivo: z
    .string()
    .trim()
    .min(5, "Informe um motivo com pelo menos 5 caracteres.")
    .max(1000),
});

export type ConclusaoRotaRessalva = {
  rota: string;
  motivo: string;
  previstos: number;
  triados: number;
  faltantes: number;
  concluidaEm: string;
  concluidaPor: string;
};

export const concluirRotaComRessalva = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    concluirRotaRessalvaSchema.parse(data),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<ConclusaoRotaRessalva> => {
      const { supabase, userId } = context;

      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );

      const { auditRequestMeta } = await import("./audit.server");

      const { data: importacao, error: importacaoErro } =
        await supabase
          .from("importacoes_escala")
          .select("id")
          .eq("base_id", data.baseId)
          .eq("data_operacional", data.dataOperacional)
          .eq("ativa", true)
          .maybeSingle();

      if (importacaoErro) {
        throw new Error(importacaoErro.message);
      }

      if (!importacao) {
        throw new Error(
          "Não existe importação ativa para esta base e dia operacional.",
        );
      }

      const PAGE_SIZE = 1000;

      const linhas: Array<{
        shipment: string | null;
        planejada: string | null;
        otimizada: string | null;
        triado: boolean | null;
      }> = [];

      for (let inicio = 0; ; inicio += PAGE_SIZE) {
        const { data: pagina, error } = await supabase
          .from("escalas")
          .select("shipment, planejada, otimizada, triado")
          .eq("importacao_id", importacao.id)
          .order("id", { ascending: true })
          .range(inicio, inicio + PAGE_SIZE - 1);

        if (error) {
          throw new Error(error.message);
        }

        if (!pagina?.length) {
          break;
        }

        linhas.push(...pagina);

        if (pagina.length < PAGE_SIZE) {
          break;
        }
      }

      const linhasDaRota = linhas.filter(
        (linha) =>
          linha.shipment?.trim() &&
          rotaEfetivaTriagem(linha) === data.rota,
      );

      const previstos = linhasDaRota.length;
      const triados = linhasDaRota.filter(
        (linha) => Boolean(linha.triado),
      ).length;

      const faltantes = Math.max(previstos - triados, 0);

      if (previstos === 0) {
        throw new Error("Rota não encontrada na importação ativa.");
      }

      if (faltantes === 0) {
        throw new Error(
          "Esta rota já está 100% concluída e não precisa de ressalva.",
        );
      }

      const { data: conclusaoExistente } = await supabaseAdmin
        .from("audit_logs")
        .select("user_id, created_at, detalhes")
        .eq("acao", "triagem.rota_concluida_ressalva")
        .eq("entidade", "importacao_escala")
        .eq("entidade_id", importacao.id)
        .contains("detalhes", {
          rota: data.rota,
        } as never)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (conclusaoExistente) {
        const detalhes = (conclusaoExistente.detalhes ??
          {}) as Record<string, unknown>;

        return {
          rota: data.rota,
          motivo: String(detalhes.motivo ?? data.motivo),
          previstos: Number(detalhes.previstos ?? previstos),
          triados: Number(detalhes.triados ?? triados),
          faltantes: Number(detalhes.faltantes ?? faltantes),
          concluidaEm: conclusaoExistente.created_at,
          concluidaPor: conclusaoExistente.user_id ?? userId,
        };
      }

      const concluidaEm = new Date().toISOString();
      const { ip, user_agent } = auditRequestMeta();

      const { error: auditoriaErro } = await supabaseAdmin
        .from("audit_logs")
        .insert({
          user_id: userId,
          acao: "triagem.rota_concluida_ressalva",
          entidade: "importacao_escala",
          entidade_id: importacao.id,
          detalhes: {
            rota: data.rota,
            motivo: data.motivo,
            previstos,
            triados,
            faltantes,
            base_id: data.baseId,
            data_operacional: data.dataOperacional,
            status: "concluida_ressalva",
          } as never,
          ip,
          user_agent,
        });

      if (auditoriaErro) {
        throw new Error(
          `Não foi possível registrar a conclusão: ${auditoriaErro.message}`,
        );
      }

      return {
        rota: data.rota,
        motivo: data.motivo,
        previstos,
        triados,
        faltantes,
        concluidaEm,
        concluidaPor: userId,
      };
    },
  );

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
      const registro = supabase.from("recebimentos").insert({
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
      const auditoria = registrarAuditInterno(supabase, userId, {
        acao: `triagem.${resultado}`,
        entidade: "escala",
        entidade_id: escalaId,
        detalhes: { codigo: data.codigo, mensagem, base_id: baseId, dia: data.dataOperacional },
      });
      await Promise.all([registro, auditoria]);
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
        { id: string; base_id: string; bases: { codigo: string; nome: string } | null } | undefined;
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
    const rotaCodigo = rotaEfetivaTriagem(escala) ?? "—";

    /*
     * Verifica se a rota foi concluída manualmente com ressalva.
     * Uma falha isolada na auditoria não deve derrubar toda a bipagem.
     */
    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );

      const { data: rotaEncerradaComRessalva, error: ressalvaErro } =
        await supabaseAdmin
          .from("audit_logs")
          .select("id")
          .eq("acao", "triagem.rota_concluida_ressalva")
          .eq("entidade", "importacao_escala")
          .eq("entidade_id", escala.importacao_id!)
          .contains("detalhes", {
            rota: rotaCodigo,
          } as never)
          .limit(1)
          .maybeSingle();

      if (ressalvaErro) {
        console.error(
          "Falha ao verificar conclusão de rota com ressalva:",
          ressalvaErro.message,
        );
      } else if (rotaEncerradaComRessalva) {
        const mensagem =
          `A rota ${rotaCodigo} foi concluída com ressalva e está bloqueada para novas bipagens.`;

        await log(
          "encerrada",
          mensagem,
          escala.base_id,
          escala.id,
        );

        return {
          resultado: "encerrada",
          mensagem,
          hora,
        };
      }
    } catch (erro) {
      console.error(
        "Não foi possível verificar a conclusão da rota com ressalva:",
        erro,
      );
    }

    // 4.a) Se o operador escolheu uma rota, o shipment tem que pertencer a ela
    if (data.rotaSelecionada && rotaCodigo !== data.rotaSelecionada) {
      const msg = `Shipment pertence à rota ${rotaCodigo}, mas a rota selecionada é ${data.rotaSelecionada}.`;
      await log("outra_base", msg, escala.base_id, escala.id);
      return { resultado: "rota_divergente", mensagem: msg, hora };
    }

    const countRota = async () => {
      let previstosQuery = supabase
        .from("escalas")
        .select("id", { count: "exact", head: true })
        .eq("importacao_id", escala!.importacao_id!)
        .not("shipment", "is", null)
        .neq("shipment", "");
      let triadosQuery = supabase
        .from("escalas")
        .select("id", { count: "exact", head: true })
        .eq("importacao_id", escala!.importacao_id!)
        .not("shipment", "is", null)
        .neq("shipment", "")
        .eq("triado", true);

      if (escala!.otimizada?.trim()) {
        previstosQuery = previstosQuery.eq("otimizada", escala!.otimizada);
        triadosQuery = triadosQuery.eq("otimizada", escala!.otimizada);
      } else {
        previstosQuery = previstosQuery
          .is("otimizada", null)
          .eq("planejada", escala!.planejada ?? "");
        triadosQuery = triadosQuery.is("otimizada", null).eq("planejada", escala!.planejada ?? "");
      }

      const [{ count: prev }, { count: tri }] = await Promise.all([previstosQuery, triadosQuery]);
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
    const { data: atualizado, error: upErr } = await supabase
      .from("escalas")
      .update({ triado: true, triado_em: hora, triado_por: userId })
      .eq("id", escala.id)
      .eq("triado", false)
      .select("id")
      .maybeSingle();
    if (upErr) throw new Error(upErr.message);

    // Outra leitura pode ter vencido a corrida entre o SELECT e o UPDATE.
    // Nesse caso a segunda tentativa é duplicada, nunca um segundo "ok".
    if (!atualizado) {
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
    z
      .object({
        baseId: z.string().uuid(),
        dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    type RotaTriagemDia = {
      rota: string;
      previstos: number;
      triados: number;
      pendentes: number;
      percentual: number;
      status: "aberta" | "fechada" | "concluida_ressalva";
      conclusaoRessalva?: {
        motivo: string;
        concluidaEm: string;
        concluidaPor: string;
        faltantes: number;
      };
    };

    const { data: impAtiva, error: importacaoErro } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();

    if (importacaoErro) {
      throw new Error(importacaoErro.message);
    }

    if (!impAtiva) {
      return [] as RotaTriagemDia[];
    }

    const PAGE_SIZE = 1000;

    const linhas: Array<{
      shipment: string | null;
      planejada: string | null;
      otimizada: string | null;
      triado: boolean | null;
    }> = [];

    for (let inicio = 0; ; inicio += PAGE_SIZE) {
      const { data: pagina, error: paginaErro } = await supabase
        .from("escalas")
        .select("shipment, planejada, otimizada, triado")
        .eq("importacao_id", impAtiva.id)
        .order("id", { ascending: true })
        .range(inicio, inicio + PAGE_SIZE - 1);

      if (paginaErro) {
        throw new Error(paginaErro.message);
      }

      if (!pagina || pagina.length === 0) {
        break;
      }

      linhas.push(...pagina);

      if (pagina.length < PAGE_SIZE) {
        break;
      }
    }

    const resumo = resumirRotasTriagem(linhas) as RotaTriagemDia[];

    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );

      const { data: conclusoes, error: conclusoesErro } =
        await supabaseAdmin
          .from("audit_logs")
          .select("user_id, created_at, detalhes")
          .eq("acao", "triagem.rota_concluida_ressalva")
          .eq("entidade", "importacao_escala")
          .eq("entidade_id", impAtiva.id)
          .order("created_at", { ascending: false });

      if (conclusoesErro) {
        console.error(
          "Falha ao consultar conclusões de rota com ressalva:",
          conclusoesErro.message,
        );
        return resumo;
      }

      const conclusoesPorRota = new Map<
        string,
        {
          motivo: string;
          concluidaEm: string;
          concluidaPor: string;
          faltantes: number;
        }
      >();

      for (const registro of conclusoes ?? []) {
        const detalhes = (registro.detalhes ?? {}) as Record<
          string,
          unknown
        >;

        const rota =
          typeof detalhes.rota === "string"
            ? detalhes.rota.trim()
            : "";

        if (!rota || conclusoesPorRota.has(rota)) {
          continue;
        }

        conclusoesPorRota.set(rota, {
          motivo:
            typeof detalhes.motivo === "string" &&
            detalhes.motivo.trim().length > 0
              ? detalhes.motivo
              : "Motivo não informado",
          concluidaEm:
            registro.created_at ?? new Date().toISOString(),
          concluidaPor:
            registro.user_id ?? "Usuário não identificado",
          faltantes: Number(detalhes.faltantes ?? 0),
        });
      }

      return resumo.map((rota) => {
        const ressalva = conclusoesPorRota.get(rota.rota);

        if (!ressalva) {
          return rota;
        }

        return {
          ...rota,
          status: "concluida_ressalva" as const,
          conclusaoRessalva: ressalva,
        };
      });
    } catch (erro) {
      console.error(
        "Não foi possível carregar as ressalvas das rotas:",
        erro,
      );
      return resumo;
    }
  });

export const localizarShipmentTriagem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        baseId: z.string().uuid(),
        dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        shipment: z
          .string()
          .trim()
          .min(3)
          .max(120)
          .transform((valor) => valor.replace(/[^0-9A-Za-z]/g, ""))
          .refine((valor) => valor.length >= 3, "Shipment inválido."),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LocalizacaoShipmentTriagem> => {
    const { supabase } = context;
    const { data: impAtiva, error: impErro } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();
    if (impErro) throw new Error(impErro.message);
    if (!impAtiva) {
      return {
        encontrado: false,
        shipment: data.shipment,
        mensagem: "Não existe importação ativa para esta base e dia operacional.",
      };
    }

    const { data: linhas, error } = await supabase
      .from("escalas")
      .select("shipment, planejada, otimizada, cidade, triado")
      .eq("importacao_id", impAtiva.id)
      .eq("shipment", data.shipment)
      .limit(2);
    if (error) throw new Error(error.message);

    const linha = linhas?.[0];
    if (!linha) {
      return {
        encontrado: false,
        shipment: data.shipment,
        mensagem: "Shipment não encontrado na operação ativa desta base e dia.",
      };
    }
    if ((linhas?.length ?? 0) > 1) {
      throw new Error("Shipment duplicado na importação ativa. Acione a supervisão.");
    }

    const rota = rotaEfetivaTriagem(linha);
    if (!rota) {
      throw new Error("Shipment encontrado, mas sem rota planejada ou otimizada.");
    }

    return {
      encontrado: true,
      shipment: linha.shipment ?? data.shipment,
      rota,
      planejada: linha.planejada,
      otimizada: linha.otimizada,
      cidade: linha.cidade,
      triado: !!linha.triado,
    };
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
    z
      .object({
        baseId: z.string().uuid(),
        dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
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
          .eq("importacao_id", impAtiva.id)
          .not("shipment", "is", null)
          .neq("shipment", ""),
        supabase
          .from("escalas")
          .select("id", { count: "exact", head: true })
          .eq("importacao_id", impAtiva.id)
          .not("shipment", "is", null)
          .neq("shipment", "")
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
    z
      .object({
        baseId: z.string().uuid(),
        dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        rota: z.string().trim().min(1).max(120),
      })
      .parse(d),
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
    type LinhaRota = {
      id: string;
      shipment: string | null;
      cidade: string | null;
      triado: boolean | null;
    };
    const carregar = async (fallbackPlanejada: boolean) => {
      const resultado: LinhaRota[] = [];
      for (let from = 0; ; from += PAGE) {
        let query = supabase
          .from("escalas")
          .select("id, shipment, cidade, triado")
          .eq("importacao_id", impAtiva.id)
          .not("shipment", "is", null)
          .neq("shipment", "");
        query = fallbackPlanejada
          ? query.is("otimizada", null).eq("planejada", data.rota)
          : query.eq("otimizada", data.rota);
        const { data: page, error } = await query
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        if (!page || page.length === 0) break;
        resultado.push(...page);
        if (page.length < PAGE) break;
      }
      return resultado;
    };
    const [otimizadas, planejadasFallback] = await Promise.all([carregar(false), carregar(true)]);
    const rows = Array.from(
      new Map([...otimizadas, ...planejadasFallback].map((linha) => [linha.id, linha])).values(),
    );
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
