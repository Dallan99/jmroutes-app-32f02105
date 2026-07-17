-- JMRoutes — Inventário centralizado
-- Migration aditiva. Não remove dados locais existentes e não executa backfill automático.

BEGIN;

CREATE TABLE IF NOT EXISTS public.inventarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  dia_operacional date NOT NULL,
  responsavel text,
  observacao text,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'finalizado', 'cancelado')),
  criado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  finalizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  finalizado_em timestamptz,
  cancelado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelado_em timestamptz,
  cancelamento_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_id, dia_operacional)
);

CREATE TABLE IF NOT EXISTS public.inventario_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL REFERENCES public.inventarios(id) ON DELETE RESTRICT,
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  dia_operacional date NOT NULL,
  codigo text NOT NULL,
  bipado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  bipado_em timestamptz NOT NULL DEFAULT now(),
  cancelado boolean NOT NULL DEFAULT false,
  cancelado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelado_em timestamptz,
  cancelamento_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(codigo)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_leitura_ativa
  ON public.inventario_leituras (inventario_id, codigo)
  WHERE cancelado = false;

CREATE INDEX IF NOT EXISTS idx_inventarios_base_dia
  ON public.inventarios (base_id, dia_operacional DESC);

CREATE INDEX IF NOT EXISTS idx_inventario_leituras_base_dia
  ON public.inventario_leituras (base_id, dia_operacional DESC, bipado_em DESC);

CREATE INDEX IF NOT EXISTS idx_inventario_leituras_codigo
  ON public.inventario_leituras (codigo, bipado_em DESC);

DROP TRIGGER IF EXISTS trg_inventarios_updated ON public.inventarios;
CREATE TRIGGER trg_inventarios_updated
  BEFORE UPDATE ON public.inventarios
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE OR REPLACE FUNCTION public.inventario_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
      AND p.ativo = true
      AND (
        public.has_role(_user_id, 'admin')
        OR p.base_id = _base_id
        OR EXISTS (
          SELECT 1 FROM public.user_bases ub
          WHERE ub.user_id = _user_id AND ub.base_id = _base_id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.inventario_global_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND p.ativo = true
      AND public.has_role(_user_id, 'admin')
  );
$$;

ALTER TABLE public.inventarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_leituras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventarios select autorizados" ON public.inventarios
  FOR SELECT TO authenticated
  USING (public.inventario_base_access(auth.uid(), base_id));

CREATE POLICY "inventarios insert autorizados" ON public.inventarios
  FOR INSERT TO authenticated
  WITH CHECK (
    criado_por = auth.uid()
    AND public.inventario_base_access(auth.uid(), base_id)
  );

CREATE POLICY "inventarios update autorizados" ON public.inventarios
  FOR UPDATE TO authenticated
  USING (public.inventario_base_access(auth.uid(), base_id))
  WITH CHECK (public.inventario_base_access(auth.uid(), base_id));

CREATE POLICY "inventario leituras select autorizadas" ON public.inventario_leituras
  FOR SELECT TO authenticated
  USING (public.inventario_base_access(auth.uid(), base_id));

CREATE POLICY "inventario leituras insert autorizadas" ON public.inventario_leituras
  FOR INSERT TO authenticated
  WITH CHECK (
    bipado_por = auth.uid()
    AND public.inventario_base_access(auth.uid(), base_id)
  );

CREATE POLICY "inventario leituras update autorizadas" ON public.inventario_leituras
  FOR UPDATE TO authenticated
  USING (public.inventario_base_access(auth.uid(), base_id))
  WITH CHECK (public.inventario_base_access(auth.uid(), base_id));

GRANT SELECT, INSERT, UPDATE ON public.inventarios TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.inventario_leituras TO authenticated;
GRANT ALL ON public.inventarios, public.inventario_leituras TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_leitura_inventario(
  p_base_id uuid,
  p_dia_operacional date,
  p_codigo text,
  p_responsavel text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inventario_id uuid;
  v_leitura_id uuid;
  v_existente public.inventario_leituras%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT public.inventario_base_access(v_uid, p_base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF p_dia_operacional IS NULL OR length(btrim(coalesce(p_codigo, ''))) < 1 THEN
    RAISE EXCEPTION 'dados_invalidos' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.inventarios (
    base_id, dia_operacional, responsavel, observacao, criado_por
  ) VALUES (
    p_base_id, p_dia_operacional, nullif(btrim(p_responsavel), ''),
    nullif(btrim(p_observacao), ''), v_uid
  )
  ON CONFLICT (base_id, dia_operacional)
  DO UPDATE SET
    responsavel = coalesce(nullif(btrim(EXCLUDED.responsavel), ''), public.inventarios.responsavel),
    observacao = coalesce(nullif(btrim(EXCLUDED.observacao), ''), public.inventarios.observacao)
  RETURNING id INTO v_inventario_id;

  SELECT * INTO v_existente
  FROM public.inventario_leituras
  WHERE inventario_id = v_inventario_id
    AND codigo = btrim(p_codigo)
    AND cancelado = false
  ORDER BY bipado_em DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'resultado', 'duplicado',
      'mensagem', 'Código já bipado neste inventário.',
      'leitura_id', v_existente.id,
      'bipado_em', v_existente.bipado_em
    );
  END IF;

  INSERT INTO public.inventario_leituras (
    inventario_id, base_id, dia_operacional, codigo, bipado_por
  ) VALUES (
    v_inventario_id, p_base_id, p_dia_operacional, btrim(p_codigo), v_uid
  ) RETURNING id INTO v_leitura_id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (
    v_uid,
    'inventario.leitura.registrar',
    'inventario_leitura',
    v_leitura_id::text,
    jsonb_build_object('base_id', p_base_id, 'dia_operacional', p_dia_operacional, 'codigo', btrim(p_codigo))
  );

  RETURN jsonb_build_object(
    'resultado', 'ok',
    'mensagem', 'Código registrado no inventário.',
    'inventario_id', v_inventario_id,
    'leitura_id', v_leitura_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalizar_inventario(
  p_inventario_id uuid,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.inventarios%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv FROM public.inventarios WHERE id = p_inventario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventario_nao_encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.inventario_base_access(v_uid, v_inv.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;

  UPDATE public.inventarios
  SET status = 'finalizado',
      finalizado_por = v_uid,
      finalizado_em = now(),
      observacao = coalesce(nullif(btrim(p_observacao), ''), observacao)
  WHERE id = p_inventario_id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'inventario.finalizar', 'inventario', p_inventario_id::text, '{}'::jsonb);

  RETURN jsonb_build_object('id', p_inventario_id, 'status', 'finalizado');
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_leitura_inventario(uuid, date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalizar_inventario(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_leitura_inventario(uuid, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_inventario(uuid, text) TO authenticated;

COMMIT;
