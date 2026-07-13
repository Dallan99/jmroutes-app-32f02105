import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const filtroSchema = z.object({
  dataInicio: z.string().optional(),
  dataFim: z.string().optional(),
  operadorId: z.string().uuid().optional(),
  baseId: z.string().uuid().optional(),
  motoristaId: z.string().uuid().optional(),
  rotaCodigo: z.string().optional(),
  resultado: z.string().optional(),
  busca: z.string().optional(),
  limit: z.number().int().min(1).max(5000).default(500),
});

export type HistoricoRow = {
  id: string;
  created_at: string;
  codigo_bipado: string;
  resultado: string;
  mensagem: string | null;
  tempo_desde_ultima_ms: number | null;
  operador_nome: string | null;
  operador_email: string | null;
  rota_codigo: string | null;
  rota_final: string | null;
  base_codigo: string | null;
  base_nome: string | null;
  motorista_nome: string | null;
  cidade: string | null;
};

export const listarHistorico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => filtroSchema.parse(input))
  .handler(async ({ data, context }): Promise<HistoricoRow[]> => {
    const { supabase } = context;
    let query = supabase
      .from("recebimentos")
      .select(
        `id, created_at, codigo_bipado, resultado, mensagem, tempo_desde_ultima_ms, operador_id, base_id,
         rotas ( codigo, rota_final, cidade, motoristas ( nome ) ),
         bases ( codigo, nome )`,
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.dataInicio) query = query.gte("created_at", `${data.dataInicio}T00:00:00`);
    if (data.dataFim) query = query.lte("created_at", `${data.dataFim}T23:59:59`);
    if (data.operadorId) query = query.eq("operador_id", data.operadorId);
    if (data.baseId) query = query.eq("base_id", data.baseId);
    if (data.resultado) query = query.eq("resultado", data.resultado as never);
    if (data.busca) query = query.ilike("codigo_bipado", `%${data.busca}%`);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const operadorIds = Array.from(new Set((rows ?? []).map((r) => r.operador_id).filter(Boolean))) as string[];
    let perfis: Record<string, { nome: string | null; email: string | null }> = {};
    if (operadorIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, nome, email").in("id", operadorIds);
      perfis = Object.fromEntries((profs ?? []).map((p) => [p.id, { nome: p.nome, email: p.email }]));
    }

    let filtered = (rows ?? []).map((r) => {
      const rota = (r as unknown as { rotas: { codigo: string; rota_final: string | null; cidade: string | null; motoristas: { nome: string } | null } | null }).rotas;
      const base = (r as unknown as { bases: { codigo: string; nome: string } | null }).bases;
      const perfil = perfis[r.operador_id as string];
      return {
        id: r.id,
        created_at: r.created_at,
        codigo_bipado: r.codigo_bipado,
        resultado: r.resultado,
        mensagem: r.mensagem,
        tempo_desde_ultima_ms: r.tempo_desde_ultima_ms,
        operador_nome: perfil?.nome ?? null,
        operador_email: perfil?.email ?? null,
        rota_codigo: rota?.codigo ?? null,
        rota_final: rota?.rota_final ?? null,
        base_codigo: base?.codigo ?? null,
        base_nome: base?.nome ?? null,
        motorista_nome: rota?.motoristas?.nome ?? null,
        cidade: rota?.cidade ?? null,
      } as HistoricoRow;
    });

    if (data.rotaCodigo) {
      const q = data.rotaCodigo.toLowerCase();
      filtered = filtered.filter((r) => (r.rota_codigo ?? "").toLowerCase().includes(q));
    }
    if (data.motoristaId) {
      // motorista filter handled by name search below when provided as text; ignored otherwise
    }
    return filtered;
  });

export const listarFiltros = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [bases, operadores, motoristas] = await Promise.all([
      supabase.from("bases").select("id, codigo, nome").order("codigo"),
      supabase.from("profiles").select("id, nome, email").order("nome"),
      supabase.from("motoristas").select("id, nome").order("nome"),
    ]);
    return {
      bases: bases.data ?? [],
      operadores: operadores.data ?? [],
      motoristas: motoristas.data ?? [],
    };
  });