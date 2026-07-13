
CREATE TABLE IF NOT EXISTS public.importacoes_escala (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id UUID NOT NULL REFERENCES public.bases(id) ON DELETE CASCADE,
  data_operacional DATE NOT NULL,
  versao INTEGER NOT NULL DEFAULT 1,
  ativa BOOLEAN NOT NULL DEFAULT true,
  importado_por UUID REFERENCES public.profiles(id),
  importado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  arquivada_em TIMESTAMPTZ,
  arquivada_por UUID REFERENCES public.profiles(id),
  arquivo_nome TEXT,
  total_linhas INTEGER NOT NULL DEFAULT 0,
  total_pacotes INTEGER NOT NULL DEFAULT 0,
  total_motoristas INTEGER NOT NULL DEFAULT 0,
  total_rotas INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (base_id, data_operacional, versao)
);
CREATE INDEX IF NOT EXISTS idx_imp_escala_base_dia ON public.importacoes_escala(base_id, data_operacional);
CREATE INDEX IF NOT EXISTS idx_imp_escala_ativa ON public.importacoes_escala(base_id, data_operacional) WHERE ativa;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.importacoes_escala TO authenticated;
GRANT ALL ON public.importacoes_escala TO service_role;
ALTER TABLE public.importacoes_escala ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados leem importacoes" ON public.importacoes_escala;
DROP POLICY IF EXISTS "Autenticados inserem importacoes" ON public.importacoes_escala;
DROP POLICY IF EXISTS "Autenticados atualizam importacoes" ON public.importacoes_escala;
CREATE POLICY "Autenticados leem importacoes"
  ON public.importacoes_escala FOR SELECT TO authenticated USING (true);
CREATE POLICY "Autenticados inserem importacoes"
  ON public.importacoes_escala FOR INSERT TO authenticated
  WITH CHECK (importado_por = auth.uid());
CREATE POLICY "Autenticados atualizam importacoes"
  ON public.importacoes_escala FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_imp_escala_touch ON public.importacoes_escala;
CREATE TRIGGER trg_imp_escala_touch
  BEFORE UPDATE ON public.importacoes_escala
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS importacao_id UUID REFERENCES public.importacoes_escala(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_escalas_importacao ON public.escalas(importacao_id);

DO $$
DECLARE
  r RECORD;
  novo_id UUID;
  quem UUID;
  quando TIMESTAMPTZ;
BEGIN
  FOR r IN
    SELECT
      base_id,
      data_referencia,
      COUNT(*)::INT AS linhas,
      COALESCE(SUM(pacotes), 0)::INT AS pacotes,
      COUNT(DISTINCT driver)::INT AS motoristas,
      COUNT(DISTINCT planejada)::INT AS rotas
    FROM public.escalas
    WHERE data_referencia IS NOT NULL
      AND base_id IS NOT NULL
      AND importacao_id IS NULL
    GROUP BY base_id, data_referencia
  LOOP
    SELECT importado_por, created_at INTO quem, quando
    FROM public.escalas
    WHERE base_id = r.base_id AND data_referencia = r.data_referencia
    ORDER BY created_at ASC
    LIMIT 1;

    INSERT INTO public.importacoes_escala
      (base_id, data_operacional, versao, ativa, importado_por, importado_em,
       total_linhas, total_pacotes, total_motoristas, total_rotas)
    VALUES
      (r.base_id, r.data_referencia, 1, true, quem, COALESCE(quando, now()),
       r.linhas, r.pacotes, r.motoristas, r.rotas)
    ON CONFLICT (base_id, data_operacional, versao) DO NOTHING
    RETURNING id INTO novo_id;

    IF novo_id IS NULL THEN
      SELECT id INTO novo_id FROM public.importacoes_escala
      WHERE base_id = r.base_id AND data_operacional = r.data_referencia AND versao = 1;
    END IF;

    UPDATE public.escalas
      SET importacao_id = novo_id
      WHERE base_id = r.base_id AND data_referencia = r.data_referencia AND importacao_id IS NULL;
  END LOOP;
END$$;

CREATE TABLE IF NOT EXISTS public.contagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id UUID NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  data_operacional DATE NOT NULL,
  usuario_id UUID NOT NULL REFERENCES public.profiles(id),
  iniciada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_em TIMESTAMPTZ,
  total_esperado INTEGER NOT NULL DEFAULT 0,
  total_contado INTEGER NOT NULL DEFAULT 0,
  divergencia INTEGER NOT NULL DEFAULT 0,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contagens_base_dia ON public.contagens(base_id, data_operacional);
CREATE INDEX IF NOT EXISTS idx_contagens_usuario ON public.contagens(usuario_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contagens TO authenticated;
GRANT ALL ON public.contagens TO service_role;
ALTER TABLE public.contagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados leem contagens" ON public.contagens;
DROP POLICY IF EXISTS "Usuario cria proprias contagens" ON public.contagens;
DROP POLICY IF EXISTS "Usuario atualiza proprias contagens ou admin/gerente" ON public.contagens;
CREATE POLICY "Autenticados leem contagens"
  ON public.contagens FOR SELECT TO authenticated USING (true);
CREATE POLICY "Usuario cria proprias contagens"
  ON public.contagens FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid());
CREATE POLICY "Usuario atualiza proprias contagens ou admin/gerente"
  ON public.contagens FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'))
  WITH CHECK (usuario_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

DROP TRIGGER IF EXISTS trg_contagens_touch ON public.contagens;
CREATE TRIGGER trg_contagens_touch
  BEFORE UPDATE ON public.contagens
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.volumes
  ADD COLUMN IF NOT EXISTS contagem_id UUID REFERENCES public.contagens(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_id UUID REFERENCES public.bases(id),
  ADD COLUMN IF NOT EXISTS data_operacional DATE;
CREATE INDEX IF NOT EXISTS idx_volumes_contagem ON public.volumes(contagem_id);
CREATE INDEX IF NOT EXISTS idx_volumes_base_dia ON public.volumes(base_id, data_operacional);

ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS data_operacional DATE;
CREATE INDEX IF NOT EXISTS idx_recebimentos_base_dia ON public.recebimentos(base_id, data_operacional);
