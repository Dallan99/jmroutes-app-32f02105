
-- ============================================================
-- 1) USER_BASES (supervisor multi-base)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_bases (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, base_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bases TO authenticated;
GRANT ALL ON public.user_bases TO service_role;

ALTER TABLE public.user_bases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_bases dono ou admin veem"
  ON public.user_bases FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));

CREATE POLICY "user_bases admin gerente escrevem"
  ON public.user_bases FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));

-- ============================================================
-- 2) FUNÇÕES DE ACESSO POR BASE
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _base_id IS NULL
    OR public.has_role(_user_id, 'admin')
    OR public.has_role(_user_id, 'gerente')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.base_id = _base_id)
    OR EXISTS (SELECT 1 FROM public.user_bases ub WHERE ub.user_id = _user_id AND ub.base_id = _base_id);
$$;

CREATE OR REPLACE FUNCTION public.get_allowed_bases(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.bases WHERE public.has_base_access(_user_id, id);
$$;

-- ============================================================
-- 3) RLS: bases_operacionais
-- ============================================================
DROP POLICY IF EXISTS "staff ver bases operacionais" ON public.bases_operacionais;
DROP POLICY IF EXISTS "staff criar bases operacionais" ON public.bases_operacionais;
DROP POLICY IF EXISTS "staff atualizar bases operacionais" ON public.bases_operacionais;
DROP POLICY IF EXISTS "admin remove bases" ON public.bases_operacionais;

CREATE POLICY "base access ver bases operacionais"
  ON public.bases_operacionais FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), (
    SELECT b.id FROM public.bases b WHERE b.codigo = bases_operacionais.facility LIMIT 1
  )) OR importado_por = auth.uid());

CREATE POLICY "base access criar bases operacionais"
  ON public.bases_operacionais FOR INSERT TO authenticated
  WITH CHECK (
    importado_por = auth.uid()
    AND public.has_base_access(auth.uid(), (
      SELECT b.id FROM public.bases b WHERE b.codigo = bases_operacionais.facility LIMIT 1
    ))
  );

CREATE POLICY "base access atualizar bases operacionais"
  ON public.bases_operacionais FOR UPDATE TO authenticated
  USING (public.has_base_access(auth.uid(), (
    SELECT b.id FROM public.bases b WHERE b.codigo = bases_operacionais.facility LIMIT 1
  )))
  WITH CHECK (public.has_base_access(auth.uid(), (
    SELECT b.id FROM public.bases b WHERE b.codigo = bases_operacionais.facility LIMIT 1
  )));

CREATE POLICY "admin remove bases operacionais"
  ON public.bases_operacionais FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- ============================================================
-- 4) RLS: shipments (assumindo coluna base_operacional_id ou base_id)
-- ============================================================
DO $$
DECLARE
  has_base_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='base_operacional_id'
  ) INTO has_base_id;

  -- Drop policies existentes
  EXECUTE 'DROP POLICY IF EXISTS "staff ver shipments" ON public.shipments';
  EXECUTE 'DROP POLICY IF EXISTS "staff criar shipments" ON public.shipments';
  EXECUTE 'DROP POLICY IF EXISTS "staff atualizar shipments" ON public.shipments';
  EXECUTE 'DROP POLICY IF EXISTS "staff deletar shipments" ON public.shipments';
  EXECUTE 'DROP POLICY IF EXISTS "public read shipments" ON public.shipments';
  EXECUTE 'DROP POLICY IF EXISTS "public write shipments" ON public.shipments';

  IF has_base_id THEN
    EXECUTE $p$
      CREATE POLICY "base access ver shipments"
        ON public.shipments FOR SELECT TO authenticated
        USING (public.has_base_access(auth.uid(), (
          SELECT bo.id FROM public.bases b JOIN public.bases_operacionais bo ON bo.facility = b.codigo
          WHERE bo.id = shipments.base_operacional_id LIMIT 1
        )) OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'))
    $p$;
  ELSE
    EXECUTE 'CREATE POLICY "base access ver shipments" ON public.shipments FOR SELECT TO authenticated USING (has_role(auth.uid(), ''admin'') OR has_role(auth.uid(), ''gerente'') OR has_role(auth.uid(), ''supervisor'') OR has_role(auth.uid(), ''operador''))';
  END IF;

  EXECUTE 'CREATE POLICY "staff escreve shipments" ON public.shipments FOR ALL TO authenticated USING (has_role(auth.uid(), ''admin'') OR has_role(auth.uid(), ''supervisor'') OR has_role(auth.uid(), ''gerente'')) WITH CHECK (has_role(auth.uid(), ''admin'') OR has_role(auth.uid(), ''supervisor'') OR has_role(auth.uid(), ''gerente''))';
END $$;

-- ============================================================
-- 5) RLS: importacoes_escala
-- ============================================================
DROP POLICY IF EXISTS "Staff ou base leem importacoes" ON public.importacoes_escala;
DROP POLICY IF EXISTS "Autenticados inserem importacoes" ON public.importacoes_escala;
DROP POLICY IF EXISTS "Dono ou admin/gerente atualizam importacoes" ON public.importacoes_escala;

CREATE POLICY "base access leem importacoes"
  ON public.importacoes_escala FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id) OR importado_por = auth.uid());

CREATE POLICY "base access inserem importacoes"
  ON public.importacoes_escala FOR INSERT TO authenticated
  WITH CHECK (importado_por = auth.uid() AND public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access atualizam importacoes"
  ON public.importacoes_escala FOR UPDATE TO authenticated
  USING (public.has_base_access(auth.uid(), base_id))
  WITH CHECK (public.has_base_access(auth.uid(), base_id));

-- ============================================================
-- 6) RLS: escalas
-- ============================================================
DROP POLICY IF EXISTS "Staff leem escalas da propria base" ON public.escalas;
DROP POLICY IF EXISTS "Autenticados inserem escalas" ON public.escalas;
DROP POLICY IF EXISTS "Staff deletam escalas da propria base" ON public.escalas;

CREATE POLICY "base access leem escalas"
  ON public.escalas FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id) OR importado_por = auth.uid());

CREATE POLICY "base access inserem escalas"
  ON public.escalas FOR INSERT TO authenticated
  WITH CHECK (importado_por = auth.uid() AND public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access atualizam escalas"
  ON public.escalas FOR UPDATE TO authenticated
  USING (public.has_base_access(auth.uid(), base_id))
  WITH CHECK (public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access deletam escalas"
  ON public.escalas FOR DELETE TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));

-- ============================================================
-- 7) RLS: contagens
-- ============================================================
DROP POLICY IF EXISTS "Staff ou dono leem contagens" ON public.contagens;
DROP POLICY IF EXISTS "Usuario cria proprias contagens" ON public.contagens;
DROP POLICY IF EXISTS "Usuario atualiza proprias contagens ou admin/gerente" ON public.contagens;

CREATE POLICY "base access leem contagens"
  ON public.contagens FOR SELECT TO authenticated
  USING (usuario_id = auth.uid() OR public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access cria contagens"
  ON public.contagens FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid() AND public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access atualiza contagens"
  ON public.contagens FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid() OR public.has_base_access(auth.uid(), base_id))
  WITH CHECK (usuario_id = auth.uid() OR public.has_base_access(auth.uid(), base_id));

-- ============================================================
-- 8) RLS: rotas / volumes / recebimentos — adiciona base_access
-- (mantém políticas existentes que já funcionam)
-- ============================================================
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='rotas' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.rotas', pol.policyname);
  END LOOP;
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='volumes' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.volumes', pol.policyname);
  END LOOP;
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='recebimentos' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.recebimentos', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "base access rotas select"
  ON public.rotas FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access rotas write"
  ON public.rotas FOR ALL TO authenticated
  USING (public.has_base_access(auth.uid(), base_id))
  WITH CHECK (public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access volumes select"
  ON public.volumes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rotas r WHERE r.id = volumes.rota_id AND public.has_base_access(auth.uid(), r.base_id)));

CREATE POLICY "base access volumes write"
  ON public.volumes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rotas r WHERE r.id = volumes.rota_id AND public.has_base_access(auth.uid(), r.base_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rotas r WHERE r.id = volumes.rota_id AND public.has_base_access(auth.uid(), r.base_id)));

CREATE POLICY "base access recebimentos select"
  ON public.recebimentos FOR SELECT TO authenticated
  USING (operador_id = auth.uid() OR public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access recebimentos insert"
  ON public.recebimentos FOR INSERT TO authenticated
  WITH CHECK (operador_id = auth.uid());

-- ============================================================
-- 9) DEVOLUÇÕES
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.motivo_devolucao AS ENUM (
    'cliente_ausente',
    'endereco_nao_localizado',
    'recusado',
    'avaria',
    'zona_de_risco',
    'outros'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.devolucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid REFERENCES public.bases(id),
  base_operacional_id uuid REFERENCES public.bases_operacionais(id),
  escala_id uuid REFERENCES public.escalas(id) ON DELETE SET NULL,
  shipment_codigo text NOT NULL,
  rota text,
  motorista text,
  motivo public.motivo_devolucao NOT NULL,
  observacao text,
  devolvido_por uuid NOT NULL DEFAULT auth.uid(),
  devolvido_em timestamptz NOT NULL DEFAULT now(),
  cancelado boolean NOT NULL DEFAULT false,
  cancelado_em timestamptz,
  cancelado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS devolucoes_base_dia_idx ON public.devolucoes (base_id, devolvido_em DESC);
CREATE INDEX IF NOT EXISTS devolucoes_shipment_idx ON public.devolucoes (shipment_codigo);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.devolucoes TO authenticated;
GRANT ALL ON public.devolucoes TO service_role;

ALTER TABLE public.devolucoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "base access devolucoes select"
  ON public.devolucoes FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id) OR devolvido_por = auth.uid());

CREATE POLICY "base access devolucoes insert"
  ON public.devolucoes FOR INSERT TO authenticated
  WITH CHECK (devolvido_por = auth.uid() AND public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access devolucoes update"
  ON public.devolucoes FOR UPDATE TO authenticated
  USING (public.has_base_access(auth.uid(), base_id))
  WITH CHECK (public.has_base_access(auth.uid(), base_id));

CREATE POLICY "admin gerente devolucoes delete"
  ON public.devolucoes FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));

CREATE TRIGGER tg_devolucoes_updated
BEFORE UPDATE ON public.devolucoes
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Flag na escala p/ consulta rápida
ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS devolvido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS devolvido_em timestamptz,
  ADD COLUMN IF NOT EXISTS devolvido_motivo public.motivo_devolucao;
