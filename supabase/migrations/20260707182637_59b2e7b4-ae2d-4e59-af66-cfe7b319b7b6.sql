
ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS facility_id text,
  ADD COLUMN IF NOT EXISTS shipment text,
  ADD COLUMN IF NOT EXISTS nro_rota text,
  ADD COLUMN IF NOT EXISTS ordem integer,
  ADD COLUMN IF NOT EXISTS rua text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS referencias text,
  ADD COLUMN IF NOT EXISTS duracao numeric,
  ADD COLUMN IF NOT EXISTS distancia numeric,
  ADD COLUMN IF NOT EXISTS order_id_veiculo text,
  ADD COLUMN IF NOT EXISTS ocupacao numeric,
  ADD COLUMN IF NOT EXISTS spr numeric,
  ADD COLUMN IF NOT EXISTS parada text,
  ADD COLUMN IF NOT EXISTS cluster text,
  ADD COLUMN IF NOT EXISTS transportadora text;

CREATE INDEX IF NOT EXISTS idx_escalas_importacao_shipment
  ON public.escalas (importacao_id, shipment);
CREATE INDEX IF NOT EXISTS idx_escalas_importacao_planejada
  ON public.escalas (importacao_id, planejada);
