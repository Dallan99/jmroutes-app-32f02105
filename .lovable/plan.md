## Escopo por base + Devolução de Insucessos

### 1. Modelo de acesso por base

**Regras**
- **Operador**: 1 base (já existe `profiles.base_id`). Só acessa Recebimento, Bases (upload de rotas), Triagem e Contagem — sempre filtrado pela sua base. Não vê Usuários nem outras bases.
- **Supervisor**: N bases (nova tabela `user_bases`). Acessa as mesmas áreas que operador, restrito às bases atreladas.
- **Gerente / Admin**: acesso total, seletor de base livre.

**Banco (migração)**
- Nova tabela `user_bases (user_id, base_id)` + GRANTs + RLS.
- Funções security-definer:
  - `has_base_access(_user uuid, _base uuid)` → true se admin/gerente, ou `profiles.base_id = _base`, ou linha em `user_bases`.
  - `get_user_bases(_user uuid)` → setof uuid (bases permitidas).
- Atualiza RLS de `bases_operacionais`, `shipments`, `importacoes_escala`, `escalas`, `contagens`, `rotas`, `volumes`, `recebimentos` para usar `has_base_access(auth.uid(), base_id)`.

**Frontend**
- `useAllowedBases()` hook → lista de bases permitidas.
- `AppShell`: se só 1 base permitida, seleciona automaticamente e esconde o botão trocar. Se múltiplas, mostra seletor limitado à lista permitida.
- `bases.tsx`: mostra só as bases permitidas; operador/supervisor só sobe escala nas suas.
- Sidebar: esconde "Usuários" para não-admin (já hoje é assim para operador; garantir para supervisor também mostrar só as áreas relevantes).
- Guard nas rotas `/usuarios` → só admin.

### 2. Devolução de Insucessos

**Banco**
- Nova tabela `devolucoes`:
  - `shipment_id`, `escala_id`, `base_id`, `rota` (nullable), `motivo` (enum), `observacao`, `devolvido_por`, `devolvido_em`.
- Enum `motivo_devolucao`: `cliente_ausente`, `endereco_nao_localizado`, `recusado`, `avaria`, `zona_de_risco`, `outros`.
- Campo `devolvido bool` + `devolvido_em` em `escalas` para consulta rápida.
- GRANTs + RLS por `has_base_access`.

**Frontend**
- Nova rota `/_authenticated/devolucoes.tsx`:
  - Header segue padrão (base + dia operacional).
  - Input de bipagem grande, buscar shipment na base ativa.
  - Modal ao bipar: escolher motivo (radios) + observação opcional → salvar.
  - Lista das devoluções do dia com motivo e horário; ação de desfazer (admin/supervisor).
  - Bipagem duplicada → aviso "já devolvido em HH:mm por X".
- Sidebar: item "Devoluções" (ícone RotateCcw) — visível para roles com acesso a operações da base.

### Ordem de execução
1. Migração escopo por base (`user_bases`, funções, RLS).
2. Migração devoluções.
3. Refactor `AppShell` + hook `useAllowedBases`.
4. Nova página `/devolucoes`.
5. Ajustes em `bases.tsx` para respeitar bases permitidas.

Aviso: as mudanças de RLS afetam todas as telas — vou testar após aplicar. Se algum operador atual não tiver `profiles.base_id` setado, ele perde acesso — vamos precisar preencher.