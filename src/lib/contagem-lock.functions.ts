import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Resolve a base operacional autorizada para o usuário.
 * - Admin: pode operar sobre `baseSolicitadaId` desde que a base exista.
 * - Não-admin: obrigatoriamente `profiles.base_id`; qualquer valor
 *   diferente enviado pelo cliente é rejeitado.
 * - Usuário inativo: bloqueado.
 * Retorna o UUID da base efetiva a ser usada.
 */
async function resolveBaseOperacionalAutorizada(
  supabase: SupabaseClient<Database>,
  userId: string,
  baseSolicitadaId: string,
): Promise<string> {
  const [{ data: prof }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("base_id, ativo").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);
  if (!prof) throw new Error("Perfil não encontrado.");
  if (prof.ativo === false) throw new Error("Usuário inativo. Contate o administrador.");
  const rolesArr = (roles ?? []).map((r) => r.role as string);
  const isAdmin = rolesArr.includes("admin");
  if (isAdmin) {
    const { data: base } = await supabase
      .from("bases")
      .select("id, ativa")
      .eq("id", baseSolicitadaId)
      .maybeSingle();
    if (!base) throw new Error("Base não encontrada.");
    if (base.ativa === false) throw new Error("Base inativa.");
    return baseSolicitadaId;
  }
  if (!prof.base_id) {
    throw new Error("Usuário sem base operacional vinculada. Contate o administrador.");
  }
  if (baseSolicitadaId !== prof.base_id) {
    throw new Error("Operação bloqueada: base não autorizada para este usuário.");
  }
  return prof.base_id;
}

export type RotaLock = {
  id: string;
  nome: string;
  previsto: number | null;
  motorista: string | null;
  criado_por: string | null;
  criado_por_nome: string | null;
  criado_em: string;
  eh_meu: boolean;
};

const baseDiaSchema = z.object({
  baseId: z.string().uuid(),
  diaOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const listarRotasLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => baseDiaSchema.parse(i))
  .handler(async ({ data, context }): Promise<RotaLock[]> => {
    const { supabase, userId } = context;
    const baseId = await resolveBaseOperacionalAutorizada(supabase, userId, data.baseId);
    const { data: rows, error } = await supabase
      .from("contagens_rotas_lock")
      .select("id, nome, previsto, motorista, criado_por, criado_em")
      .eq("base_id", baseId)
      .eq("data_operacional", data.diaOperacional);
    if (error) throw new Error(error.message);
    const uids = Array.from(
      new Set((rows ?? []).map((r) => r.criado_por).filter(Boolean) as string[]),
    );
    const nomes = new Map<string, string>();
    if (uids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, nome").in("id", uids);
      (profs ?? []).forEach((p) => nomes.set(p.id, p.nome as string));
    }
    return (rows ?? []).map((r) => ({
      id: r.id,
      nome: r.nome,
      previsto: r.previsto,
      motorista: r.motorista,
      criado_por: r.criado_por,
      criado_por_nome: r.criado_por ? (nomes.get(r.criado_por) ?? null) : null,
      criado_em: r.criado_em,
      eh_meu: r.criado_por === userId,
    }));
  });

export const reservarRotaLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    baseDiaSchema
      .extend({
        nome: z.string().trim().min(1).max(60),
        previsto: z.number().int().min(0).max(100000).optional(),
        motorista: z.string().trim().max(120).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const baseId = await resolveBaseOperacionalAutorizada(supabase, userId, data.baseId);
    const nome = data.nome.toUpperCase();

    const { data: existente } = await supabase
      .from("contagens_rotas_lock")
      .select("id, criado_por")
      .eq("base_id", baseId)
      .eq("data_operacional", data.diaOperacional)
      .eq("nome", nome)
      .maybeSingle();

    if (existente) {
      if (existente.criado_por === userId) {
        return { resultado: "ja_e_meu" as const, id: existente.id };
      }
      let nomeDono: string | null = null;
      if (existente.criado_por) {
        const { data: p } = await supabase
          .from("profiles")
          .select("nome")
          .eq("id", existente.criado_por)
          .maybeSingle();
        nomeDono = (p?.nome as string) ?? null;
      }
      return { resultado: "em_uso" as const, dono: nomeDono };
    }

    const { data: inserido, error } = await supabase
      .from("contagens_rotas_lock")
      .insert({
        base_id: baseId,
        data_operacional: data.diaOperacional,
        nome,
        previsto: data.previsto ?? null,
        motorista: data.motorista ?? null,
        criado_por: userId,
      })
      .select("id")
      .single();
    if (error) {
      // Corrida: se colidiu em UNIQUE, responde em_uso
      if ((error as { code?: string }).code === "23505") {
        return { resultado: "em_uso" as const, dono: null };
      }
      throw new Error(error.message);
    }
    return { resultado: "ok" as const, id: inserido.id };
  });

export const liberarRotaLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    baseDiaSchema.extend({ nome: z.string().trim().min(1).max(60) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const baseId = await resolveBaseOperacionalAutorizada(supabase, userId, data.baseId);
    const nome = data.nome.toUpperCase();
    const { error } = await supabase
      .from("contagens_rotas_lock")
      .delete()
      .eq("base_id", baseId)
      .eq("data_operacional", data.diaOperacional)
      .eq("nome", nome);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
