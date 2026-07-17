import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type BaseAtiva = {
  id: string;
  data_operacional: string;
  status: "aguardando" | "ativa" | "arquivada" | "erro";
  facility: string | null;
  transportadora: string | null;
  escala_jm_nome: string | null;
  escala_jm_hora: string | null;
  escala_jm_rotas: number;
  escala_jm_pacotes: number;
  escala_xpt_nome: string | null;
  escala_xpt_hora: string | null;
  escala_xpt_shipments: number;
  escala_xpt_rotas: number;
  total_rotas: number;
  total_shipments: number;
  total_motoristas: number;
  total_veiculos: number;
  total_bairros: number;
  total_cidades: number;
  total_pacotes: number;
  importado_por: string | null;
  importado_por_nome: string | null;
  ativada_em: string | null;
  updated_at: string;
};

// ============ helpers ============

async function upsertBaseDoDia(supabase: any, userId: string, dataRef: string) {
  const { data: existente } = await supabase
    .from("bases_operacionais")
    .select("id, status")
    .eq("data_operacional", dataRef)
    .maybeSingle();
  if (existente) return existente as { id: string; status: string };
  const { data, error } = await supabase
    .from("bases_operacionais")
    .insert({ data_operacional: dataRef, status: "aguardando", importado_por: userId })
    .select("id, status")
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string; status: string };
}

async function nomeDoUsuario(supabase: any, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase.from("profiles").select("nome").eq("id", userId).maybeSingle();
  return (data?.nome as string) ?? null;
}

// ============ getBaseAtiva ============

export const getBaseAtiva = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BaseAtiva | null> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("bases_operacionais")
      .select("*")
      .eq("status", "ativa")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const nome = await nomeDoUsuario(supabase, data.importado_por);
    return { ...data, importado_por_nome: nome } as BaseAtiva;
  });

// ============ getBaseDoDia (rascunho + ativa do dia) ============

export const getBaseDoDia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dataRef?: string }) =>
    z
      .object({
        dataRef: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<BaseAtiva | null> => {
    const { supabase } = context;
    const dataRef = data.dataRef ?? new Date().toISOString().slice(0, 10);
    const { data: base, error } = await supabase
      .from("bases_operacionais")
      .select("*")
      .eq("data_operacional", dataRef)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!base) return null;
    const nome = await nomeDoUsuario(supabase, base.importado_por);
    return { ...base, importado_por_nome: nome } as BaseAtiva;
  });

// ============ Historico ============

export const listarHistoricoBases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("bases_operacionais")
      .select("*")
      .order("data_operacional", { ascending: false })
      .limit(90);
    if (error) throw new Error(error.message);
    // enriquecer com nome do usuário
    const ids = Array.from(new Set((data ?? []).map((b: any) => b.importado_por).filter(Boolean)));
    const nomes = new Map<string, string>();
    if (ids.length) {
      const { data: perfis } = await supabase
        .from("profiles")
        .select("id, nome")
        .in("id", ids as string[]);
      for (const p of perfis ?? []) nomes.set(p.id, p.nome ?? "—");
    }
    return (data ?? []).map((b: any) => ({
      ...b,
      importado_por_nome: nomes.get(b.importado_por) ?? null,
    }));
  });

// ============ Importar Escala JM ============

const linhaJMSchema = z.object({
  planejada: z.string().nullish(),
  otimizada: z.string().nullish(),
  pacotes: z.number().int().nullish(),
  paradas: z.number().int().nullish(),
  modal: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  giro: z.string().nullish(),
  vaga: z.string().nullish(),
  tipo: z.string().nullish(),
  roteiro: z.string().nullish(),
  placa: z.string().nullish(),
  driver: z.string().nullish(),
  placa_troca: z.string().nullish(),
});

export type ValidacaoErro = { linha: number; campo: string; motivo: string };

function validarJM(linhas: z.infer<typeof linhaJMSchema>[]): ValidacaoErro[] {
  const erros: ValidacaoErro[] = [];
  if (!linhas.length) erros.push({ linha: 0, campo: "arquivo", motivo: "Arquivo vazio." });
  const chaves = new Set<string>();
  linhas.forEach((l, i) => {
    const n = i + 2; // linha do excel considerando header
    if (!l.driver) erros.push({ linha: n, campo: "driver", motivo: "Motorista obrigatório." });
    if (!l.placa) erros.push({ linha: n, campo: "placa", motivo: "Placa obrigatória." });
    if (l.pacotes == null || l.pacotes <= 0)
      erros.push({ linha: n, campo: "pacotes", motivo: "Pacotes deve ser > 0." });
    const chave = `${l.planejada ?? ""}|${l.driver ?? ""}`;
    if (chaves.has(chave)) erros.push({ linha: n, campo: "planejada", motivo: "Linha duplicada." });
    chaves.add(chave);
  });
  return erros;
}

export const importarEscalaJM = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        dataRef: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        arquivoNome: z.string().min(1).max(200),
        facility: z.string().nullish(),
        transportadora: z.string().nullish(),
        linhas: z.array(linhaJMSchema).max(5000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const dataRef = data.dataRef ?? new Date().toISOString().slice(0, 10);
    const erros = validarJM(data.linhas);
    if (erros.length) return { ok: false, erros, importadas: 0 };

    const base = await upsertBaseDoDia(supabase, userId, dataRef);

    // limpa importações anteriores da JM nesta base
    await supabase.from("escalas").delete().eq("base_operacional_id", base.id);

    const rows = data.linhas.map((l) => ({
      base_operacional_id: base.id,
      data_referencia: dataRef,
      planejada: l.planejada ?? null,
      otimizada: l.otimizada ?? null,
      pacotes: l.pacotes ?? null,
      paradas: l.paradas ?? null,
      modal: l.modal ?? null,
      bairro: l.bairro ?? null,
      cidade: l.cidade ?? null,
      giro: l.giro ?? null,
      vaga: l.vaga ?? null,
      tipo: l.tipo ?? null,
      roteiro: l.roteiro ?? null,
      placa: l.placa ?? null,
      driver: l.driver ?? null,
      placa_troca: l.placa_troca ?? null,
      importado_por: userId,
    }));
    if (rows.length) {
      const { error } = await supabase.from("escalas").insert(rows);
      if (error) throw new Error(error.message);
    }

    const totalPacotes = data.linhas.reduce((s, l) => s + (l.pacotes ?? 0), 0);
    await supabase
      .from("bases_operacionais")
      .update({
        escala_jm_nome: data.arquivoNome,
        escala_jm_hora: new Date().toISOString(),
        escala_jm_rotas: data.linhas.length,
        escala_jm_pacotes: totalPacotes,
        facility: data.facility ?? undefined,
        transportadora: data.transportadora ?? undefined,
        importado_por: userId,
      })
      .eq("id", base.id);

    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(supabase as any, userId, {
      acao: "base.import.jm",
      entidade: "bases_operacionais",
      entidade_id: base.id,
      detalhes: { linhas: data.linhas.length, arquivo: data.arquivoNome },
    });

    return { ok: true, erros: [], importadas: data.linhas.length, baseId: base.id };
  });

// ============ Importar Escala XPT ============

const linhaXPTSchema = z.object({
  shipment_id: z.string().min(1),
  rota: z.string().nullish(),
  motorista: z.string().nullish(),
  placa: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  pacotes: z.number().int().nullish(),
});

function validarXPT(linhas: z.infer<typeof linhaXPTSchema>[]): ValidacaoErro[] {
  const erros: ValidacaoErro[] = [];
  if (!linhas.length) erros.push({ linha: 0, campo: "arquivo", motivo: "Arquivo vazio." });
  const ids = new Set<string>();
  linhas.forEach((l, i) => {
    const n = i + 2;
    if (!l.shipment_id)
      erros.push({ linha: n, campo: "shipment_id", motivo: "Shipment ID obrigatório." });
    if (!l.rota) erros.push({ linha: n, campo: "rota", motivo: "Rota obrigatória." });
    if (ids.has(l.shipment_id))
      erros.push({ linha: n, campo: "shipment_id", motivo: "Shipment duplicado." });
    ids.add(l.shipment_id);
  });
  return erros;
}

export const importarEscalaXPT = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        dataRef: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        arquivoNome: z.string().min(1).max(200),
        linhas: z.array(linhaXPTSchema).max(10000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const dataRef = data.dataRef ?? new Date().toISOString().slice(0, 10);
    const erros = validarXPT(data.linhas);
    if (erros.length) return { ok: false, erros, importadas: 0 };

    const base = await upsertBaseDoDia(supabase, userId, dataRef);

    await supabase.from("shipments").delete().eq("base_operacional_id", base.id);

    const rows = data.linhas.map((l) => ({
      base_operacional_id: base.id,
      shipment_id: l.shipment_id,
      rota: l.rota ?? null,
      motorista: l.motorista ?? null,
      placa: l.placa ?? null,
      bairro: l.bairro ?? null,
      cidade: l.cidade ?? null,
      pacotes: l.pacotes ?? 0,
    }));
    if (rows.length) {
      const { error } = await supabase.from("shipments").insert(rows);
      if (error) throw new Error(error.message);
    }

    const rotas = new Set(data.linhas.map((l) => l.rota).filter(Boolean));
    await supabase
      .from("bases_operacionais")
      .update({
        escala_xpt_nome: data.arquivoNome,
        escala_xpt_hora: new Date().toISOString(),
        escala_xpt_shipments: data.linhas.length,
        escala_xpt_rotas: rotas.size,
      })
      .eq("id", base.id);

    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(supabase as any, userId, {
      acao: "base.import.xpt",
      entidade: "bases_operacionais",
      entidade_id: base.id,
      detalhes: { shipments: data.linhas.length, arquivo: data.arquivoNome },
    });

    return { ok: true, erros: [], importadas: data.linhas.length, baseId: base.id };
  });

// ============ Ativar Base ============

export const ativarBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ baseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // valida que ambas planilhas foram importadas
    const { data: base, error: e0 } = await supabase
      .from("bases_operacionais")
      .select("*")
      .eq("id", data.baseId)
      .single();
    if (e0) throw new Error(e0.message);
    if (!base.escala_jm_nome) throw new Error("Escala JM ainda não foi importada.");
    if (!base.escala_xpt_nome) throw new Error("Escala XPT ainda não foi importada.");

    // arquiva ativas anteriores
    await supabase.from("bases_operacionais").update({ status: "arquivada" }).eq("status", "ativa");

    // consolidar totais
    const { data: escalas } = await supabase
      .from("escalas")
      .select("driver, placa, bairro, cidade, pacotes")
      .eq("base_operacional_id", data.baseId);
    const { data: ships } = await supabase
      .from("shipments")
      .select("shipment_id, pacotes")
      .eq("base_operacional_id", data.baseId);

    const motoristas = new Set((escalas ?? []).map((e: any) => e.driver).filter(Boolean));
    const veiculos = new Set((escalas ?? []).map((e: any) => e.placa).filter(Boolean));
    const bairros = new Set((escalas ?? []).map((e: any) => e.bairro).filter(Boolean));
    const cidades = new Set((escalas ?? []).map((e: any) => e.cidade).filter(Boolean));
    const totalPacotes =
      (escalas ?? []).reduce((s: number, e: any) => s + (e.pacotes ?? 0), 0) ||
      (ships ?? []).reduce((s: number, e: any) => s + (e.pacotes ?? 0), 0);

    const { error: eUp } = await supabase
      .from("bases_operacionais")
      .update({
        status: "ativa",
        ativada_em: new Date().toISOString(),
        total_rotas: base.escala_jm_rotas ?? escalas?.length ?? 0,
        total_shipments: ships?.length ?? 0,
        total_motoristas: motoristas.size,
        total_veiculos: veiculos.size,
        total_bairros: bairros.size,
        total_cidades: cidades.size,
        total_pacotes: totalPacotes,
      })
      .eq("id", data.baseId);
    if (eUp) throw new Error(eUp.message);

    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(supabase as any, userId, {
      acao: "base.ativar",
      entidade: "bases_operacionais",
      entidade_id: data.baseId,
    });

    return { ok: true };
  });

// ============ contextoBaseOperacional (guarda de UI) ============
// Usado pelo RequireBaseOperacional para decidir se o usuário pode
// escolher base (admin) ou se está preso a profiles.base_id.

export type ContextoBaseOperacional = {
  isAdmin: boolean;
  podeSelecionarBase: boolean;
  ativo: boolean;
  baseFixa: { id: string; codigo: string; nome: string; cidade: string | null } | null;
};

export const contextoBaseOperacional = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ContextoBaseOperacional> => {
    const { supabase, userId } = context;
    const [{ data: prof }, { data: roles }, { data: extras }] = await Promise.all([
      supabase
        .from("profiles")
        .select("base_id, ativo, bases(id, codigo, nome, cidade)")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("user_bases")
        .select("base_id, bases(id, codigo, nome, cidade)")
        .eq("user_id", userId),
    ]);
    const rolesArr = (roles ?? []).map((r) => r.role as string);
    const isAdmin = rolesArr.includes("admin");
    const ativo = prof?.ativo !== false;
    const basesPermitidas = new Map<
      string,
      { id: string; codigo: string; nome: string; cidade: string | null }
    >();
    if (prof?.base_id && prof.bases) {
      const b = prof.bases as { id: string; codigo: string; nome: string; cidade: string | null };
      basesPermitidas.set(prof.base_id, {
        id: b.id ?? prof.base_id,
        codigo: b.codigo,
        nome: b.nome,
        cidade: b.cidade ?? null,
      });
    }
    for (const extra of extras ?? []) {
      const b = extra.bases as { id: string; codigo: string; nome: string; cidade: string | null } | null;
      if (b?.id) basesPermitidas.set(b.id, b);
    }
    const permitidas = Array.from(basesPermitidas.values());
    const baseFixa = !isAdmin && permitidas.length === 1 ? permitidas[0] : null;
    const podeSelecionarBase = isAdmin || permitidas.length > 1;
    return { isAdmin, podeSelecionarBase, ativo, baseFixa };
  });
