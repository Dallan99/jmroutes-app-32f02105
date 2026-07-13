
-- Enum de status
DO $$ BEGIN
  CREATE TYPE public.base_status AS ENUM ('aguardando', 'ativa', 'arquivada', 'erro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Tabela bases_operacionais
CREATE TABLE IF NOT EXISTS public.bases_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_operacional date NOT NULL,
  status public.base_status NOT NULL DEFAULT 'aguardando',
  facility text,
  transportadora text,
  escala_jm_nome text,
  escala_jm_hora timestamptz,
  escala_jm_rotas integer DEFAULT 0,
  escala_jm_pacotes integer DEFAULT 0,
  escala_xpt_nome text,
  escala_xpt_hora timestamptz,
  escala_xpt_shipments integer DEFAULT 0,
  escala_xpt_rotas integer DEFAULT 0,
  total_rotas integer DEFAULT 0,
  total_shipments integer DEFAULT 0,
  total_motoristas integer DEFAULT 0,
  total_veiculos integer DEFAULT 0,
  total_bairros integer DEFAULT 0,
  total_cidades integer DEFAULT 0,
  total_pacotes integer DEFAULT 0,
  importado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ativada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_operacional)
);

CREATE UNIQUE INDEX IF NOT EXISTS bases_operacionais_uma_ativa
  ON public.bases_operacionais ((status))
  WHERE status = 'ativa';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bases_operacionais TO authenticated;
GRANT ALL ON public.bases_operacionais TO service_role;

ALTER TABLE public.bases_operacionais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth ver bases" ON public.bases_operacionais
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth criar bases" ON public.bases_operacionais
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth atualizar bases" ON public.bases_operacionais
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin remove bases" ON public.bases_operacionais
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Tabela shipments (XPT)
CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_operacional_id uuid NOT NULL REFERENCES public.bases_operacionais(id) ON DELETE CASCADE,
  shipment_id text NOT NULL,
  rota text,
  motorista text,
  placa text,
  bairro text,
  cidade text,
  pacotes integer DEFAULT 0,
  status text DEFAULT 'pendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_operacional_id, shipment_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipments TO authenticated;
GRANT ALL ON public.shipments TO service_role;

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth ver shipments" ON public.shipments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth criar shipments" ON public.shipments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth atualizar shipments" ON public.shipments
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth remover shipments" ON public.shipments
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- FK em escalas -> base_operacional
ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS base_operacional_id uuid REFERENCES public.bases_operacionais(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_escalas_base_op ON public.escalas(base_operacional_id);
CREATE INDEX IF NOT EXISTS idx_shipments_base_op ON public.shipments(base_operacional_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_bases_op_updated ON public.bases_operacionais;
CREATE TRIGGER trg_bases_op_updated BEFORE UPDATE ON public.bases_operacionais
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_shipments_updated ON public.shipments;
CREATE TRIGGER trg_shipments_updated BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
