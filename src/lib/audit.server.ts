import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Extrai IP + user agent da request atual. Uso exclusivo no servidor. */
export function auditRequestMeta() {
  const req = getRequest();
  const ip =
    req?.headers.get("cf-connecting-ip") ??
    req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req?.headers.get("x-real-ip") ??
    null;
  const user_agent = req?.headers.get("user-agent") ?? null;
  return { ip, user_agent };
}

/** Grava uma entrada de auditoria. Nunca lança — best-effort. */
export async function registrarAuditInterno(
  _supabase: SupabaseClient<Database>,
  userId: string,
  input: {
    acao: string;
    entidade?: string | null;
    entidade_id?: string | null;
    detalhes?: Record<string, unknown> | null;
  },
) {
  try {
    const { ip, user_agent } = auditRequestMeta();
    // Inserts go through the service-role client so users cannot forge
    // audit records directly against the Data API (RLS blocks user inserts).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      user_id: userId,
      acao: input.acao,
      entidade: input.entidade ?? null,
      entidade_id: input.entidade_id ?? null,
      detalhes: (input.detalhes ?? null) as never,
      ip,
      user_agent,
    });
  } catch {
    // Auditoria nunca deve quebrar a operação principal.
  }
}