
ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS triado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS triado_em timestamptz,
  ADD COLUMN IF NOT EXISTS triado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recebido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recebido_em timestamptz,
  ADD COLUMN IF NOT EXISTS recebido_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_escalas_shipment_lookup
  ON public.escalas (base_id, importacao_id, shipment)
  WHERE shipment IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_escalas_triado
  ON public.escalas (importacao_id, triado);
