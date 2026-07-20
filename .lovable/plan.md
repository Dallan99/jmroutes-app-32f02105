## Problema

- `auth.users`: 1 registro (`dallan.zanini@jmdistribuicao.com.br`)
- `public.user_roles`: 1 registro (admin)
- `public.profiles`: **0 registros** ← causa da tela vazia

A rota `/usuarios` chama `listarUsuarios`, que faz `SELECT ... FROM profiles`. Sem linha em `profiles`, a UI mostra "Nenhum usuário cadastrado" mesmo com o admin logado.

## Correção proposta (mínima, sem migration)

Inserir a linha faltante em `public.profiles` para o usuário admin existente, via `supabase--insert`:

```sql
INSERT INTO public.profiles (id, email, nome, ativo)
VALUES (
  '9962b32b-426e-4657-b0f5-f761a70b7cfd',
  'dallan.zanini@jmdistribuicao.com.br',
  'Dallan Zanini',
  true
)
ON CONFLICT (id) DO NOTHING;
```

Após isso, a tela `/usuarios` passa a listar o admin, e novos usuários criados pelo botão "+ Novo usuário" já vão aparecer normalmente (o fluxo em `criarUsuario` faz `admin.createUser` + update em profiles).

## Verificação pós-fix

1. Recarregar `/usuarios` — deve aparecer 1 linha (Dallan, admin, ativo).
2. Opcional: criar um usuário de teste pelo botão para confirmar o fluxo ponta-a-ponta.

## Nota (não incluído nesta correção)

Se quiser, num passo separado eu posso verificar por que o trigger `handle_new_user` não populou `profiles` (pode ser um efeito da recriação do projeto Supabase pelo Cloud). Isso exigiria inspeção do trigger — sem alterações, apenas leitura.