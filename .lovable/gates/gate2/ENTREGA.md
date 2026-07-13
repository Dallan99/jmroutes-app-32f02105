# Entrega — Gate 1 (rascunho) + Gate 2 (rascunho)

## A. Situação do backup

**BLOQUEADO POR AUSÊNCIA DE BACKUP CONFIRMADO.**
Não tenho como comprovar snapshot recuperável a partir deste ambiente
(sem painel de snapshots visível daqui, sem service_role, `pg_dump`
bloqueado). Instruções em `.lovable/gates/gate1/BACKUP_INSTRUCOES.md`.

## B. Migrations finais (rascunho, NÃO aplicadas)

- `.lovable/gates/gate1/migration_A_enum_outra_data.sql`
- `.lovable/gates/gate1/migration_B_recebimentos_aditiva.sql`

Ajuste solicitado aplicado: todas as verificações de FK usam
`conrelid = 'public.recebimentos'::regclass`. Tipos das PKs referenciadas
confirmados como UUID (bases.id, escalas.id, importacoes_escala.id).

## C. Aplicação

**NÃO aplicadas.** Nenhuma chamada a `supabase--migration` foi feita.
Nenhum objeto do banco foi alterado neste turno.

## D. Validação pós-migration

Não aplicável — migrations não foram executadas. Script de validação
read-only já preparado nas instruções (contagens 322/6/8631/518,
enum esperado, FKs, índices, zero colunas novas populadas, zero
conflitos de importação ativa duplicada).

## E. Diff de tipos Supabase

Não aplicável — regeneração de `src/integrations/supabase/types.ts`
ocorre somente após aplicação da migration. Nada foi alterado.

## F. SQL completo da RPC do Gate 2

`.lovable/gates/gate2/rpc_registrar_bipagem_escala.sql` — pronta,
completa, sem placeholders/reticências, `SECURITY DEFINER`,
`search_path = public, pg_temp`, `REVOKE FROM PUBLIC` + `GRANT EXECUTE
TO authenticated`. **NÃO executada.**

## G. Matriz de resultados

`.lovable/gates/gate2/matriz_resultados.md`.

## H. Testes planejados

`.lovable/gates/gate2/testes_planejados.md`.

## I. Riscos identificados

1. `ALTER TYPE ADD VALUE` é irreversível — só o backup permite rollback
   verdadeiro do Gate 1.
2. `uq_imp_escala_ativa_por_base_data` pode passar hoje (dry-run = 0),
   mas se uma nova importação ativa for criada entre este diagnóstico e
   a aplicação, o índice único aborta a migration inteira. Repetir o
   dry-run imediatamente antes de aplicar.
3. `uq_recebimentos_operador_client_event` depende de `client_event_id`
   permanecer 100% NULL até o Gate 2 entrar em produção — Fase 1 não
   escreve nesse campo.
4. RPC do Gate 2 pressupõe que o schema `escalas` não muda entre gates
   (colunas `recebido/triado`, `otimizada/planejada`, `shipment`,
   `importacao_id`, `base_id`). Confirmado hoje.
5. Emissão de `cancelada`/`encerrada` intencionalmente **não** foi
   implementada — não existe coluna de status por escala hoje; inventar
   estado violaria a regra "objetos reais".
6. Retorno em `outra_base` propositalmente restrito a `{id, codigo,
   nome}` — expor mais é PII cross-base.

## J. Rollback

- **Gate 1**: DROP das colunas/índices/FKs permitido SOMENTE antes do
  Gate 2 gravar dados. Depois disso, reverter apenas código/RPC/flag,
  preservando colunas/dados. SQL de rollback embutido em
  `migration_B_recebimentos_aditiva.sql`.
- **Migration A**: sem rollback simples; só via restauração de backup.
- **Gate 2**: `DROP FUNCTION public.registrar_bipagem_escala(text, uuid,
  date, public.bip_stage, text, integer, text, text, uuid);` é
  suficiente enquanto nada chamar a função no frontend.

## K. `git status`

Gerenciado internamente pela plataforma — não posso executar `git
status` (regra do ambiente). As mudanças deste turno são apenas 6
arquivos novos sob `.lovable/gates/`:

- `.lovable/gates/gate1/BACKUP_INSTRUCOES.md`
- `.lovable/gates/gate1/migration_A_enum_outra_data.sql`
- `.lovable/gates/gate1/migration_B_recebimentos_aditiva.sql`
- `.lovable/gates/gate2/rpc_registrar_bipagem_escala.sql`
- `.lovable/gates/gate2/matriz_resultados.md`
- `.lovable/gates/gate2/testes_planejados.md`
- `.lovable/gates/gate2/ENTREGA.md`

Nenhum arquivo funcional foi tocado. Nenhuma migration foi criada em
`supabase/migrations/`.

## L. Push / merge / publish

Nenhum push, merge ou publicação realizado neste turno.

## M. Estado final

**GATE 1 BLOQUEADO POR AUSÊNCIA DE BACKUP CONFIRMADO.**
**GATE 2 NÃO EXECUTADO — AGUARDANDO APROVAÇÃO.**