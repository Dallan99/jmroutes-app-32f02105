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

---

## Regra Operacional — Troca de Base (Fase Frontend/RPC)

**Status:** registrada. NÃO implementar agora. Migrations A e B seguem bloqueadas até confirmação de backup. Esta regra entra na fase de frontend + RPC do plano de estabilização.

### 1. Botão "Trocar base / dia"
- Somente `admin` visualiza/usa o botão nas telas operacionais: Recebimento, Triagem, **Contagem**, e (quando houver escolha operacional) Inventário e Devoluções.
- Não exibir para operador, supervisor, gerente, sem papel ou inativo.
- Gerente mantém filtros em Gerencial/Histórico/Auditoria, mas nunca troca base de bipagem.

### 2. Não admin
- Sem botão, sem seletor. Base carregada automaticamente de `profiles.base_id` e exibida fixa no cabeçalho junto com a data operacional.
- Ignorar `sessionStorage` de base diferente de `profiles.base_id` (limpar e recarregar do perfil).
- Se `profiles.base_id` for NULL: bloquear a tela com mensagem "Usuário sem base operacional vinculada. Contate o administrador." Base NULL nunca vira acesso global.
- Bloquear troca via URL, console ou envio de `baseId` alternativo à server function/RPC.

### 3. Admin
- Vê "Trocar base / dia" com base atual sempre visível. Seleção por sessionStorage por aba, revalidada no servidor.
- Confirmação obrigatória: "Você está alterando o contexto operacional de [Base atual] para [Nova base]. As próximas leituras serão registradas na nova base. Deseja continuar?"
- Troca gera `audit_log`. Eventos anteriores não mudam. Contadores da sessão atualizam.

### 4. Data operacional
- Não admin: se precisar trocar dia, botão separado "Trocar dia operacional" (nunca "Trocar base / dia"), listando somente dias/importações da base fixa.
- Admin: mantém "Trocar base / dia".
- Em Contagem: admin → "Trocar base / dia"; não admin → base fixa + eventual "Trocar dia operacional".

### 5. Segurança no servidor
- Criar validação central reutilizável usada por Recebimento, Triagem, Contagem, Inventário e Devoluções.
- Admin: aceita `p_base_leitura_id` se a base existe e está ativa.
- Não admin: ignora o valor do frontend e força `profiles.base_id`; rejeita divergência com erro de acesso.
- Autorização gerencial de leitura consolidada não concede autorização de bipagem em outras bases.

### 6. RLS e consultas
- Operador: lê/grava só sua base. Supervisor operacional: bipagem restrita à base do perfil. Gerente: consulta consolidada, sem trocar base operacional. Admin: opera na base selecionada.
- `base_id` NULL nunca concede acesso. Filtros de frontend não são a única proteção.
- Contagem sempre filtra base + data; jamais retorna rotas de outra base. `contagens_rotas_lock` continua isolado por base + data.

### 7. Componentes reutilizáveis
- `OperationalContextHeader`, `AdminBaseDaySwitcher`, `DayOnlySwitcher`, `FixedBaseBadge`. Recebem papel, base fixa, base selecionada, data, permissão de troca e callback. Preservar design atual do botão.

### 8. Testes de aceite
1. Admin vê "Trocar base / dia" em Contagem. 2. Admin troca Embu → Franco da Rocha. 3. Troca gera audit_log. 4-6. Operador/Supervisor/Gerente não veem o botão em telas operacionais. 7. Gerente mantém filtros em Gerencial. 8. Operador Embu enviando baseId de Franco da Rocha → acesso negado no servidor. 9. Não admin com sessionStorage divergente volta para `profiles.base_id`. 10. Não admin com `base_id` NULL fica bloqueado. 11. Base NULL não é acesso global. 12. Contagem lista só rotas da base+data atuais. 13. Trocar dia não libera troca de base. 14. Eventos anteriores não mudam após troca admin. 15. Refresh mantém base fixa correta. 16. Usuário inativo não opera.

### 9. Critério de aceite
Botão presente em Contagem só para admin; operador da Base Embu preso à Base Embu inclusive contra chamadas diretas; gerente mantém visão consolidada sem permissão operacional cruzada; base+data claras no cabeçalho; build/TS/testes verdes; sem regressão de funcionalidades.

### Ordem de execução
1. Migração escopo por base (`user_bases`, funções, RLS).
2. Migração devoluções.
3. Refactor `AppShell` + hook `useAllowedBases`.
4. Nova página `/devolucoes`.
5. Ajustes em `bases.tsx` para respeitar bases permitidas.

Aviso: as mudanças de RLS afetam todas as telas — vou testar após aplicar. Se algum operador atual não tiver `profiles.base_id` setado, ele perde acesso — vamos precisar preencher.