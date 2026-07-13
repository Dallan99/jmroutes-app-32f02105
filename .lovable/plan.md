# Plano Revisado — Homologação Completa do JMRoutes

Status: **em revisão**. Nenhuma conexão, criação de projeto ou execução de SQL será iniciada sem sua autorização explícita e sem que as variáveis do novo Supabase HOM tenham sido fornecidas por você no painel do Lovable.

Restrições reafirmadas: não acessar produção (`hcfjdbfqvihlnfacrttn`), não copiar dados reais, não solicitar senha/OTP/token/service_role pelo chat, não versionar `.env`, não executar SQL de `.lovable/gates/`, Gates 1 e 2 permanecem bloqueados, sem publicar, sem domínio, sem tocar `jmroutes.app`, sem merge na main.

---

## 1. Incidente de segurança — credencial em migration

Foram identificados **dois arquivos** dentro de `supabase/migrations/` que contêm uma credencial em texto associada ao projeto original (produção). O valor **não é reproduzido** neste plano nem em qualquer arquivo desta entrega.

Arquivos com o segredo:

- `supabase/migrations/20260704224637_fadf08b6-d637-4e7e-aa20-78d485ea5d05.sql` — `INSERT INTO auth.users` com campo `encrypted_password` derivado de senha em texto.
- `supabase/migrations/20260710174647_2ecbedbc-fccd-403f-b0ba-4b72885761d4.sql` — `UPDATE ... SET encrypted_password = crypt('<senha>', ...)` referenciando usuário do projeto original.

Uma terceira migration (`20260710174339_...`) também usa `encrypted_password`, porém com valor aleatório (`gen_random_uuid`) — **sem exposição de segredo**, permitida em HOM.

Ações imediatas recomendadas (não executadas nesta etapa):

1. **Rotação da credencial em produção** o quanto antes, pelo proprietário, diretamente no painel Auth do projeto de produção. Não faço essa rotação e não peço a senha.
2. **Não copiar** essas duas migrations para o Supabase HOM (marcadas EXCLUÍDAS no manifesto — item 2).
3. **Registrar o incidente** neste plano e no manifesto.
4. **Plano separado, em etapa futura e sob autorização específica**, para:
   - substituir esses arquivos por migrations neutras equivalentes (sem credenciais e sem `INSERT` em `auth.users`);
   - avaliar limpeza do histórico Git (rewrite via `git filter-repo`/BFG) — **não executarei rewrite sem autorização explícita**;
   - revisar branches remotas onde os arquivos aparecem. No worktree atual (branch em uso pelo playground), somente os dois arquivos acima contêm o valor; um levantamento completo em outras branches depende de acesso ao repositório oficial e será feito quando o plano de remediação for autorizado.
5. **Não alterar migrations oficiais nesta etapa.**

## 2. Manifesto exato de migrations HOM

Criado o documento: `.lovable/homologacao/MIGRATIONS_HOM_MANIFEST.md`.

Total no repo: 31 arquivos. Permitidas em HOM: 29. Excluídas: 2 (as duas listadas acima).

O manifesto lista os 31 arquivos por nome completo e ordem cronológica, marcando individualmente cada status. Não há referências vagas do tipo "migration 13".

## 3. Modelo real de `bases_operacionais` (correção)

Inspeção da migration `20260706150929_...` confirma:

- `bases_operacionais` **não possui** `base_id`;
- possui `UNIQUE (data_operacional)`;
- possui índice único parcial global `bases_operacionais_uma_ativa` sobre `status='ativa'`.

Portanto, o modelo legado admite **uma única `base_operacional` ativa por dia em todo o sistema**, não uma por base. Consequências para a fixture HOM:

- **Não criar** duas bases operacionais ativas.
- **Preferencialmente não popular** `bases_operacionais` nem `shipments` em HOM.
- Os fluxos de Recebimento, Triagem, Contagem, Devoluções e Inventário serão exercitados via `importacoes_escala` + `escalas` (com `escala_id` correspondente), que já é o caminho canônico no código atual.
- **Não aplicar** nenhuma migration draft que adicione `base_id` a `bases_operacionais`. Gates 1 e 2 continuam bloqueados.

Se durante a homologação alguma tela exigir explicitamente um registro em `bases_operacionais`, o proprietário decide caso a caso e o registro será mínimo (uma única linha `aguardando`, não `ativa`).

## 4. Env-guard revisado (playground-only)

Somente **quando você autorizar**, criarei:

- `src/lib/env-guard.server.ts` — server-only, sem qualquer import de código cliente.
- Chamada em `src/integrations/supabase/auth-middleware.ts` e `src/integrations/supabase/client.server.ts`.
- Guarda cliente separada e opcional em `src/integrations/supabase/client.ts`, marcada como defesa adicional (não autoritativa).

Variáveis exigidas no playground:

- Servidor: `APP_ENV` (deve ser `homologacao`).
- Cliente: `VITE_APP_ENV` (deve ser `homologacao`).

Lógica autoritativa (servidor):

1. Se `APP_ENV` estiver ausente ou diferente de `homologacao`, o servidor **falha** com `"APP_ENV ausente ou inválido no playground de homologação"`.
2. Quando `APP_ENV === 'homologacao'`:
   - lê `SUPABASE_PROJECT_ID` e o project id extraído de `SUPABASE_URL` (`https://<id>.supabase.co`);
   - se qualquer um for igual a `hcfjdbfqvihlnfacrttn`, falha com `"Conexão com produção bloqueada no ambiente de homologação"`;
   - se as duas fontes divergirem entre si, também falha (defesa contra colagem parcial).
3. Nunca imprime valores de chaves. Log apenas do project id detectado (informação pública) e do modo (`homologacao`).
4. Guarda cliente espelha as mesmas checagens contra `VITE_APP_ENV`, `VITE_SUPABASE_PROJECT_ID` e `VITE_SUPABASE_URL`, mas é declarada explicitamente como não autoritativa.

Marcação temporária: `env-guard` entra na lista `.lovable/gates/REMOVER_ANTES_DO_MERGE.md` com nota **"alteração exclusiva do playground — não promover a produção sem revisão específica"**. Produção **não é modificada** por esta entrega.

Testes (`tests/characterization/env-guard.test.ts`), sem tocar produção:

- HOM + ID de produção em `SUPABASE_PROJECT_ID` → bloqueia.
- HOM + URL de produção em `SUPABASE_URL` (id embutido) → bloqueia.
- HOM + `SUPABASE_PROJECT_ID` divergente de `SUPABASE_URL` → bloqueia.
- HOM + ID HOM consistente em ambas → permite.
- `APP_ENV` ausente → bloqueia.
- Sem alteração da guarda em modo de produção — o módulo é playground-only e não é importado pelos caminhos de produção.

## 5. Usuários de homologação

Criados manualmente por você no painel Auth do Supabase HOM. Não peço senha, token, OTP, service_role, nem UUIDs pelo chat. Sem `INSERT` em `auth.users`.

Cinco usuários, com endereços de teste controlados pelo proprietário (sem `.local`). O seed usa placeholders literais para você substituir no SQL Editor:

- `__ADMIN_USER_ID__`
- `__OPERADOR_USER_ID__`
- `__SUPERVISOR_USER_ID__`
- `__INATIVO_USER_ID__`
- `__SEMBASE_USER_ID__`

Papéis esperados após substituição:

| Placeholder | Papel | `profiles.base_id` | `user_roles` | `ativo` |
|---|---|---|---|---|
| `__ADMIN_USER_ID__` | admin | HOM-EMBU | `admin` | true |
| `__OPERADOR_USER_ID__` | operador | HOM-EMBU | `operador` | true |
| `__SUPERVISOR_USER_ID__` | supervisor | HOM-EMBU | `supervisor` | true |
| `__INATIVO_USER_ID__` | operador inativo | HOM-EMBU | `operador` | false |
| `__SEMBASE_USER_ID__` | operador sem base | NULL | `operador` | true |

## 6. Fixtures — `supabase/seeds/hom-fixtures.sql` (fora de `migrations/`)

Regras:

- Nenhum CPF ou CNH fictício que possa colidir com documento real. `cpf = NULL`, `cnh = NULL` sempre.
- Nomes claramente fictícios: `Motorista Hom 1..N`, `Operador HOM Alpha`, etc.
- Códigos e IDs prefixados com `HOM_` (rotas: `HOM_K1_AM1`, volumes: `HOMVOL0001`, shipments futuros: `HOMSHP0001` — não populados nesta fixture).
- Placas: `NULL` se o schema permitir; caso contrário, formato claramente inválido (`HOM-0000`).
- Datas: parametrizadas via `SELECT current_date` ou variável no topo do seed.
- **Não popular** `bases_operacionais` nem `shipments` (item 3).
- As migrations oficiais inserem as bases reais `EMBU` e `FRANCO` em `public.bases`. Em HOM, o seed **renomeia** essas duas linhas para `HOM-EMBU` / `HOM-FRANCO` (via `UPDATE ... WHERE codigo IN ('EMBU','FRANCO')`) para evitar confusão visual, **sem alterar as migrations oficiais**. A operação é idempotente.
- Cabeçalho grande no topo: `-- FIXTURE SINTÉTICA HOM — NÃO EXECUTAR EM PRODUÇÃO --`.

Conteúdo mínimo:

- `bases`: renomear as duas existentes para `HOM-EMBU`, `HOM-FRANCO`.
- `motoristas`: 4 fictícios (`cpf=NULL`, `cnh=NULL`).
- `rotas`: 6 rotas HOM distribuídas entre as duas bases.
- `volumes`: ~50 códigos `HOMVOL####` ligados às rotas.
- `importacoes_escala` + `escalas`: 1 importação ativa hoje para HOM-EMBU com ~10 escalas HOM.
- `devolucoes`: 3 registros históricos com motivos variados.
- `profiles` + `user_roles`: `INSERT ... ON CONFLICT DO UPDATE` usando os placeholders do item 5.

## 7. Execução SQL — nota correta

- O SQL Editor do Supabase executa como o **proprietário do banco / role `postgres`**. RLS não se aplica da mesma forma a esse role.
- Portanto, **o seed HOM é executado como proprietário do banco**, não como `service_role`.
- `service_role` continua necessária apenas para as server functions que usam `supabaseAdmin` em `src/integrations/supabase/client.server.ts`. Corrigido em relação ao plano anterior.

## 8. Rollback

O Supabase HOM é dedicado, vazio e sem dados reais. Rollback recomendado, em ordem de preferência:

1. **Apagar e recriar** o projeto Supabase HOM pelo painel.
2. **Restaurar snapshot** do projeto HOM, quando disponível.

Não recorrer a `DROP SCHEMA public CASCADE` como procedimento normal.

## 9. Ordem de execução (aguardando autorização)

1. Você cria o projeto Supabase HOM e cadastra as variáveis no painel do Lovable:
   - Servidor: `APP_ENV=homologacao`, `SUPABASE_URL`, `SUPABASE_PROJECT_ID`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   - Cliente: `VITE_APP_ENV=homologacao`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. Você autoriza a criação do `env-guard` + testes. Eu implemento e valido com `bun run test`, `bunx tsgo --noEmit`, `bun run build`.
3. Você aplica no SQL Editor do HOM, na ordem do manifesto, as **29 migrations permitidas**, pulando as duas EXCLUÍDAS.
4. Você cria os cinco usuários HOM no painel Auth do Supabase HOM.
5. Você substitui os cinco placeholders no seed HOM pelos UUIDs reais e executa o seed no SQL Editor.
6. Reinicio o preview; roteiro de validação por perfil (admin, operador, supervisor, inativo, sem base) percorrendo `/inicio`, `/recebimento`, `/triagem`, `/contagem`, `/devolucoes`, `/inventario`, `/gerencial`, `/usuarios`, `/auditoria`, e opcionalmente `/preview-relatorios`.

## 10. Critérios de parada (aborto imediato)

- Qualquer variável apontando para `hcfjdbfqvihlnfacrttn` (env-guard falha e não subo).
- `APP_ENV` ausente ou diferente de `homologacao`.
- Falha em qualquer migration permitida (parar, não continuar).
- Qualquer sinal de conexão ao projeto de produção (parar, reportar).
- Solicitação implícita ou explícita de senha/OTP/service_role pelo chat (recuso).

## 11. Riscos restantes

- **Credencial já exposta no histórico Git**: mitigação real depende de rotação + rewrite do histórico, ambos fora desta etapa.
- **Divergência de schema HOM vs. produção**: se produção tiver hotfixes fora de `supabase/migrations/`, HOM não os terá — aceitável para homologação, mas registrado.
- **Renomear `EMBU`/`FRANCO` no seed**: se algum código do frontend depender literalmente do valor `codigo='EMBU'`, telas podem quebrar em HOM. Mitigação: verificar `rg -n "'EMBU'|'FRANCO'"` antes de aplicar o seed e ajustar apenas se necessário.
- **`bases_operacionais` vazia em HOM**: telas que assumam pelo menos uma linha ativa podem exibir vazio. É o comportamento correto para o estado atual do schema — os testes existentes já cobrem o caminho vazio.
- **`preview-relatorios` continua ativo** com dados fictícios embutidos, sem risco adicional. Removido antes do merge conforme `.lovable/gates/REMOVER_ANTES_DO_MERGE.md`.

---

Aguardo sua autorização (e as variáveis no painel Lovable) para prosseguir com o item 9. Até lá, nada será conectado, criado ou executado.
