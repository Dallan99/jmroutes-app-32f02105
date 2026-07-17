# Testes — visão geral

Estes testes NÃO substituem verificação em banco. Eles caracterizam o
estado atual do código antes das correções P0 (locks/RPC, RLS reforçada,
hardening dos pipelines).

## Classificação

| Categoria                                       | Local                                                                   | O que prova                                                                                                                                              | O que NÃO prova                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Unitário do fake**                            | `tests/fakes/fake.smoke.test.ts`                                        | O `FakeSupabase` respeita seu próprio contrato: `eq`, `count:exact`, semântica de `nextError` (consumido uma vez, sem side-effect).                      | Nada sobre o Supabase real.                                                                                    |
| **Caracterização estática (leitura de código)** | `tests/characterization/*.source.test.ts`                               | Que o código-fonte atual contém (ou não contém) construções específicas: `for update`, `.rpc(`, `check-then-act`, uso do helper de base autorizada, etc. | Comportamento em execução.                                                                                     |
| **Caracterização de risco (fake em memória)**   | `tests/characterization/concorrencia.test.ts`, `rls-outra-base.test.ts` | Que a estrutura atual do handler PERMITE o risco (dois `bipar` paralelos passam pelo check-then-act; linha invisível vira `inexistente`).                | Ordem exata de commit no PostgreSQL, comportamento real de RLS/policies/`SECURITY DEFINER`, locks, transações. |

## Limitações do fake (`tests/fakes/fake-supabase-client.ts`)

O fake imita apenas a superfície do `supabase-js` que o código atual
utiliza (`from().select()/insert()/update()/delete()/eq()/maybeSingle()`).
Ele:

- **NÃO** aplica RLS, policies, `SECURITY DEFINER`, `GRANT`/`REVOKE`.
- **NÃO** aplica constraints (`UNIQUE`, `FK`, `CHECK`).
- **NÃO** executa transações, savepoints ou rollback.
- **NÃO** implementa locks (`FOR UPDATE`, advisory locks).
- **NÃO** modela concorrência real entre conexões distintas.
- **NÃO** implementa a semântica completa do PostgREST/Data API.

Ele **implementa explicitamente** que `nextError`, quando armado para
uma operação, retorna erro e **não produz side-effect** (insert não
adiciona linha, update não altera, delete não remove), e é consumido
uma única vez. Isto está coberto pelos testes de `fake.smoke.test.ts`.

## Quais testes caracterizam vulnerabilidades atuais

- `characterization/bipar.source.test.ts` — mostra que `bipar` faz
  check-then-act em `volumes.recebido` sem lock nem RPC (`registrar_bipagem`
  ausente), que o `insert` em `recebimentos` não desestrutura `error`
  (auditoria best-effort) e que a base logada é a da rota, não a do
  operador.
- `characterization/concorrencia.test.ts` — mostra que dois handlers
  paralelos leem `recebido=false` e ambos aplicam update: o risco de
  duplicação é ESTRUTURAL, não corrigido no código atual.
- `characterization/rls-outra-base.test.ts` — mostra que uma linha
  invisível (efeito deduzido de RLS) é classificada como `inexistente`
  pelo handler.
- `characterization/contagem-lock.source.test.ts` — verifica que o
  helper `resolveBaseOperacionalAutorizada` está definido e é invocado
  em `listarRotasLock`, `reservarRotaLock` e `liberarRotaLock` (cada
  corpo isolado antes da checagem, para evitar falso positivo).

## Testes que deverão ser atualizados após o P0

Assim que a correção P0 entrar (RPC transacional para bipagem + hardening
de RLS/policies), os seguintes testes de caracterização deixam de fazer
sentido no formato atual e devem ser reescritos:

- `bipar.source.test.ts` — as asserções que exigem `not.toMatch(/for update/i)`
  e `not.toMatch(/registrar_bipagem|\.rpc\(/)` viram o inverso: devem
  passar a exigir a presença da RPC/lock.
- `concorrencia.test.ts` — deve ser substituído por integração real em
  PostgreSQL, executando dois `bipar` em paralelo contra a RPC.
- `rls-outra-base.test.ts` — deve virar integração real com policies
  aplicadas.

Enquanto isso, mantê-los é a forma explícita de deixar a vulnerabilidade
visível no CI.

## Verificações que dependem de PostgreSQL / Supabase de homologação

Nenhum dos testes deste diretório substitui:

- **Lock e RPC transacional** (`registrar_bipagem_escala` do Gate 2) —
  precisa de PostgreSQL para provar isolamento e idempotência.
- **RLS** (todas as policies em `supabase/migrations/*`) — precisa de
  execução com JWTs distintos (`authenticated` vs `service_role`).
- **`SECURITY DEFINER`** (`has_role`, funções de auditoria) — precisa
  de execução do banco.
- **`GRANT`/`REVOKE`** — precisa da Data API (PostgREST) para provar o
  efeito real.
- **Constraints, FKs, triggers** — só o PG impõe.
- **Concorrência entre conexões distintas** — só o PG resolve.

Estas verificações permanecem PENDENTES enquanto o playground não tiver
um Supabase de homologação dedicado (não é o de produção
`hcfjdbfqvihlnfacrttn`).

## Como rodar

```bash
bun run test         # roda tudo uma vez
bun run test:watch   # modo watch
```

Os testes não fazem I/O de rede e não dependem de `.env`. O runner
(`vitest.config.ts`) roda em `node` e exclui `dist`, `.output` e
`.vinxi` do bundle.
