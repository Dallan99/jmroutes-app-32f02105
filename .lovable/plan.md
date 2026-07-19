
# Plano — Evolução do módulo Transferências

## Escopo
- Apenas `src/routes/_authenticated/transferencias.tsx` e helpers próprios.
- Zero alteração em: banco (schema/RPCs/RLS), autenticação, Recebimento, Triagem, Dashboard, Inventário, Gerencial, Bases.
- Preservar identidade visual (Cards, Badges, Botões, cores e espaçamentos já usados no JM Routes).

## Restrições confirmadas
- 4 etapas já existem no banco (`chegada_service`, `saida_service`, `chegada_xpt`, `saida_xpt`) via RPC `registrar_evento_transferencia_v2` — nada muda no SQL.
- "Uma transferência com várias rotas": será tratado como conceito de UI. Cada rota vira um **grupo lógico de transferências** (uma linha por rota no banco, agrupadas pela mesma placa+motorista+data+base+service). Isso evita alterar o schema. Se o usuário quiser rotas persistidas como entidade separada, será outra entrega com migration dedicada.

## Trabalho por área

### 1. Renomear botão
- "+ Nova rota" → "+ Nova Transferência" no cabeçalho da tabela e no rascunho.

### 2. Fluxo com 4 etapas
- Já implementado no backend. Ajustar UI para expor a etapa `saida_xpt` no cabeçalho e no formulário inline (`EtapaFormCells`), respeitando `proximaEtapa`.

### 3. Coluna Status com Badges
- Nova coluna `Status` derivada do campo `status` da transferência:
  - `aguardando_chegada_service` → cinza · "Aguardando Service"
  - `no_service` / `pendente_evidencia` (no Service) → azul · "No Service"
  - `em_transito_xpt` → laranja · "Em trânsito"
  - `no_xpt` → azul · "No XPT"
  - `concluida_no_prazo` / `concluida_com_atraso` → verde · "Finalizada"
  - `cancelada` → cinza · "Cancelada"

### 4. Coluna "Tempo aguardando carga" (KPI principal)
- Cronômetro ao vivo entre `chegada_service` e `saida_service`.
- Se ainda sem saída: usa `now()` para tempo em curso; se saída já registrada: fixa o valor final.
- Cores: ≤30 min verde, 30–60 min amarelo, >60 min vermelho.
- Atualiza a cada 30 s via `useClock` (já existe em `use-clock.ts`).

### 5. Evidências como ícone
- Remove a coluna "Evidência" atual.
- Novo botão-ícone câmera por linha → abre `DialogoFotosTransferencia` mostrando todas as fotos das 4 etapas com URL assinada (reusa `caminhoEvidenciaTransferencia` + `supabase.storage.createSignedUrl`).

### 6. Timeline de histórico
- Componente `TimelineTransferencia` exibindo os 4 eventos em ordem cronológica com horário, usuário e observação. Fica dentro da linha expandida.

### 7. Múltiplas rotas por transferência (UI)
- Agrupamento no cliente: uma "Transferência" = grupo por (base + service + data + placa + motorista); cada linha do grupo representa uma "Rota" com o código gerado (`codigo` já existe).
- Ao expandir: lista de rotas com Código + Observação + botões Editar/Excluir.
- Botão "+ Adicionar rota" no header do grupo cria uma nova linha via `criarTransferenciasLote` (uma linha).

### 8. Expansão da linha
- Estado `expandidaId` local. Ao clicar na linha (chevron) mostra dentro da mesma tabela:
  - Lista de rotas do grupo.
  - Timeline.
  - Miniaturas de fotos.
  - Observações.

### 9. Dashboard superior (cards KPI)
- Substituir cards atuais por: Em andamento, Finalizadas hoje, Tempo médio aguardando carga, Maior tempo aguardando carga, Atrasadas, Total de veículos (placas distintas do dia).
- Todos computados a partir do `useQuery` já existente.

### 10. Filtros extras
- Adicionar: Status (Select), Motorista (Input), Placa (Input). Manter Base/Service/Data/Busca.

### 11. Ações por linha
- Menu com: Visualizar (expandir), Editar, Atualizar etapa, Excluir. Excluir só aparece para admin (`has_role('admin')` já disponível via `context.claims`; no cliente, ler role do `useBaseOperacional` — verificar disponibilidade; se não houver, esconder para não-admin via check server).

### 12. Persistência do "Salvar"
- Auditar `editarTransferencia`. Garantir que a mutation invalida a query e trata erro. Adicionar toast de sucesso somente após `onSuccess`.
- Substituir eventual `optimistic update` incompleto por `queryClient.setQueryData` na resposta.

### 13. Responsividade
- Reduzir colunas em telas <1280px (esconder tipo de veículo/serviço); manter ações e status sempre visíveis. `overflow-x-auto` só como fallback.

### 14. Performance
- Após mutations, atualizar somente a entrada afetada via `setQueryData` — sem `invalidateQueries` total. `refetchOnWindowFocus: false` para tabela grande.

### 15. Padrão visual
- Reutilizar `Card`, `Badge`, `Button variant="ghost|outline|default"`, ícones lucide já usados. Nenhum estilo inline novo.

### 16. Restrições
- Nenhum outro arquivo do app é tocado.

## Detalhes técnicos

**Arquivos alterados (frontend apenas):**
- `src/routes/_authenticated/transferencias.tsx` — refatoração principal.
- Novos componentes (mesmo arquivo ou co-localizados em `src/components/transferencias/`):
  - `StatusBadge.tsx`, `TempoAguardandoCarga.tsx`, `DialogoFotos.tsx`, `TimelineTransferencia.tsx`, `LinhaExpandida.tsx`.
- Possivelmente pequenos helpers em `src/lib/transferencias.functions.ts` (funções puras client-side; sem tocar server functions).

**Testes:**
- Ampliar `tests/characterization/transferencias.test.ts` para cobrir:
  - Regras de status → cor.
  - Cálculo de "tempo aguardando carga" e faixas verde/amarelo/vermelho.
  - Agrupamento de rotas.

**Validação final:**
- `bun run test` (esperado: 31 anteriores + novos passando)
- `tsgo` sem erros
- `bun run build` sem erros
- Revisão visual da tela no preview

## Fora deste plano
- Migração de schema para tabela `rotas_transferencia` separada (só se o usuário pedir explicitamente).
- Publicação em produção (proibida por regra do playground).
- Alterações em outros módulos.

## Pergunta antes de começar
Confirma o approach de **"rotas = agrupamento lógico no cliente"** (sem migration) OU prefere que eu proponha uma migration aditiva criando uma tabela `transferencia_rotas` para representar rotas como entidade real? A primeira opção é mais rápida e reversível; a segunda é mais robusta a longo prazo mas exige aprovar SQL.
