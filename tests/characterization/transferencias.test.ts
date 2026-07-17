import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  caminhoEvidenciaTransferencia,
  proximaEtapa,
  type TransferenciaEvento,
} from "../../src/lib/transferencias.functions";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260714143500_transferencias_module.sql"),
  "utf8",
);
const loteSource = readFileSync(
  resolve(process.cwd(), "src/lib/transferencias-lote.functions.ts"),
  "utf8",
);
const gerencialSource = readFileSync(
  resolve(process.cwd(), "src/lib/gerencial.functions.ts"),
  "utf8",
);
const saidaXptMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260717110000_transferencias_saida_xpt.sql"),
  "utf8",
);
const correcaoEtapaMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260717143000_corrigir_etapa_transferencia.sql"),
  "utf8",
);
const pageSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/transferencias.tsx"),
  "utf8",
);

function evento(etapa: TransferenciaEvento["etapa"]): TransferenciaEvento {
  return {
    id: etapa,
    etapa,
    ocorrido_em: "2026-07-14T10:00:00.000Z",
    localizacao_texto: null,
    minutos_atraso: 0,
    registrado_por: "00000000-0000-4000-8000-000000000001",
  };
}

describe("Transferências — fluxo operacional", () => {
  it("exige os quatro marcos na ordem Service → Service → XPT → XPT", () => {
    expect(proximaEtapa([])).toBe("chegada_service");
    expect(proximaEtapa([evento("chegada_service")])).toBe("saida_service");
    expect(proximaEtapa([evento("chegada_service"), evento("saida_service")])).toBe("chegada_xpt");
    expect(proximaEtapa([evento("chegada_service"), evento("saida_service"), evento("chegada_xpt")])).toBe("saida_xpt");
    expect(proximaEtapa([evento("chegada_service"), evento("saida_service"), evento("chegada_xpt"), evento("saida_xpt")])).toBeNull();
  });

  it("cria caminho privado segmentado por base e transferência", () => {
    const path = caminhoEvidenciaTransferencia(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "chegada_service",
      "Foto caminhão.JPG",
    );
    expect(path).toMatch(
      /^11111111-1111-4111-8111-111111111111\/22222222-2222-4222-8222-222222222222\/chegada_service-[0-9a-f-]+\.jpg$/,
    );
  });

  it("permite registrar os três marcos também pela operação em lote", () => {
    expect(loteSource).toContain('z.enum(["chegada_service", "saida_service", "chegada_xpt", "saida_xpt"])');
  });

  it("mantém as três primeiras etapas funcionando enquanto a função v2 não está no banco", () => {
    expect(loteSource).toContain('rpc("registrar_evento_transferencia"');
    expect(loteSource).toContain('data.etapa !== "saida_xpt"');
    expect(readFileSync(resolve(process.cwd(), "src/lib/transferencias.functions.ts"), "utf8")).toContain("As três etapas anteriores continuam disponíveis");
  });

  it("prioriza no gerencial a disponibilidade da JM e a espera por carga no Service", () => {
    expect(gerencialSource).toContain("disponibilizados_ate_7");
    expect(gerencialSource).toContain("aguardando_carga");
    expect(gerencialSource).toContain("saidas_apos_9");
    expect(gerencialSource).toContain("t.permanencia");
  });
});

describe("Transferências — saída do XPT", () => {
  it("adiciona a quarta etapa sem remover tabelas ou dados", () => {
    expect(saidaXptMigration).toContain("'chegada_xpt', 'saida_xpt'");
    expect(saidaXptMigration).toContain("'no_xpt'");
    expect(saidaXptMigration).toContain("registrar_evento_transferencia_v2");
    expect(saidaXptMigration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(saidaXptMigration).not.toMatch(/\bTRUNCATE\b/i);
    expect(saidaXptMigration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("mantém evidência opcional e conclui somente na saída do XPT", () => {
    expect(saidaXptMigration).toContain("IF v_evidencia THEN");
    expect(saidaXptMigration).toContain("WHEN p_etapa = 'saida_xpt'");
    expect(saidaXptMigration).toContain("IF v_etapa = 'chegada_xpt' THEN RETURN 'no_xpt'");
  });

  it("vincula as quatro bases aos Services definidos", () => {
    expect(pageSource).toContain('if (base.includes("ibiuna")) return "SSP20";');
    expect(pageSource).toContain('if (base.includes("guaruja")) return "SSP15";');
    expect(pageSource).toContain('if (base.includes("embu")) return "SSP34";');
    expect(pageSource).toContain('if (base.includes("franco")) return "SSP25";');
  });
});

describe("Transferências — operação inline", () => {
  it("mostra o Service da base e cria quantas linhas de rota forem necessárias", () => {
    expect(pageSource).toContain("serviceBase ? (");
    expect(pageSource).toContain("Nova rota");
    expect(pageSource).toContain("[...atual, novoRascunho");
    expect(pageSource).toContain("RascunhoRotaRow");
  });

  it("mantém edição, exclusão, conclusão e marcos dentro da tabela", () => {
    expect(pageSource).toContain("EditarRotaRow");
    expect(pageSource).toContain("EtapaFormCells");
    expect(pageSource).toContain("Link TimeMark ou evidência");
    expect(pageSource).toContain('type="file"');
    expect(pageSource).toContain("Salvar etapa");
    expect(pageSource).toContain("Editar etapa");
    expect(pageSource).toContain("Salvar correção");
    expect(pageSource).toContain("timemarkUrl: timemark");
    expect(pageSource).toContain("storagePath");
    expect(pageSource).toContain('title="Excluir rota"');
    expect(pageSource).toContain('title={proxima === "saida_xpt" ? "Concluir transferência"');
  });

  it("destaca a prova de espera por carga e mantém o deslocamento como complementar", () => {
    expect(pageSource).toContain("Disponibilizados até 07h");
    expect(pageSource).toContain("Tempo aguardando carga");
    expect(pageSource).toContain("Saídas após 09h (MELI)");
    expect(pageSource).toContain("deslocamento até o XPT continua registrado como dado complementar");
  });

  it("audita a correção da etapa e impede quebra da ordem cronológica", () => {
    const funcoes = readFileSync(resolve(process.cwd(), "src/lib/transferencias.functions.ts"), "utf8");
    expect(funcoes).toContain('acao: "transferencia.evento.corrigir"');
    expect(funcoes).toContain("O horário não pode ser anterior à etapa precedente");
    expect(funcoes).toContain("O horário não pode ser posterior à etapa seguinte");
    expect(funcoes).toContain("foto_substituida");
    expect(funcoes).toContain("link_corrigido");
  });

  it("corrige a etapa por RPC autenticada sem depender de chave secreta no Vercel", () => {
    const funcoes = readFileSync(resolve(process.cwd(), "src/lib/transferencias.functions.ts"), "utf8");
    expect(funcoes).toContain('"corrigir_etapa_transferencia"');
    expect(correcaoEtapaMigration).toContain("SECURITY DEFINER");
    expect(correcaoEtapaMigration).toContain("transferencia_base_access(v_uid, v_t.base_id)");
    expect(correcaoEtapaMigration).toContain("GRANT EXECUTE ON FUNCTION public.corrigir_etapa_transferencia");
    expect(correcaoEtapaMigration).not.toMatch(/\bDROP\s+TABLE\b|\bTRUNCATE\b/i);
  });

  it("edita pela política de acesso existente e mantém auditoria", () => {
    expect(migration).toContain('CREATE POLICY "transferencias update base"');
    expect(migration).toContain("transferencia_base_access(auth.uid(), base_id)");
    expect(pageSource).toContain("excluirMutation");
    expect(readFileSync(resolve(process.cwd(), "src/lib/transferencias.functions.ts"), "utf8")).toContain('acao: "transferencia.editar"');
  });
});

describe("Transferências — segurança e integridade SQL", () => {
  it("libera visão global somente para admin e prende demais ao profiles.base_id", () => {
    const inicio = migration.indexOf("CREATE OR REPLACE FUNCTION public.transferencia_base_access");
    const fim = migration.indexOf("CREATE OR REPLACE FUNCTION public.transferencia_access", inicio);
    const corpo = migration.slice(inicio, fim);
    expect(corpo).toContain("public.has_role(_user_id, 'admin')");
    expect(corpo).toContain("OR p.base_id = _base_id");
    expect(corpo).toContain("p.ativo = true");
    expect(corpo).not.toContain("'gerente'");
    expect(corpo).not.toContain("user_bases");
  });

  it("mantém todas as tabelas operacionais com RLS", () => {
    for (const tabela of [
      "transferencias",
      "transferencia_eventos",
      "transferencia_ocorrencias",
      "transferencia_evidencias",
      "transferencia_motivos",
      "transferencia_slas",
    ]) {
      expect(migration).toContain(`ALTER TABLE public.${tabela} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("não cria policy de DELETE para dados operacionais", () => {
    expect(migration).not.toMatch(/ON public\.transferencias\s+FOR DELETE/);
    expect(migration).not.toMatch(/ON public\.transferencia_eventos\s+FOR DELETE/);
    expect(migration).not.toMatch(/ON public\.transferencia_evidencias\s+FOR DELETE/);
  });

  it("mantém as fotos em bucket privado e limitado a imagens", () => {
    expect(migration).toContain("'transferencias-evidencias', 'transferencias-evidencias', false");
    expect(migration).toContain("10485760");
    expect(migration).toContain("'image/jpeg', 'image/png', 'image/webp'");
    expect(migration).toContain("public.transferencia_access(auth.uid()");
  });

  it("executa criação, marco e cancelamento em RPCs SECURITY DEFINER", () => {
    for (const nome of [
      "criar_transferencia",
      "registrar_evento_transferencia",
      "anexar_evidencia_transferencia",
      "cancelar_transferencia",
      "salvar_sla_transferencia",
    ]) {
      const inicio = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}`);
      expect(inicio).toBeGreaterThan(0);
      const corpo = migration.slice(inicio, inicio + 1200);
      expect(corpo).toContain("SECURITY DEFINER");
      expect(corpo).toContain("SET search_path = public, pg_temp");
    }
  });

  it("usa os SLAs iniciais 07:00, 09:00 e 60 minutos", () => {
    expect(migration).toContain("chegada_service_limite time NOT NULL DEFAULT '07:00'");
    expect(migration).toContain("saida_service_limite time NOT NULL DEFAULT '09:00'");
    expect(migration).toContain("transito_max_minutos integer NOT NULL DEFAULT 60");
    expect(migration).toContain("make_interval(mins => v_transito_max)");
  });

  it("audita criação, cada marco, evidência e cancelamento", () => {
    expect(migration).toContain("'transferencia.criar'");
    expect(migration).toContain("'transferencia.evento.' || p_etapa");
    expect(migration).toContain("'transferencia.evidencia.anexar'");
    expect(migration).toContain("'transferencia.cancelar'");
    expect(migration).toContain("'transferencia.sla.salvar'");
  });

  it("rejeita avanço fora de ordem e etapa duplicada", () => {
    expect(migration).toContain("'etapa_ja_registrada'");
    expect(migration).toContain("'registre_chegada_service_primeiro'");
    expect(migration).toContain("'registre_saida_service_primeiro'");
    expect(migration).toContain("UNIQUE (transferencia_id, etapa)");
  });

  it("não contém DROP TABLE, TRUNCATE nem DELETE de dados", () => {
    const executavel = migration
      .split("\n")
      .filter((linha) => !linha.trimStart().startsWith("--"))
      .join("\n");
    expect(executavel).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(executavel).not.toMatch(/\bTRUNCATE\b/i);
    expect(executavel).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
