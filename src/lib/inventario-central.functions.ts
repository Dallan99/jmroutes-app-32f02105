import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type InventarioCentralLinha = {
  id: string;
  inventario_id: string;
  base_id: string;
  base_codigo: string;
  base_nome: string;
  dia_operacional: string;
  codigo: string;
  bipado_em: string;
  bipado_por: string;
  bipado_por_nome: string | null;
  cancelado: boolean;
};

export type InventarioCentralResumo = {
  id: string;
  base_id: string;
  base_codigo: string;
  base_nome: string;
  dia_operacional: string;
  responsavel: string | null;
  observacao: string | null;
  status: string;
  criado_por: string;
  criado_por_nome: string | null;
  finalizado_em: string | null;
  total_leituras: number;
};

export const listarBasesInventario = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as any;
    const { data, error } = await supabase.from("bases").select("id, codigo, nome, cidade").order("nome");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listarInventarioCentral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      inicio: ymd,
      fim: ymd,
      baseId: z.string().uuid().optional(),
      codigo: z.string().trim().max(120).optional(),
      usuario: z.string().trim().max(160).optional(),
      status: z.enum(["todos", "aberto", "finalizado", "cancelado"]).default("todos"),
    }).refine((v) => v.inicio <= v.fim, { message: "Período inválido." }).parse(input),
  )
  .handler(async ({ data: filtros, context }): Promise<{ inventarios: InventarioCentralResumo[]; leituras: InventarioCentralLinha[]; isAdmin: boolean }> => {
    const supabase = context.supabase as any;
    const { userId } = context;

    const [{ data: roles }, { data: perfil }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles").select("base_id, ativo").eq("id", userId).maybeSingle(),
    ]);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin") && perfil?.ativo !== false;

    let invQuery = supabase
      .from("inventarios")
      .select("id, base_id, dia_operacional, responsavel, observacao, status, criado_por, finalizado_em, created_at")
      .gte("dia_operacional", filtros.inicio)
      .lte("dia_operacional", filtros.fim)
      .order("dia_operacional", { ascending: false })
      .order("created_at", { ascending: false });
    if (filtros.baseId) invQuery = invQuery.eq("base_id", filtros.baseId);
    if (filtros.status !== "todos") invQuery = invQuery.eq("status", filtros.status);
    const { data: inventariosRaw, error: invError } = await invQuery;
    if (invError) throw new Error(invError.message);

    const inventarioIds = (inventariosRaw ?? []).map((x: any) => x.id);
    if (!inventarioIds.length) return { inventarios: [], leituras: [], isAdmin };

    let leitQuery = supabase
      .from("inventario_leituras")
      .select("id, inventario_id, base_id, dia_operacional, codigo, bipado_em, bipado_por, cancelado")
      .in("inventario_id", inventarioIds)
      .order("bipado_em", { ascending: false });
    if (filtros.codigo) leitQuery = leitQuery.ilike("codigo", `%${filtros.codigo}%`);
    const { data: leiturasRaw, error: leitError } = await leitQuery;
    if (leitError) throw new Error(leitError.message);

    const baseIds = Array.from(new Set((inventariosRaw ?? []).map((x: any) => x.base_id)));
    const userIds = Array.from(new Set([
      ...(inventariosRaw ?? []).map((x: any) => x.criado_por),
      ...(leiturasRaw ?? []).map((x: any) => x.bipado_por),
    ].filter(Boolean)));

    const [{ data: bases }, { data: perfis }] = await Promise.all([
      supabase.from("bases").select("id, codigo, nome").in("id", baseIds),
      userIds.length ? supabase.from("profiles").select("id, nome").in("id", userIds) : Promise.resolve({ data: [] }),
    ]);
    const baseMap = new Map((bases ?? []).map((b: any) => [b.id, b]));
    const perfilMap = new Map((perfis ?? []).map((p: any) => [p.id, p.nome]));

    let leituras = (leiturasRaw ?? []).map((l: any) => {
      const b = baseMap.get(l.base_id) as any;
      return {
        ...l,
        base_codigo: b?.codigo ?? "—",
        base_nome: b?.nome ?? "Base não encontrada",
        bipado_por_nome: perfilMap.get(l.bipado_por) ?? null,
      } as InventarioCentralLinha;
    });
    if (filtros.usuario) {
      const termo = filtros.usuario.toLocaleUpperCase("pt-BR");
      leituras = leituras.filter((l) => (l.bipado_por_nome ?? "").toLocaleUpperCase("pt-BR").includes(termo));
    }

    const totalPorInventario = new Map<string, number>();
    for (const l of leituras.filter((x) => !x.cancelado)) {
      totalPorInventario.set(l.inventario_id, (totalPorInventario.get(l.inventario_id) ?? 0) + 1);
    }

    const inventarios = (inventariosRaw ?? []).map((i: any) => {
      const b = baseMap.get(i.base_id) as any;
      return {
        ...i,
        base_codigo: b?.codigo ?? "—",
        base_nome: b?.nome ?? "Base não encontrada",
        criado_por_nome: perfilMap.get(i.criado_por) ?? null,
        total_leituras: totalPorInventario.get(i.id) ?? 0,
      } as InventarioCentralResumo;
    });

    return { inventarios, leituras, isAdmin };
  });

export const registrarLeituraInventarioCentral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    baseId: z.string().uuid(),
    diaOperacional: ymd,
    codigo: z.string().trim().min(1).max(120),
    responsavel: z.string().trim().max(160).optional(),
    observacao: z.string().trim().max(1000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: result, error } = await supabase.rpc("registrar_leitura_inventario", {
      p_base_id: data.baseId,
      p_dia_operacional: data.diaOperacional,
      p_codigo: data.codigo,
      p_responsavel: data.responsavel || null,
      p_observacao: data.observacao || null,
    });
    if (error) throw new Error(error.message);
    return result as { resultado: "ok" | "duplicado"; mensagem: string; inventario_id?: string; leitura_id?: string };
  });

export const finalizarInventarioCentral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ inventarioId: z.string().uuid(), observacao: z.string().trim().max(1000).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: result, error } = await supabase.rpc("finalizar_inventario", {
      p_inventario_id: data.inventarioId,
      p_observacao: data.observacao || null,
    });
    if (error) throw new Error(error.message);
    return result;
  });
