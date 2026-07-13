# Matriz de resultados — `registrar_bipagem_escala`

Legenda: E = escalas, R = recebimentos, A = audit_logs.

| Resultado    | Condição principal                                                      | Atualiza E?              | escala_id | importacao_id | base_rota_id | R criado | A criado | Retorno ao operador |
|--------------|-------------------------------------------------------------------------|--------------------------|-----------|---------------|--------------|----------|----------|---------------------|
| `ok`         | Shipment achado em base+data corretas; UPDATE condicional bem-sucedido  | Sim (recebido/triado)    | Sim       | Sim           | Sim (=leitura) | Sim    | Sim      | ok + mensagem       |
| `duplicado`  | Shipment achado em base+data corretas; UPDATE não afetou (flag já true) | Não                      | Sim       | Sim           | Sim (=leitura) | Sim    | Sim      | duplicado + mensagem |
| `outra_rota` | Achado em base+data, mas `otimizada`/`planejada` ≠ `p_rota_selecionada` | Não                      | Sim       | Sim           | Sim (=leitura) | Sim    | Sim      | outra_rota + mensagem |
| `outra_data` | Não achado em base+data; achado em mesma base, outra data ativa         | Não                      | Sim       | Sim           | Sim (=leitura) | Sim    | Sim      | outra_data + mensagem |
| `outra_base` | Não achado na base; achado em importação ativa de outra base            | Não                      | Sim       | Sim           | Sim (≠ leitura) | Sim   | Sim      | outra_base + `{id, codigo, nome}` da base_rota, sem PII |
| `inexistente`| Não achado em nenhuma importação ativa                                  | Não                      | NULL      | NULL          | NULL         | Sim      | Sim      | inexistente + mensagem |
| `cancelada` / `encerrada` | **Não emitidos** — não há coluna de status por escala. Manter fora até existir objeto real. | – | – | – | – | – | – | – |
| retry (idempotência) | Mesmo `operador_id` + `client_event_id` já persistido             | Não                      | Reflete evento original | Reflete | Reflete | Não (retorna existente) | Não | DTO seguro reconstruído do evento original |

Notas:
- `base_id` (legado) recebe sempre `p_base_leitura_id` para manter compatibilidade com relatórios existentes até o "switchover".
- `rota_id` e `volume_id` legados são sempre NULL nesta RPC.
- Se `audit_logs` falhar (constraint, RLS, etc.), o `RAISE` interrompe a
  função dentro da transação implícita da chamada — o UPDATE em escalas e o
  INSERT em recebimentos são revertidos.