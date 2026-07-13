# ⚠️ REMOVER ANTES DO MERGE PARA PRODUÇÃO

Checklist de artefatos **temporários** introduzidos exclusivamente para a
revisão visual de homologação no `JMRoutes Dev Playground`. Nenhum destes
itens deve chegar ao branch de produção. Antes de qualquer merge, executar
os passos abaixo e re-rodar `bun run test`, `bunx tsgo --noEmit` e
`bun run build`.

---

## 1. `src/routes/preview-relatorios.tsx`

- **O que é:** rota `/preview-relatorios` com dados fictícios em memória
  para revisar impressão de Triagem e Devoluções sem Supabase.
- **Ação:** deletar o arquivo inteiro.
- **Efeito colateral:** a entrada correspondente em
  `src/routeTree.gen.ts` (item 3) desaparece automaticamente na próxima
  execução do plugin do TanStack Router.

## 2. `src/routes/__root.tsx` — `try/catch` em `supabase.auth.onAuthStateChange`

- **O que é:** bloco `try/catch` dentro do `useEffect` do
  `RootComponent`, marcado com `⚠️  REMOVER ANTES DO MERGE PARA PRODUÇÃO`.
- **Motivo da temporariedade:** o `catch` silencia a falha de
  `Missing Supabase environment variable(s)` para permitir renderizar
  `/preview-relatorios` sem credenciais. **Não é correção definitiva** —
  em produção pode mascarar erro real de configuração ou falha de
  autenticação.
- **Ação:** restaurar o corpo original:

  ```ts
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient, router]);
  ```

- **Não** alterar novamente o fluxo de autenticação durante a homologação.

## 3. `src/routeTree.gen.ts` — entrada gerada `/preview-relatorios`

- **O que é:** referências auto-geradas pelo plugin do TanStack Router à
  rota `preview-relatorios` (importação, `RouteById`, `RouteByFullPath`,
  `RouteChildren` etc.).
- **Origem:** arquivo é regenerado a partir de `src/routes/` em cada
  build/dev — **não editar à mão**.
- **Ação:** após deletar `src/routes/preview-relatorios.tsx` (item 1),
  rodar `bun run build` (ou `bun run dev`) uma vez para regenerar
  `src/routeTree.gen.ts` sem a rota. Confirmar com:

  ```bash
  grep -n "preview-relatorios\|PreviewRelatorios" src/routeTree.gen.ts
  ```

  A saída deve ficar vazia.

---

## Restrições reafirmadas durante a homologação

- Não publicar.
- Não conectar Supabase.
- Não configurar `.env`.
- Não executar migrations, RPCs, RLS, policies ou GRANTs.
- Não avançar os Gates 1 e 2.
- Não alterar novamente o fluxo de autenticação enquanto o `try/catch`
  temporário estiver ativo.
