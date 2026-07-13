# Riscos e decisões pendentes

## Riscos ativos

1. **Dois pipelines paralelos** (rotas/volumes vs escalas/shipments).
2. **Rotas/volumes sem alimentação atual** por processo documentado.
3. **Histórico sobrevive sem vínculos duros** ao pipeline canônico.
4. **`outra_base` inacessível para operador single-base**: RLS oculta a linha, código classifica como `inexistente`, mascarando erro operacional real.
5. **Concorrência**: `bipar` faz `select → if → update` sem lock (`src/lib/recebimento.functions.ts`), permitindo duplicidade sob corrida.
6. **Erros ignorados**: inserts em `recebimentos` não checam `error`.
7. **Auditoria best-effort**: `registrarAuditInterno` não bloqueia caminho principal.
8. **Decisão canônica pendente**: nenhum pipeline foi ratificado.

## Decisões NÃO tomadas nesta entrega

- Não escolhido pipeline canônico.
- Não aplicada RPC transacional (Gate 2 bloqueado).
- Não alteradas policies RLS.
- Não alterado nenhum arquivo funcional para viabilizar teste.
- Não executado backfill.
- Não publicado.

## Gates

- Gate 1 (migrations A/B): **BLOQUEADO por ausência de backup confirmado**.
- Gate 2 (RPC `registrar_bipagem`): **NÃO EXECUTADO — aguardando Gate 1**.
