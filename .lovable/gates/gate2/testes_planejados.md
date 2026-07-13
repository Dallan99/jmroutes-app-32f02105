# Plano de testes — Gate 2 (NÃO EXECUTAR EM PRODUÇÃO)

Ambiente: banco Postgres separado (branch/staging), com o schema `public`
restaurado a partir de dump anonimizado. Nenhum teste roda contra o banco
de produção. Mocks Vitest **não** substituem estes testes — servem apenas
para o wiring da camada TS.

## Fixtures sintéticas

- Bases: `BASE_A`, `BASE_B`.
- Datas: `D1 = hoje`, `D2 = ontem`.
- Importações ativas: `imp_A_D1`, `imp_B_D1`, `imp_A_D2`.
- Escalas: shipments `S_OK`, `S_DUP`, `S_ROTA_X`, `S_OUTRA_DATA`,
  `S_OUTRA_BASE`. `S_ROTA_X` com `otimizada='R1'`.
- Usuários: `U_ADMIN`, `U_A` (acesso só a BASE_A), `U_SEMBASE`.

## Casos

1. **ok recebimento**: `U_A`, `S_OK`, `BASE_A`, `D1`, stage `recebimento`
   → `resultado='ok'`, `escalas.recebido=true`, 1 R + 1 A.
2. **duplicado**: repetir 1 → `resultado='duplicado'`, escalas inalterado,
   2 R + 2 A no total.
3. **outra_rota**: `S_ROTA_X` com `p_rota_selecionada='R2'` → `outra_rota`,
   escalas inalterado.
4. **outra_data**: `S_OUTRA_DATA` só existe em `imp_A_D2`; leitura em `D1`
   → `outra_data`, escalas inalterado.
5. **outra_base**: `S_OUTRA_BASE` só existe em `imp_B_D1`; leitura em
   BASE_A → `outra_base`; DTO expõe apenas `{id, codigo, nome}` da BASE_B,
   sem shipment/PII adicional.
6. **inexistente**: código aleatório → `inexistente`, 1 R + 1 A, sem FKs.
7. **operador sem acesso**: `U_A` chamando `BASE_B` → `RAISE 42501`,
   nenhum R/A criado.
8. **não autenticado**: `SET LOCAL role = anon` + chamada → `RAISE 28000`,
   nada persistido; verificar via GRANT (não deve poder executar).
9. **concorrência**: 2 sessões `SELECT registrar_bipagem_escala(S_OK,...)`
   em paralelo → exatamente 1 `ok`, 1 `duplicado`, 2 R, 2 A,
   `escalas.recebido=true` uma única vez. Executar com `pgbench -c 2 -t 1`
   ou `psql & psql &` em transações separadas.
10. **idempotência**: chamar 2× com mesmo `p_client_event_id` e mesmo
    `U_A` → 1 R apenas; segunda chamada retorna DTO com `retry=true` e
    sem campos internos (IP/UA/tempo).
11. **audit failure rollback**: revogar temporariamente GRANT INSERT em
    `audit_logs` para `authenticated`; RPC deve dar RAISE e escalas
    permanecer intacta (`recebido=false`).
12. **rota nula usa planejada**: `otimizada IS NULL`, `planejada='R1'`,
    `p_rota_selecionada='R1'` → `ok`; `'R2'` → `outra_rota`.

## Testes de segurança (adicionais)

- `SELECT has_function_privilege('anon','public.registrar_bipagem_escala(...)','execute')`
  deve retornar `false`.
- `SELECT has_function_privilege('authenticated', ..., 'execute')` deve
  retornar `true`.
- Nenhum retorno da RPC contém `cep`, `rua`, `numero`, `driver`, `placa`
  quando `resultado='outra_base'`.

## Testes de rollback

- Simular falha entre INSERT recebimentos e INSERT audit (RAISE manual em
  bloco de teste): confirmar que nem R nem A permanecem e escalas não foi
  atualizada.