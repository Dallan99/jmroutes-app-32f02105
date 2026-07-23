
-- =========================================================
-- FKs (idempotentes)
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meli_pacotes_rota_id_fkey') THEN
    ALTER TABLE public.meli_pacotes
      ADD CONSTRAINT meli_pacotes_rota_id_fkey
      FOREIGN KEY (rota_id) REFERENCES public.meli_rotas(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meli_rotas_payload_rota_id_fkey') THEN
    ALTER TABLE public.meli_rotas_payload
      ADD CONSTRAINT meli_rotas_payload_rota_id_fkey
      FOREIGN KEY (rota_id) REFERENCES public.meli_rotas(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meli_rotas_origem_importacao_fkey') THEN
    ALTER TABLE public.meli_rotas
      ADD CONSTRAINT meli_rotas_origem_importacao_fkey
      FOREIGN KEY (origem_importacao) REFERENCES public.meli_importacoes(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meli_importacoes_importado_por_fkey') THEN
    ALTER TABLE public.meli_importacoes
      ADD CONSTRAINT meli_importacoes_importado_por_fkey
      FOREIGN KEY (importado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =========================================================
-- Triggers updated_at
-- =========================================================
DROP TRIGGER IF EXISTS trg_meli_rotas_updated ON public.meli_rotas;
CREATE TRIGGER trg_meli_rotas_updated BEFORE UPDATE ON public.meli_rotas
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_meli_pacotes_updated ON public.meli_pacotes;
CREATE TRIGGER trg_meli_pacotes_updated BEFORE UPDATE ON public.meli_pacotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_meli_importacoes_updated ON public.meli_importacoes;
CREATE TRIGGER trg_meli_importacoes_updated BEFORE UPDATE ON public.meli_importacoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_meli_rotas_payload_updated ON public.meli_rotas_payload;
CREATE TRIGGER trg_meli_rotas_payload_updated BEFORE UPDATE ON public.meli_rotas_payload
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =========================================================
-- Helper de autorização (sem parâmetros; lê auth.uid() internamente)
-- =========================================================
CREATE OR REPLACE FUNCTION public.meli_pode_operar()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'gerente'::app_role) OR
    public.has_role(auth.uid(), 'supervisor'::app_role)
  );
$$;
REVOKE ALL ON FUNCTION public.meli_pode_operar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_pode_operar() FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_pode_operar() TO authenticated;

-- =========================================================
-- Conversor seguro de int (privado; só chamado dentro das RPCs)
-- =========================================================
CREATE OR REPLACE FUNCTION public._meli_safe_int(p text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p IS NULL OR p = '' THEN RETURN NULL; END IF;
  IF p !~ '^-?\d+$' THEN RETURN NULL; END IF;
  BEGIN
    RETURN p::int;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END $$;
REVOKE ALL ON FUNCTION public._meli_safe_int(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._meli_safe_int(text) FROM anon;
REVOKE ALL ON FUNCTION public._meli_safe_int(text) FROM authenticated;

-- =========================================================
-- RPC: meli_importar_rota
-- =========================================================
CREATE OR REPLACE FUNCTION public.meli_importar_rota(
  p_payload jsonb,
  p_arquivo_nome text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_importacao_id uuid;
  v_route_id text;
  v_rota_id uuid;
  v_pacotes jsonb;
  v_recebidos int := 0;
  v_unicos int := 0;
  v_inseridos int := 0;
  v_atualizados int := 0;
  v_inalterados int := 0;
  v_invalidos int := 0;
  v_duplicados int := 0;
  v_ordem_invalida int := 0;
  v_status text := 'ok';
  v_erro text := NULL;
  v_sqlstate text := NULL;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('status','erro','erro','payload_invalido');
  END IF;

  v_route_id := nullif(btrim(coalesce(p_payload->>'meli_route_id', p_payload->>'route_id')), '');
  IF v_route_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','meli_route_id_obrigatorio');
  END IF;

  -- Registro da tentativa (fora do bloco EXCEPTION; sobrevive à subtransação)
  INSERT INTO public.meli_importacoes (arquivo_nome, status, importado_por)
  VALUES (nullif(btrim(p_arquivo_nome), ''), 'processando', v_uid)
  RETURNING id INTO v_importacao_id;

  -- Subtransação: bloco BEGIN...EXCEPTION do PL/pgSQL cria savepoint implícito.
  BEGIN
    v_pacotes := coalesce(p_payload->'pacotes', p_payload->'packages');

    IF v_pacotes IS NOT NULL AND jsonb_typeof(v_pacotes) <> 'array' THEN
      RAISE EXCEPTION 'pacotes_deve_ser_array' USING ERRCODE = '22023';
    END IF;
    IF v_pacotes IS NULL THEN v_pacotes := '[]'::jsonb; END IF;

    -- UPSERT rota
    INSERT INTO public.meli_rotas (
      route_id, cluster, carrier, facility, data_rota, origem_importacao
    ) VALUES (
      v_route_id,
      nullif(btrim(p_payload->>'cluster'), ''),
      nullif(btrim(p_payload->>'carrier'), ''),
      nullif(btrim(p_payload->>'facility'), ''),
      nullif(btrim(p_payload->>'data_rota'), '')::date,
      v_importacao_id
    )
    ON CONFLICT (route_id) DO UPDATE SET
      cluster = COALESCE(EXCLUDED.cluster, public.meli_rotas.cluster),
      carrier = COALESCE(EXCLUDED.carrier, public.meli_rotas.carrier),
      facility = COALESCE(EXCLUDED.facility, public.meli_rotas.facility),
      data_rota = COALESCE(EXCLUDED.data_rota, public.meli_rotas.data_rota),
      origem_importacao = EXCLUDED.origem_importacao
    RETURNING id INTO v_rota_id;

    -- Bloqueio por rota para serializar importações concorrentes do mesmo route_id
    PERFORM 1 FROM public.meli_rotas WHERE id = v_rota_id FOR UPDATE;

    -- UPSERT payload
    INSERT INTO public.meli_rotas_payload (rota_id, raw_payload)
    VALUES (v_rota_id, p_payload)
    ON CONFLICT (rota_id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload;

    -- Processamento dos pacotes com dedup (última ocorrência) e contadores reais
    WITH raw AS (
      SELECT
        ord AS pos,
        nullif(btrim(elem->>'tracking_id'), '') AS tracking_id,
        nullif(btrim(elem->>'shipment_id'), '') AS shipment_id,
        nullif(btrim(elem->>'destinatario'), '') AS destinatario,
        nullif(btrim(elem->>'endereco'), '') AS endereco,
        nullif(btrim(elem->>'bairro'), '') AS bairro,
        nullif(btrim(elem->>'cidade'), '') AS cidade,
        nullif(btrim(elem->>'uf'), '') AS uf,
        nullif(btrim(elem->>'cep'), '') AS cep,
        nullif(btrim(elem->>'status'), '') AS status,
        nullif(btrim(elem->>'printed_label'), '') AS printed_label,
        elem->>'sequencia' AS sequencia_raw,
        public._meli_safe_int(elem->>'sequencia') AS ordem_int
      FROM jsonb_array_elements(v_pacotes) WITH ORDINALITY AS t(elem, ord)
    ),
    validos AS (
      SELECT * FROM raw WHERE tracking_id IS NOT NULL
    ),
    dedup AS (
      SELECT DISTINCT ON (tracking_id) *
      FROM validos
      ORDER BY tracking_id, pos DESC
    ),
    up AS (
      INSERT INTO public.meli_pacotes (
        rota_id, tracking_id, shipment_id, destinatario, endereco,
        bairro, cidade, uf, cep, status, printed_label, ordem
      )
      SELECT v_rota_id, tracking_id, shipment_id, destinatario, endereco,
             bairro, cidade, uf, cep, status, printed_label, ordem_int
      FROM dedup
      ON CONFLICT (rota_id, tracking_id) DO UPDATE SET
        shipment_id   = EXCLUDED.shipment_id,
        destinatario  = EXCLUDED.destinatario,
        endereco      = EXCLUDED.endereco,
        bairro        = EXCLUDED.bairro,
        cidade        = EXCLUDED.cidade,
        uf            = EXCLUDED.uf,
        cep           = EXCLUDED.cep,
        status        = EXCLUDED.status,
        printed_label = EXCLUDED.printed_label,
        ordem         = EXCLUDED.ordem
      WHERE
        public.meli_pacotes.shipment_id   IS DISTINCT FROM EXCLUDED.shipment_id   OR
        public.meli_pacotes.destinatario  IS DISTINCT FROM EXCLUDED.destinatario  OR
        public.meli_pacotes.endereco      IS DISTINCT FROM EXCLUDED.endereco      OR
        public.meli_pacotes.bairro        IS DISTINCT FROM EXCLUDED.bairro        OR
        public.meli_pacotes.cidade        IS DISTINCT FROM EXCLUDED.cidade        OR
        public.meli_pacotes.uf            IS DISTINCT FROM EXCLUDED.uf            OR
        public.meli_pacotes.cep           IS DISTINCT FROM EXCLUDED.cep           OR
        public.meli_pacotes.status        IS DISTINCT FROM EXCLUDED.status        OR
        public.meli_pacotes.printed_label IS DISTINCT FROM EXCLUDED.printed_label OR
        public.meli_pacotes.ordem         IS DISTINCT FROM EXCLUDED.ordem
      RETURNING (xmax = 0) AS inserted
    ),
    stats AS (
      SELECT
        (SELECT count(*) FROM raw)::int      AS recebidos,
        (SELECT count(*) FROM raw WHERE tracking_id IS NULL)::int AS invalidos,
        (SELECT count(*) FROM dedup)::int    AS unicos,
        ((SELECT count(*) FROM validos) - (SELECT count(*) FROM dedup))::int AS duplicados,
        (SELECT count(*) FROM raw
           WHERE tracking_id IS NOT NULL
             AND sequencia_raw IS NOT NULL
             AND sequencia_raw <> ''
             AND ordem_int IS NULL)::int     AS ordem_invalida,
        (SELECT count(*) FROM up WHERE inserted)::int      AS inseridos,
        (SELECT count(*) FROM up WHERE NOT inserted)::int  AS atualizados
    )
    SELECT recebidos, invalidos, unicos, duplicados, ordem_invalida, inseridos, atualizados
    INTO v_recebidos, v_invalidos, v_unicos, v_duplicados, v_ordem_invalida, v_inseridos, v_atualizados
    FROM stats;

    v_inalterados := v_unicos - v_inseridos - v_atualizados;

    -- Recontabiliza a rota
    UPDATE public.meli_rotas
    SET total_pacotes = (SELECT count(*) FROM public.meli_pacotes WHERE rota_id = v_rota_id),
        total_impressos = (SELECT count(*) FROM public.meli_pacotes
                            WHERE rota_id = v_rota_id
                              AND printed_label IS NOT NULL
                              AND printed_label <> '')
    WHERE id = v_rota_id;

    v_status := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_erro := SQLERRM;
    v_status := 'erro';
    -- Todas as escritas do bloco (rota, pacotes, payload) são revertidas
    -- pela subtransação implícita do BEGIN...EXCEPTION. Zeramos os contadores.
    v_recebidos := 0; v_unicos := 0; v_inseridos := 0; v_atualizados := 0;
    v_inalterados := 0; v_invalidos := 0; v_duplicados := 0; v_ordem_invalida := 0;
    v_rota_id := NULL;
  END;

  -- Log final (fora da subtransação; sobrevive ao rollback interno)
  UPDATE public.meli_importacoes
  SET status = v_status,
      total_rotas = CASE WHEN v_status = 'ok' THEN 1 ELSE 0 END,
      total_pacotes = v_inseridos + v_atualizados,
      total_erros = CASE WHEN v_status = 'erro' THEN 1 ELSE 0 END,
      mensagem_erro = v_erro,
      finalizado_em = now()
  WHERE id = v_importacao_id;

  IF v_status = 'erro' THEN
    RETURN jsonb_build_object(
      'status','erro',
      'erro', v_erro,
      'sqlstate', v_sqlstate,
      'importacao_id', v_importacao_id
    );
  END IF;

  RETURN jsonb_build_object(
    'status','ok',
    'importacao_id', v_importacao_id,
    'rota_id', v_rota_id,
    'route_id', v_route_id,
    'pacotes_recebidos', v_recebidos,
    'pacotes_unicos', v_unicos,
    'pacotes_inseridos', v_inseridos,
    'pacotes_atualizados', v_atualizados,
    'pacotes_inalterados', v_inalterados,
    'pacotes_invalidos', v_invalidos,
    'pacotes_duplicados_no_payload', v_duplicados,
    'pacotes_com_ordem_invalida', v_ordem_invalida
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.meli_importar_rota(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_importar_rota(jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_importar_rota(jsonb, text) TO authenticated;

-- =========================================================
-- RPC: meli_listar_rotas
-- =========================================================
CREATE OR REPLACE FUNCTION public.meli_listar_rotas(
  p_cluster text DEFAULT NULL,
  p_data_de date DEFAULT NULL,
  p_data_ate date DEFAULT NULL,
  p_busca text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
  v_offset int := GREATEST(coalesce(p_offset, 0), 0);
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  WITH filtered AS (
    SELECT r.id, r.route_id, r.cluster, r.carrier, r.facility, r.data_rota,
           r.total_pacotes, r.total_impressos, r.origem_importacao,
           r.created_at, r.updated_at,
           i.iniciado_em AS ultima_importacao_em,
           count(*) OVER() AS total_full
    FROM public.meli_rotas r
    LEFT JOIN public.meli_importacoes i ON i.id = r.origem_importacao
    WHERE (p_cluster IS NULL OR r.cluster = p_cluster)
      AND (p_data_de IS NULL OR r.data_rota >= p_data_de)
      AND (p_data_ate IS NULL OR r.data_rota <= p_data_ate)
      AND (
        p_busca IS NULL
        OR r.route_id ILIKE '%'||p_busca||'%'
        OR coalesce(r.facility,'') ILIKE '%'||p_busca||'%'
      )
    ORDER BY r.data_rota DESC NULLS LAST, r.created_at DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT coalesce(max(total_full), 0),
         coalesce(jsonb_agg(to_jsonb(filtered) - 'total_full'), '[]'::jsonb)
    INTO v_total, v_rows
  FROM filtered;

  RETURN jsonb_build_object(
    'status','ok',
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'rotas', v_rows
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.meli_listar_rotas(text,date,date,text,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_listar_rotas(text,date,date,text,int,int) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_listar_rotas(text,date,date,text,int,int) TO authenticated;

-- =========================================================
-- RPC: meli_detalhar_rota (sem raw_payload)
-- =========================================================
CREATE OR REPLACE FUNCTION public.meli_detalhar_rota(
  p_rota_id uuid,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit, 100), 1), 500);
  v_offset int := GREATEST(coalesce(p_offset, 0), 0);
  v_rota jsonb;
  v_imp jsonb;
  v_total bigint := 0;
  v_pacotes jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT to_jsonb(r) INTO v_rota FROM public.meli_rotas r WHERE r.id = p_rota_id;
  IF v_rota IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','rota_nao_encontrada');
  END IF;

  SELECT to_jsonb(i) INTO v_imp
  FROM public.meli_importacoes i
  WHERE i.id = (v_rota->>'origem_importacao')::uuid;

  WITH pag AS (
    SELECT p.id, p.rota_id, p.tracking_id, p.shipment_id, p.destinatario,
           p.endereco, p.bairro, p.cidade, p.uf, p.cep, p.status,
           p.printed_label, p.ordem, p.created_at, p.updated_at,
           count(*) OVER() AS total_full
    FROM public.meli_pacotes p
    WHERE p.rota_id = p_rota_id
    ORDER BY p.ordem NULLS LAST, p.tracking_id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT coalesce(max(total_full), 0),
         coalesce(jsonb_agg(to_jsonb(pag) - 'total_full'), '[]'::jsonb)
    INTO v_total, v_pacotes
  FROM pag;

  RETURN jsonb_build_object(
    'status','ok',
    'rota', v_rota,
    'importacao', v_imp,
    'pacotes', v_pacotes,
    'total_pacotes', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.meli_detalhar_rota(uuid,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_detalhar_rota(uuid,int,int) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_detalhar_rota(uuid,int,int) TO authenticated;
