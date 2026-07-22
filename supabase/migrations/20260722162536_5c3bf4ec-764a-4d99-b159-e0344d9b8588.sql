
-- ============================================================
-- Módulo piloto: Integração Meli
-- ============================================================

-- ---------- meli_rotas ----------
CREATE TABLE public.meli_rotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id text NOT NULL UNIQUE,
  cluster text,
  carrier text,
  facility text,
  data_rota date,
  total_pacotes integer NOT NULL DEFAULT 0,
  total_impressos integer NOT NULL DEFAULT 0,
  origem_importacao uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.meli_rotas TO authenticated;
GRANT ALL ON public.meli_rotas TO service_role;

ALTER TABLE public.meli_rotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meli_rotas_select_privilegiado"
  ON public.meli_rotas FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE TRIGGER meli_rotas_touch_updated_at
  BEFORE UPDATE ON public.meli_rotas
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE INDEX meli_rotas_data_rota_idx ON public.meli_rotas(data_rota);
CREATE INDEX meli_rotas_cluster_idx ON public.meli_rotas(cluster);

-- ---------- meli_pacotes ----------
CREATE TABLE public.meli_pacotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rota_id uuid NOT NULL REFERENCES public.meli_rotas(id) ON DELETE CASCADE,
  tracking_id text NOT NULL,
  shipment_id text,
  destinatario text,
  endereco text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  status text,
  printed_label text,
  ordem integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rota_id, tracking_id)
);

GRANT SELECT ON public.meli_pacotes TO authenticated;
GRANT ALL ON public.meli_pacotes TO service_role;

ALTER TABLE public.meli_pacotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meli_pacotes_select_privilegiado"
  ON public.meli_pacotes FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE TRIGGER meli_pacotes_touch_updated_at
  BEFORE UPDATE ON public.meli_pacotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE INDEX meli_pacotes_rota_id_idx ON public.meli_pacotes(rota_id);
CREATE INDEX meli_pacotes_tracking_idx ON public.meli_pacotes(tracking_id);

-- ---------- meli_importacoes ----------
CREATE TABLE public.meli_importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_nome text,
  status text NOT NULL DEFAULT 'pendente',
  total_rotas integer NOT NULL DEFAULT 0,
  total_pacotes integer NOT NULL DEFAULT 0,
  total_erros integer NOT NULL DEFAULT 0,
  mensagem_erro text,
  importado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.meli_importacoes TO authenticated;
GRANT ALL ON public.meli_importacoes TO service_role;

ALTER TABLE public.meli_importacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meli_importacoes_select_privilegiado"
  ON public.meli_importacoes FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE TRIGGER meli_importacoes_touch_updated_at
  BEFORE UPDATE ON public.meli_importacoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Vínculo tardio: origem_importacao em meli_rotas
ALTER TABLE public.meli_rotas
  ADD CONSTRAINT meli_rotas_origem_importacao_fkey
  FOREIGN KEY (origem_importacao) REFERENCES public.meli_importacoes(id) ON DELETE SET NULL;

-- ---------- meli_rotas_payload (bruto, restrito a admins) ----------
CREATE TABLE public.meli_rotas_payload (
  rota_id uuid PRIMARY KEY REFERENCES public.meli_rotas(id) ON DELETE CASCADE,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.meli_rotas_payload TO authenticated;
GRANT ALL ON public.meli_rotas_payload TO service_role;

ALTER TABLE public.meli_rotas_payload ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meli_rotas_payload_admin_only"
  ON public.meli_rotas_payload FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER meli_rotas_payload_touch_updated_at
  BEFORE UPDATE ON public.meli_rotas_payload
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
