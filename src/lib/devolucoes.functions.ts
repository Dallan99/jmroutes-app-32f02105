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

export const listarDevolucoes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      baseId: z.string().uuid(),
      diaOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Dia operacional em horário do Brasil (UTC-3): 00:00 BRT = 03:00 UTC.
    const inicioMs = Date.parse(`${data.diaOperacional}T03:00:00Z`);
    const inicio = new Date(inicioMs).toISOString();
    const fim = new Date(inicioMs + 24 * 3600 * 1000 - 1).toISOString();
    const { data: rows, error } = await supabase
      .from("devolucoes")
      .select("id, shipment_codigo, motivo, observacao, rota, motorista, devolvido_em, cancelado, devolvido_por")
      .eq("base_id", data.baseId)
      .gte("devolvido_em", inicio)
      .lte("devolvido_em", fim)
      .order("devolvido_em", { ascending: false });
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((rows ?? []).map((r) => r.devolvido_por).filter(Boolean)));
    const nomes = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id, nome").in("id", userIds);
      (profs ?? []).forEach((p) => nomes.set(p.id, p.nome));
    }
    return (rows ?? []).map((r) => ({
      id: r.id,
      shipment_codigo: r.shipment_codigo,
      motivo: r.motivo as MotivoDevolucao,
      observacao: r.observacao,
      rota: r.rota,
      motorista: r.motorista,
      devolvido_em: r.devolvido_em,
      cancelado: r.cancelado,
      operador_nome: r.devolvido_por ? nomes.get(r.devolvido_por) ?? null : null,
    }));
  });

export const cancelarDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
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
