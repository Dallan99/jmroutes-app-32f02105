import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type AuditRow = {
  id: string;
  user_id: string | null;
  acao: string;
  entidade: string | null;
  entidade_id: string | null;
  detalhes: Json;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  usuario_nome: string | null;
  usuario_email: string | null;
};

const registrarSchema = z.object({
  acao: z.string().trim().min(2).max(80),
  entidade: z.string().trim().max(80).optional().nullable(),
  entidade_id: z.string().trim().max(120).optional().nullable(),
  detalhes: z.record(z.string(), z.unknown()).optional().nullable(),
});

/** Server fn para o cliente registrar ações (login, logout, exportação). */
export const registrarAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => registrarSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(context.supabase, context.userId, data);
    return { ok: true };
  });

const listarSchema = z.object({
  inicio: z.string().optional().nullable(),
  fim: z.string().optional().nullable(),
  acao: z.string().optional().nullable(),
  usuarioId: z.string().uuid().optional().nullable(),
  entidade: z.string().optional().nullable(),
  q: z.string().optional().nullable(),
  limit: z.number().int().positive().max(1000).optional(),
});

export const listarAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listarSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AuditRow[]> => {
    const limit = data.limit ?? 300;
    let q = context.supabase
      .from("audit_logs")
      .select("id,user_id,acao,entidade,entidade_id,detalhes,ip,user_agent,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data.inicio) q = q.gte("created_at", data.inicio);
    if (data.fim) q = q.lte("created_at", data.fim);
    if (data.acao) q = q.eq("acao", data.acao);
    if (data.entidade) q = q.eq("entidade", data.entidade);
    if (data.usuarioId) q = q.eq("user_id", data.usuarioId);
    if (data.q) q = q.ilike("acao", `%${data.q}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    const uids = Array.from(new Set(list.map((r) => r.user_id).filter((v): v is string => !!v)));
    const profileMap = new Map<string, { nome: string | null; email: string | null }>();
    if (uids.length > 0) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id,nome,email")
        .in("id", uids);
      for (const p of profs ?? []) {
        profileMap.set(p.id, { nome: p.nome ?? null, email: p.email ?? null });
      }
    }
    return list.map((r) => {
      const prof = r.user_id ? profileMap.get(r.user_id) : null;
      return {
        id: r.id,
        user_id: r.user_id,
        acao: r.acao,
        entidade: r.entidade,
        entidade_id: r.entidade_id,
        detalhes: (r.detalhes ?? null) as Json,
        ip: r.ip,
        user_agent: r.user_agent,
        created_at: r.created_at,
        usuario_nome: prof?.nome ?? null,
        usuario_email: prof?.email ?? null,
      };
    });
  });

export const listarOperadoresAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id,nome,email")
      .order("nome");
    if (error) throw new Error(error.message);
    return data ?? [];
  });