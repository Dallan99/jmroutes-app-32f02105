# Mapa de pipelines — estado atual (leitura de código + migrations)

> Fonte: repositório atual. Nenhum dado real; UUIDs e códigos abaixo são fictícios (`TST-*`).
> Este documento evita referências rígidas a números de linha, que envelhecem rápido.
> Cada afirmação aponta para o arquivo/símbolo relevante — o corpo exato deve ser
> reconferido no código a cada revisão.

## Pipeline A — Rotas / Volumes (bipagem de recebimento)

- Tabelas: `rotas`, `volumes`, `recebimentos`, `motoristas`, `bases`.
- Cardinalidade: 1 `rota` → N `volumes` (1..N). 1 `volume` → N `recebimentos` (append-only).
- Coluna lida pelo scanner de recebimento: `volumes.codigo`
  (server function `bipar` em `src/lib/recebimento.functions.ts`).
- Consumidores:
  - `src/lib/recebimento.functions.ts` (`bipar`, `ultimasLeituras`) —
    escreve em `volumes.recebido` e em `recebimentos` (append-only).
  - `src/lib/contagem-lock.functions.ts` — controla **somente locks e reservas
    por rota** (tabelas `contagem_rota_locks` / reservas). NÃO consome
    diretamente `rotas` ou `volumes`; delega a movimentação de estoque ao
    fluxo de Contagem.
  - `src/routes/_authenticated/recebimento.tsx` (bipar / última leitura).
- Importação: sem pipeline atual — rotas/volumes são semeados manualmente
  ou fora do fluxo do usuário.
- Substituição: não há. Volumes existem enquanto a rota existir.
- Exclusão/arquivamento: hard delete da rota cascateia (ver migrations
  base). Recebimentos históricos dependem da FK real — verificar em
  integração.

## Pipeline B — Escalas / Shipments (importação Excel)

- Tabelas: `importacoes_escala`, `escalas`, `shipments` (id textual = Shipment).
- Cardinalidade: 1 importação → N escalas → N shipments por rota otimizada.
- Coluna lida pelo scanner (Triagem): `escalas.shipment`
  (server function `biparTriagem` em `src/lib/triagem.functions.ts`).
- Consumidores:
  - `src/lib/triagem.functions.ts`, `src/routes/_authenticated/triagem.tsx`.
  - `src/routes/_authenticated/bases.tsx` (import + histórico).
- Importação: upload xlsx, aba "Base AM", colunas B ("Rota Otimizada")
  e C ("Shipment").
- Substituição: novo upload cria nova `importacoes_escala`; leitura sempre
  pela mais recente do dia + base.
- Exclusão/arquivamento: `excluirImportacao` realiza **hard delete** da
  importação e das escalas vinculadas. A auditoria da exclusão é
  **best-effort** — o insert em `audit_log` não desestrutura `error`,
  logo a exclusão pode ocorrer sem log correspondente; a chamada de log
  falha silenciosamente. Isto está documentado em
  `riscos-e-decisoes.md` como pendência.

## Pipeline C — Contagem (leitura por rota, estado local)

- Tabelas de estado durável: `contagem_rota_locks` (reservas por rota +
  usuário) e as tabelas de estoque próprias da Contagem quando o
  fluxo evolui a rota.
- **Rotas e leituras da sessão de contagem residem em `localStorage`
  no navegador do operador**, não no banco. Persistência tolera perda
  ao trocar de máquina — é intencional na versão atual.
- Consumidores:
  - `src/lib/contagem-lock.functions.ts` — server functions para
    listar/reservar/liberar locks. NÃO consomem diretamente `rotas` /
    `volumes` do Pipeline A.
  - `src/routes/_authenticated/contagem.tsx` — usa `localStorage` para
    rota selecionada e leituras da sessão.
- Regra de autorização: `resolveBaseOperacionalAutorizada` — não-admin
  fica preso à `profiles.base_id`; admin pode operar outra base
  explicitamente.

## Exemplo sintético

```
rotas (Pipeline A)
  id=TST-r-0001  codigo=TST-R01  base_id=TST-base-A  quantidade_prevista=3
volumes
  v1 codigo=TST-VOL-001 rota_id=TST-r-0001 recebido=false
  v2 codigo=TST-VOL-002 rota_id=TST-r-0001 recebido=true
  v3 codigo=TST-VOL-003 rota_id=TST-r-0001 recebido=false

escalas (Pipeline B)
  importacao_id=TST-imp-01  rota_otimizada=K12_AM1  shipment=TST-SHP-9001
  importacao_id=TST-imp-01  rota_otimizada=K12_AM1  shipment=TST-SHP-9002
```

## Separação: dado atual vs inferência

| Ponto | Dado atual (código/migration) | Inferência |
|---|---|---|
| Coluna scanner recebimento | `volumes.codigo` — server fn `bipar` | — |
| Coluna scanner triagem | `escalas.shipment` — server fn `biparTriagem` | — |
| Base do operador vs base da rota | log usa `r.base_id` no handler `bipar` | — |
| Contagem consome rotas/volumes? | Não — Contagem opera locks + localStorage | — |
| `excluirImportacao` remove escalas? | Sim, hard delete via FK/cascade | — |
| Auditoria da exclusão sempre grava? | Best-effort — insert em `audit_log` sem checar `error` | Efeito depende da RLS/GRANT real |
| Efeito RLS de outra base | policies presentes nas migrations | Efeito prático depende de execução em Postgres |
| Duplicidade sob concorrência | check-then-act sem lock no código | Ordem exata de commit depende de PG |

## Estado atual: DOIS PIPELINES PARALELOS

Nenhuma decisão canônica foi tomada. Rotas/volumes não são alimentadas
pela importação de escalas; escalas não geram volumes. Ver
`matriz-modelo-canonico.md`.
