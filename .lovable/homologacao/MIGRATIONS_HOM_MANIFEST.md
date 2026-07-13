# Manifesto de Migrations — Ambiente de Homologação (HOM)

Documento autoritativo. Nenhuma migration deste manifesto será executada
sem autorização explícita do proprietário. As migrations oficiais em
`supabase/migrations/` NÃO serão alteradas nesta etapa.

Total de arquivos em `supabase/migrations/`: **31**.
Permitidos em HOM: **29**. Excluídos: **2**.

## Ordem cronológica

| # | Arquivo | Status HOM |
|---|---|---|
| 01 | `20260626010856_e0c766ae-d779-44dc-a592-c9bb6a6df3bd.sql` | PERMITIDA |
| 02 | `20260626010919_8a50bcde-a93e-4ece-b5ef-8a6b4597673a.sql` | PERMITIDA |
| 03 | `20260628004242_7ac3ffe2-908d-47db-8456-74021e1238bd.sql` | PERMITIDA |
| 04 | `20260629151916_c03d7c80-b8fd-47e1-acc6-84ec0d3bd69d.sql` | PERMITIDA |
| 05 | `20260629233923_23e6de2d-ee5e-4ec4-a7de-4bd57273b839.sql` | PERMITIDA |
| 06 | `20260630135455_43ce8612-25ad-47a7-a59e-f7f80c569155.sql` | PERMITIDA |
| 07 | `20260630135802_6ebcb402-c4ec-410c-bac3-1bd688501192.sql` | PERMITIDA |
| 08 | `20260630135827_c80107a5-5214-4e68-a354-482370407378.sql` | PERMITIDA |
| 09 | `20260703182310_77aa9175-6bea-4908-88ac-a0eabd2edf51.sql` | PERMITIDA |
| 10 | `20260703182322_21c99024-6c47-455c-a153-09f0c3c39b0e.sql` | PERMITIDA |
| 11 | `20260704163825_8be9c154-29b4-4938-9b17-0bd59812e18c.sql` | PERMITIDA |
| 12 | `20260704163857_351feac7-9ca2-435a-9a35-ccc48f59fc4e.sql` | PERMITIDA |
| 13 | `20260704224637_fadf08b6-d637-4e7e-aa20-78d485ea5d05.sql` | **EXCLUÍDA — contém credencial em texto e faz `INSERT` direto em `auth.users`. NÃO copiar para HOM. NÃO executar.** |
| 14 | `20260704231855_6db6955e-cf61-43c7-bbec-5a5ef70777ef.sql` | PERMITIDA |
| 15 | `20260706150929_6342cd2e-63e3-4dad-9a84-f29914821cae.sql` | PERMITIDA (cria `bases_operacionais` e `shipments` no modelo legado — deixar tabelas vazias em HOM) |
| 16 | `20260706151053_f23f8770-9dc3-41ee-a49d-0dbbdbd643b7.sql` | PERMITIDA |
| 17 | `20260706192433_7c4c6d08-846f-406b-8f81-412c1e7aeb86.sql` | PERMITIDA |
| 18 | `20260706192448_9c909d26-5605-4aa0-a2b0-34674f60d01d.sql` | PERMITIDA |
| 19 | `20260707182637_59b2e7b4-ae2d-4e59-af66-cfe7b319b7b6.sql` | PERMITIDA |
| 20 | `20260707184501_412fe4e5-e360-49d0-8b41-73634603325b.sql` | PERMITIDA |
| 21 | `20260708134126_64a65281-2c3b-4b70-8ee0-b23958972b38.sql` | PERMITIDA |
| 22 | `20260708140131_c8654fd5-b51f-4f41-8ec7-988c91061fc0.sql` | PERMITIDA |
| 23 | `20260708140149_a77e17fb-d2ce-4329-8fd5-32ae8451a2e2.sql` | PERMITIDA |
| 24 | `20260708161937_8b8d6614-7840-483a-9b65-736567179183.sql` | PERMITIDA |
| 25 | `20260708182501_db3782dc-2f7b-4ac9-ab2b-db274feec3e3.sql` | PERMITIDA |
| 26 | `20260710130702_aba4bf7c-e6fb-4042-be8a-6ab93733d75e.sql` | PERMITIDA |
| 27 | `20260710172055_6e815c7b-0b64-4e4d-bf25-9c951c3d8a50.sql` | PERMITIDA |
| 28 | `20260710173453_82bc557b-875c-41b6-85a0-d71400ea3d0e.sql` | PERMITIDA |
| 29 | `20260710174339_9984dff9-86b2-4249-88e3-a4ec6caa4515.sql` | PERMITIDA (reseta senha para valor aleatório — inofensivo em HOM vazio, mas mantido como neutro) |
| 30 | `20260710174647_2ecbedbc-fccd-403f-b0ba-4b72885761d4.sql` | **EXCLUÍDA — contém credencial em texto (UPDATE `encrypted_password`) referenciando usuário do projeto original. NÃO copiar para HOM. NÃO executar.** |
| 31 | `20260710191435_f259333d-43e0-41af-adda-0ccebde9dd24.sql` | PERMITIDA |

## Regras de aplicação

1. As migrações são executadas exclusivamente no SQL Editor do Supabase HOM, na ordem acima, pulando as duas marcadas como EXCLUÍDA.
2. Usuários de HOM são criados manualmente pelo proprietário no painel Auth do Supabase HOM. Nada de `INSERT INTO auth.users` via SQL.
3. Após criar os usuários, o proprietário substitui os placeholders do seed (ver plano) e executa o seed HOM no SQL Editor.
4. Nenhuma migration oficial é editada, renomeada ou removida por esta operação.
5. As migrations EXCLUÍDAS permanecem no repositório apenas como histórico até que o incidente de credencial seja tratado em plano separado.
