-- Migration B (RASCUNHO — NÃO APLICADA)
-- Objetivo: adição puramente aditiva de colunas, FKs e índices em
--   public.recebimentos e um índice único parcial em public.importacoes_escala.
-- Pré-condições verificadas (2026-07-13, read-only):
--   * bases.id, escalas.id, importacoes_escala.id são UUID.
--   * Nenhuma FK/coluna homônima existe em public.recebimentos.
--   * 0 duplicatas em (base_id, data_operacional) WHERE ativa=true.
--   * 322 recebimentos, 6 importações, 8631 escalas, 518 audit_logs.
-- Proibido: backfill, UPDATE, DELETE, DROP, alterar base_id, alterar RLS,
--   criar RPC, mudar permissões, tocar em dados históricos.

BEGIN;

-- 1) Colunas aditivas (todas NULL, sem default de dado).
ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS base_leitura_id  uuid NULL,
  ADD COLUMN IF NOT EXISTS base_rota_id     uuid NULL,
  ADD COLUMN IF NOT EXISTS escala_id        uuid NULL,
  ADD COLUMN IF NOT EXISTS importacao_id    uuid NULL,
  ADD COLUMN IF NOT EXISTS client_event_id  uuid NULL,
  ADD COLUMN IF NOT EXISTS origem_migracao  text NULL;

-- 2) Foreign keys — verificação vinculada à tabela (conrelid).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recebimentos_base_leitura_id_fkey'
      AND conrelid = 'public.recebimentos'::regclass
  ) THEN
    ALTER TABLE public.recebimentos
      ADD CONSTRAINT recebimentos_base_leitura_id_fkey
      FOREIGN KEY (base_leitura_id) REFERENCES public.bases(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recebimentos_base_rota_id_fkey'
      AND conrelid = 'public.recebimentos'::regclass
  ) THEN
    ALTER TABLE public.recebimentos
      ADD CONSTRAINT recebimentos_base_rota_id_fkey
      FOREIGN KEY (base_rota_id) REFERENCES public.bases(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recebimentos_escala_id_fkey'
      AND conrelid = 'public.recebimentos'::regclass
  ) THEN
    ALTER TABLE public.recebimentos
      ADD CONSTRAINT recebimentos_escala_id_fkey
      FOREIGN KEY (escala_id) REFERENCES public.escalas(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recebimentos_importacao_id_fkey'
      AND conrelid = 'public.recebimentos'::regclass
  ) THEN
    ALTER TABLE public.recebimentos
      ADD CONSTRAINT recebimentos_importacao_id_fkey
      FOREIGN KEY (importacao_id) REFERENCES public.importacoes_escala(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3) Índices — nomes checados antes; nenhum existe hoje.
CREATE INDEX IF NOT EXISTS idx_recebimentos_base_leitura_dia
  ON public.recebimentos (base_leitura_id, data_operacional);

CREATE INDEX IF NOT EXISTS idx_recebimentos_base_rota
  ON public.recebimentos (base_rota_id);

CREATE INDEX IF NOT EXISTS idx_recebimentos_importacao
  ON public.recebimentos (importacao_id);

CREATE INDEX IF NOT EXISTS idx_recebimentos_escala
  ON public.recebimentos (escala_id);

-- Idempotência de retry por operador (client_event_id começa 100% NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_recebimentos_operador_client_event
  ON public.recebimentos (operador_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

-- Uma única importação ativa por (base, data). Dry-run: 0 conflitos.
-- Regra: se aparecer QUALQUER conflito no momento da aplicação, abortar
-- a migration B inteira. Não arquivar registros automaticamente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_imp_escala_ativa_por_base_data
  ON public.importacoes_escala (base_id, data_operacional)
  WHERE ativa = true;

COMMIT;

-- Rollback permitido SOMENTE imediatamente após esta migração, antes de
-- qualquer RPC ou frontend gravar nas colunas novas:
--
-- BEGIN;
-- DROP INDEX IF EXISTS public.uq_imp_escala_ativa_por_base_data;
-- DROP INDEX IF EXISTS public.uq_recebimentos_operador_client_event;
-- DROP INDEX IF EXISTS public.idx_recebimentos_escala;
-- DROP INDEX IF EXISTS public.idx_recebimentos_importacao;
-- DROP INDEX IF EXISTS public.idx_recebimentos_base_rota;
-- DROP INDEX IF EXISTS public.idx_recebimentos_base_leitura_dia;
-- ALTER TABLE public.recebimentos
--   DROP CONSTRAINT IF EXISTS recebimentos_importacao_id_fkey,
--   DROP CONSTRAINT IF EXISTS recebimentos_escala_id_fkey,
--   DROP CONSTRAINT IF EXISTS recebimentos_base_rota_id_fkey,
--   DROP CONSTRAINT IF EXISTS recebimentos_base_leitura_id_fkey,
--   DROP COLUMN IF EXISTS origem_migracao,
--   DROP COLUMN IF EXISTS client_event_id,
--   DROP COLUMN IF EXISTS importacao_id,
--   DROP COLUMN IF EXISTS escala_id,
--   DROP COLUMN IF EXISTS base_rota_id,
--   DROP COLUMN IF EXISTS base_leitura_id;
-- COMMIT;
--
-- Depois que qualquer coluna nova receber dados, DROP COLUMN NÃO é rollback.
-- Reverter apenas código/RPC/policy/flag, preservando colunas e dados.