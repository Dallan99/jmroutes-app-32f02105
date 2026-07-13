
-- Cria as 4 bases ESP
INSERT INTO public.bases (codigo, nome, cidade, uf) VALUES
  ('ESP15', 'Base Ibiúna', 'Ibiúna', 'SP'),
  ('ESP16', 'Base Guarujá', 'Guarujá', 'SP'),
  ('ESP17', 'Base Embu Guaçu', 'Embu Guaçu', 'SP'),
  ('ESP18', 'Base Franco da Rocha', 'Franco da Rocha', 'SP')
ON CONFLICT (codigo) DO NOTHING;

-- Tabela de escala importada
CREATE TABLE IF NOT EXISTS public.escalas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE CASCADE,
  data_referencia date NOT NULL DEFAULT CURRENT_DATE,
  planejada text,
  otimizada text,
  pacotes integer,
  paradas integer,
  modal text,
  bairro text,
  cidade text,
  giro text,
  vaga text,
  tipo text,
  roteiro text,
  placa text,
  driver text,
  placa_troca text,
  importado_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escalas_base_data_idx ON public.escalas(base_id, data_referencia DESC);
CREATE INDEX IF NOT EXISTS escalas_planejada_idx ON public.escalas(planejada);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalas TO authenticated;
GRANT ALL ON public.escalas TO service_role;

ALTER TABLE public.escalas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados leem escalas"
  ON public.escalas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin/Supervisor inserem escalas"
  ON public.escalas FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

CREATE POLICY "Admin/Supervisor deletam escalas"
  ON public.escalas FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));
