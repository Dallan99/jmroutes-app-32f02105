import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const MOTIVOS = [
  { value: "cliente_ausente", label: "Cliente ausente" },
  { value: "endereco_nao_localizado", label: "Endereço não localizado" },
  { value: "recusado", label: "Recusado pelo cliente" },
  { value: "avaria", label: "Avaria / Volume danificado" },
  { value: "zona_de_risco", label: "Zona de risco" },
  { value: "comercio_fechado", label: "Comércio fechado" },
  { value: "outros", label: "Outros" },
] as const;

export type MotivoDevolucao = (typeof MOTIVOS)[number]["value"];

const registrarSchema = z.object({
  baseId: z.string().uuid(),
  diaOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  codigo: z.string().trim().min(3).max(120),
  motivo: z.enum([
    "cliente_ausente",
    "endereco_nao_localizado",
    "recusado",
    "avaria",
    "zona_de_risco",
    "comercio_fechado",
    "outros",
  ]),
  observacao: z.string().max(500).optional(),
  rota: z.string().trim().max(60).optional(),
});

export type RegistrarDevolucaoResult = {
  resultado: "ok" | "duplicado";
  mensagem: string;
  devolucao?: {
    id: string;
    shipment_codigo: string;
    motivo: MotivoDevolucao;
    devolvido_em: string;
    rota: string | null;
    motorista: string | null;
  };
  jaDevolvido?: {
    devolvido_em: string;
    motivo: MotivoDevolucao;
    devolvido_por: string | null;
  };
};

export const registrarDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => registrarSchema.parse(data))
  .handler(async ({ data, context }): Promise<RegistrarDevolucaoResult> => {
    const { supabase, userId } = context;
    const codigo = data.codigo.trim();

    // Busca escala (opcional) para pegar rota/motorista automaticamente
    const { data: escala } = await supabase
      .from("escalas")
      .select("id, base_id, shipment, planejada, driver, data_referencia")
      .eq("shipment", codigo)
      .eq("data_referencia", data.diaOperacional)
      .maybeSingle();

    // Já devolvido?
    const { data: existente } = await supabase
      .from("devolucoes")
      .select("id, motivo, devolvido_em, devolvido_por")
      .eq("shipment_codigo", codigo)
      .eq("base_id", data.baseId)
      .eq("cancelado", false)
      .order("devolvido_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existente) {
      return {
        resultado: "duplicado",
        mensagem: `Pedido ${codigo} já foi recebido na base em ${new Date(existente.devolvido_em).toLocaleString("pt-BR")}.`,
        jaDevolvido: {
          devolvido_em: existente.devolvido_em,
          motivo: existente.motivo as MotivoDevolucao,
          devolvido_por: existente.devolvido_por,
        },
      };
    }

    const escalaValida = escala && escala.base_id === data.baseId ? escala : null;
    const rotaFinal = data.rota?.trim() || escalaValida?.planejada || null;

    // Insere devolução
    const { data: inserido, error } = await supabase
      .from("devolucoes")
      .insert({
        base_id: data.baseId,
        escala_id: escalaValida?.id ?? null,
        shipment_codigo: codigo,
        rota: rotaFinal,
        motorista: escalaValida?.driver ?? null,
        motivo: data.motivo,
        observacao: data.observacao ?? null,
        devolvido_por: userId,
      })
      .select("id, shipment_codigo, motivo, devolvido_em, rota, motorista")
      .single();

    if (error || !inserido) {
      throw new Error(error?.message ?? "Falha ao registrar devolução.");
    }

    // Marca escala como devolvida quando existir vínculo
    if (escalaValida) {
      await supabase
        .from("escalas")
        .update({
          devolvido: true,
          devolvido_em: inserido.devolvido_em,
          devolvido_motivo: data.motivo,
        })
        .eq("id", escalaValida.id);
    }

    return {
      resultado: "ok",
      mensagem: `Devolução do ID ${codigo} registrada.`,
      devolucao: {
        id: inserido.id,
        shipment_codigo: inserido.shipment_codigo,
        motivo: inserido.motivo as MotivoDevolucao,
        devolvido_em: inserido.devolvido_em,
        rota: inserido.rota,
        motorista: inserido.motorista,
      },
    };
  });

/** Página do PostgREST — limite duro de 1000 registros por consulta. */
export const DEVOLUCOES_PAGE = 1000;
/** Proteção contra loop infinito: até 100 páginas de dados (100 mil registros). */
export const DEVOLUCOES_MAX_PAGES = 100;

export type PaginaDevolucao = {
  data: unknown[] | null;
  error: { message: string } | null;
};

/**
 * Paginador puro/testável. Chama `fetchPage(from, to)` em loop com PAGE=1000,
 * acumula tudo em ordem estável e para apenas quando a página retorna menos
 * que PAGE. Se qualquer página retornar `error`, aborta imediatamente. Não
 * aplica slice, limit final ou deduplicação.
 */
export async function paginarTodasDevolucoes<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  page: number = DEVOLUCOES_PAGE,
  maxPages: number = DEVOLUCOES_MAX_PAGES,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const from = i * page;
    const to = from + page - 1;
    const { data: rows, error } = await fetchPage(from, to);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return out;
    out.push(...rows);
    if (rows.length < page) return out;
  }

  // Quando a última página permitida vem exatamente cheia, é necessária uma
  // consulta vazia adicional para distinguir "exatamente no limite" de
  // "existem mais dados". Essa consulta não adiciona registros ao resultado.
  const probeFrom = maxPages * page;
  const { data: probeRows, error: probeError } = await fetchPage(probeFrom, probeFrom + page - 1);
  if (probeError) throw new Error(probeError.message);
  if (!probeRows || probeRows.length === 0) return out;

  throw new Error(
    `Limite técnico de ${maxPages} páginas atingido em listarDevolucoes (mais de ${maxPages * page} registros). Ajuste o filtro de dia/base.`,
  );
}

/**
 * Filtro puro para "Imprimir uma rota": só devoluções válidas (não canceladas)
 * cuja rota normalizada (trim + upperCase) bate com a rota escolhida. Passe
 * `null` para o grupo "(sem rota)".
 */
export function normalizarRotaDevolucao(rota: string | null | undefined): string | null {
  if (rota === null || rota === undefined) return null;
  const s = rota.trim().toUpperCase();
  return s.length === 0 ? null : s;
}

export function filtrarDevolucoesPorRota<T extends { rota: string | null; cancelado: boolean }>(
  linhas: T[],
  rotaAlvo: string | null,
): T[] {
  const alvo = rotaAlvo === null ? null : normalizarRotaDevolucao(rotaAlvo);
  return linhas.filter((l) => !l.cancelado && normalizarRotaDevolucao(l.rota) === alvo);
}

export const listarDevolucoes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        baseId: z.string().uuid(),
        diaOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Dia operacional em horário do Brasil (UTC-3): 00:00 BRT = 03:00 UTC.
    const inicioMs = Date.parse(`${data.diaOperacional}T03:00:00Z`);
    const inicio = new Date(inicioMs).toISOString();
    const fim = new Date(inicioMs + 24 * 3600 * 1000 - 1).toISOString();

    type Row = {
      id: string;
      shipment_codigo: string;
      motivo: string;
      observacao: string | null;
      rota: string | null;
      motorista: string | null;
      devolvido_em: string;
      cancelado: boolean;
      devolvido_por: string | null;
    };

    const rows = await paginarTodasDevolucoes<Row>(
      (from, to) =>
        supabase
          .from("devolucoes")
          .select(
            "id, shipment_codigo, motivo, observacao, rota, motorista, devolvido_em, cancelado, devolvido_por",
          )
          .eq("base_id", data.baseId)
          .gte("devolvido_em", inicio)
          .lte("devolvido_em", fim)
          .order("devolvido_em", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to) as unknown as Promise<{
          data: Row[] | null;
          error: { message: string } | null;
        }>,
    );

    const userIds = Array.from(
      new Set(rows.map((r) => r.devolvido_por).filter(Boolean)),
    ) as string[];
    const nomes = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id, nome").in("id", userIds);
      (profs ?? []).forEach((p) => nomes.set(p.id as string, p.nome as string));
    }
    return rows.map((r) => ({
      id: r.id,
      shipment_codigo: r.shipment_codigo,
      motivo: r.motivo as MotivoDevolucao,
      observacao: r.observacao,
      rota: r.rota,
      motorista: r.motorista,
      devolvido_em: r.devolvido_em,
      cancelado: r.cancelado,
      operador_nome: r.devolvido_por ? (nomes.get(r.devolvido_por) ?? null) : null,
    }));
  });

export const cancelarDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: dev, error } = await supabase
      .from("devolucoes")
      .update({ cancelado: true, cancelado_em: new Date().toISOString(), cancelado_por: userId })
      .eq("id", data.id)
      .select("escala_id")
      .single();
    if (error) throw new Error(error.message);
    if (dev?.escala_id) {
      await supabase
        .from("escalas")
        .update({ devolvido: false, devolvido_em: null, devolvido_motivo: null })
        .eq("id", dev.escala_id);
    }
    return { ok: true };
  });
