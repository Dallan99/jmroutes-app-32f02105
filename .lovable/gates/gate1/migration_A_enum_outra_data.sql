-- Migration A (RASCUNHO — NÃO APLICADA)
-- Objetivo: adicionar o valor 'outra_data' ao enum public.recebimento_resultado.
-- Restrições:
--   * NÃO usar o novo valor na mesma migration.
--   * Rollback NÃO é um DROP simples de valor de enum (PostgreSQL não suporta
--     remoção segura de valor). Rollback só via restauração do backup pré-migration.

ALTER TYPE public.recebimento_resultado
  ADD VALUE IF NOT EXISTS 'outra_data';

-- Validação read-only esperada após aplicação:
-- SELECT unnest(enum_range(NULL::public.recebimento_resultado))::text
-- deve retornar exatamente:
--   cancelada, duplicado, encerrada, inexistente, ok,
--   outra_base, outra_data, outra_rota, volume_repetido