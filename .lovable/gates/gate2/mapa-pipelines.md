# Mapa de pipelines — estado atual (leitura de código + migrations)

> Fonte: repositório atual. Nenhum dado real; UUIDs e códigos abaixo são fictícios (`TST-*`).

## Pipeline A — Rotas / Volumes (bipagem atual)

- Tabelas: `rotas`, `volumes`, `recebimentos`, `motoristas`, `bases`.
- Cardinalidade: 1 `rota` → N `volumes` (1..N). 1 `volume` → N `recebimentos` (append-only).
- Coluna lida pelo scanner: `volumes.codigo` (`src/lib/recebimento.functions.ts` L96-100).
- Consumidores:
  - `src/lib/recebimento.functions.ts` (bipar, ultimasLeituras)
  - `src/lib/contagem-lock.functions.ts` (lock por rota)
  - `src/routes/_authenticated/recebimento.tsx`, `contagem.tsx`
- Importação: sem pipeline atual — rotas/volumes são semeados manualmente ou fora do fluxo do usuário.
- Substituição: não há. Volumes existem enquanto a rota existir.
- Exclusão/arquivamento: hard delete da rota cascateia (ver migrations base). Recebimentos históricos dependem da FK real — verificar em integração.

## Pipeline B — Escalas / Shipments (importação Excel)

- Tabelas: `importacoes_escala`, `escalas`, `shipments` (id textual = Shipment).
- Cardinalidade: 1 importação → N escalas → N shipments por rota otimizada.
- Coluna lida pelo scanner (Triagem): `escalas.shipment` (`src/lib/triagem.functions.ts`).
- Consumidores:
  - `src/lib/triagem.functions.ts`, `src/routes/_authenticated/triagem.tsx`
  - `src/routes/_authenticated/bases.tsx` (import + histórico)
- Importação: upload xlsx, aba "Base AM", colunas B ("Rota Otimizada") e C ("Shipment").
- Substituição: novo upload cria nova `importacoes_escala`; leitura sempre pela mais recente do dia + base.
- Exclusão/arquivamento: cancelar arquivo apaga a importação; histórico permanece via `historico.functions.ts`.

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
| Coluna scanner recebimento | `volumes.codigo` (L96) | — |
| Coluna scanner triagem | `escalas.shipment` | — |
| Base do operador vs base da rota | log usa `r.base_id` (L172, L207, L249) | — |
| Efeito RLS de outra base | policies presentes nas migrations | Efeito prático depende de execução em Postgres |
| Duplicidade sob concorrência | check-then-act sem lock no código | Ordem exata de commit depende de PG |

## Estado atual: DOIS PIPELINES PARALELOS

Nenhuma decisão canônica foi tomada. Rotas/volumes não são alimentadas
pela importação de escalas; escalas não geram volumes. Ver
`matriz-modelo-canonico.md`.
