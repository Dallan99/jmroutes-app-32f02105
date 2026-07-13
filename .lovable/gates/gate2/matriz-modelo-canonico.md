# Matriz — modelo canônico candidato

Nenhuma decisão foi tomada. Comparação com evidência de código atual.

| Dimensão | Pipeline A — rotas/volumes | Pipeline B — escalas/shipments |
|---|---|---|
| Origem do dado | manual / script | upload xlsx do parceiro |
| Identidade do item | `volumes.codigo` | `escalas.shipment` (texto do parceiro) |
| Escopo por base | FK `rotas.base_id` | `escalas.base_id` + `importacoes_escala.base_id` |
| Histórico | `recebimentos` (append-only) | `historico` por dia |
| Cobertura de telas | Recebimento, Contagem | Triagem |
| Auditoria | `audit_logs` via `registrarAuditInterno` | `audit_logs` idem |
| Concorrência | check-then-act sem lock | check-then-act sem lock |
| RLS por base | policies presentes | policies presentes |
| Sinergia com RPC futura | requer FK volume→shipment | requer criar volumes a partir de escala |

## Riscos de decidir agora

- Adotar B sem plano de migração deixa recebimentos existentes órfãos.
- Adotar A sem alimentador mantém Triagem desconectada.
- Fusão exige ETL não presente no repositório.

## Recomendação de PROCESSO (não decisão de modelo)

1. Confirmar backup recuperável (Gate 1 continua bloqueado).
2. Rodar integração em banco separado sobre a RPC candidata
   (`.lovable/gates/gate2/rpc_registrar_bipagem_escala.sql`).
3. Só então escolher A, B ou fusão.
