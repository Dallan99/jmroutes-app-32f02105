-- JMRoutes — quarto marco da transferência e evidência opcional
-- Fluxo: chegada Service -> saída Service -> chegada XPT -> saída XPT.

BEGIN;

ALTER TABLE public.transferencia_motivos
  DROP CONSTRAINT IF EXISTS transferencia_motivos_etapa_check;
ALTER TABLE public.transferencia_motivos
  ADD CONSTRAINT transferencia_motivos_etapa_check
  CHECK (etapa IS NULL OR etapa IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt'));

ALTER TABLE public.transferencia_eventos
  DROP CONSTRAINT IF EXISTS transferencia_eventos_etapa_check;
ALTER TABLE public.transferencia_eventos
  ADD CONSTRAINT transferencia_eventos_etapa_check
  CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt'));

ALTER TABLE public.transferencia_ocorrencias
  DROP CONSTRAINT IF EXISTS transferencia_ocorrencias_etapa_check;
ALTER TABLE public.transferencia_ocorrencias
  ADD CONSTRAINT transferencia_ocorrencias_etapa_check
  CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt'));

ALTER TABLE public.transferencia_evidencias
  DROP CONSTRAINT IF EXISTS transferencia_evidencias_etapa_check;
ALTER TABLE public.transferencia_evidencias
  ADD CONSTRAINT transferencia_evidencias_etapa_check
  CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt'));

ALTER TABLE public.transferencias
  DROP CONSTRAINT IF EXISTS transferencias_status_check;
ALTER TABLE public.transferencias
  ADD CONSTRAINT transferencias_status_check CHECK (status IN (
    'aguardando_chegada_service', 'no_service', 'em_transito_xpt', 'no_xpt',
    'concluida_no_prazo', 'concluida_com_atraso', 'pendente_evidencia',
    'em_analise', 'cancelada'
  ));

CREATE OR REPLACE FUNCTION public.transferencia_status_atual(p_transferencia_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_etapa text;
  v_atraso boolean;
BEGIN
  SELECT etapa INTO v_etapa
  FROM public.transferencia_eventos
  WHERE transferencia_id = p_transferencia_id
  ORDER BY CASE etapa
    WHEN 'chegada_service' THEN 1
    WHEN 'saida_service' THEN 2
    WHEN 'chegada_xpt' THEN 3
    WHEN 'saida_xpt' THEN 4
    ELSE 0 END DESC
  LIMIT 1;

  IF v_etapa IS NULL THEN RETURN 'aguardando_chegada_service'; END IF;
  IF v_etapa = 'chegada_service' THEN RETURN 'no_service'; END IF;
  IF v_etapa = 'saida_service' THEN RETURN 'em_transito_xpt'; END IF;
  IF v_etapa = 'chegada_xpt' THEN RETURN 'no_xpt'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.transferencia_eventos
    WHERE transferencia_id = p_transferencia_id AND minutos_atraso > 0
  ) INTO v_atraso;
  RETURN CASE WHEN v_atraso THEN 'concluida_com_atraso' ELSE 'concluida_no_prazo' END;
END;
$$;

REVOKE ALL ON FUNCTION public.transferencia_status_atual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transferencia_status_atual(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.registrar_evento_transferencia_v2(
  p_transferencia_id uuid,
  p_etapa text,
  p_ocorrido_em timestamptz,
  p_storage_path text DEFAULT NULL,
  p_timemark_url text DEFAULT NULL,
  p_horario_evidencia timestamptz DEFAULT NULL,
  p_localizacao_texto text DEFAULT NULL,
  p_motivo_codigo text DEFAULT NULL,
  p_responsabilidade text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.transferencias%ROWTYPE;
  v_evento_id uuid;
  v_motivo public.transferencia_motivos%ROWTYPE;
  v_anterior timestamptz;
  v_chegada_limite time := '07:00';
  v_saida_limite time := '09:00';
  v_transito_max integer := 80;
  v_referencia timestamptz;
  v_atraso integer := 0;
  v_status text;
  v_responsabilidade text;
  v_evidencia boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF p_etapa NOT IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt') THEN
    RAISE EXCEPTION 'etapa_invalida' USING ERRCODE = '22023';
  END IF;
  IF p_ocorrido_em IS NULL OR p_ocorrido_em > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'horario_invalido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t FROM public.transferencias WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF v_t.status = 'cancelada' THEN RAISE EXCEPTION 'transferencia_cancelada' USING ERRCODE = '55000'; END IF;
  IF EXISTS (SELECT 1 FROM public.transferencia_eventos WHERE transferencia_id = v_t.id AND etapa = p_etapa) THEN
    RAISE EXCEPTION 'etapa_ja_registrada' USING ERRCODE = '23505';
  END IF;
  IF nullif(btrim(p_storage_path), '') IS NOT NULL
     AND p_storage_path NOT LIKE v_t.base_id::text || '/' || v_t.id::text || '/%' THEN
    RAISE EXCEPTION 'caminho_evidencia_invalido' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_timemark_url), '') IS NOT NULL
     AND p_timemark_url !~* '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'link_timemark_invalido' USING ERRCODE = '22023';
  END IF;

  IF p_etapa <> 'chegada_service' THEN
    SELECT ocorrido_em INTO v_anterior
    FROM public.transferencia_eventos
    WHERE transferencia_id = v_t.id
      AND etapa = CASE p_etapa
        WHEN 'saida_service' THEN 'chegada_service'
        WHEN 'chegada_xpt' THEN 'saida_service'
        WHEN 'saida_xpt' THEN 'chegada_xpt' END;
    IF v_anterior IS NULL THEN RAISE EXCEPTION 'registre_etapa_anterior_primeiro' USING ERRCODE = '22023'; END IF;
    IF p_ocorrido_em < v_anterior THEN RAISE EXCEPTION 'horario_anterior_a_etapa_precedente' USING ERRCODE = '22023'; END IF;
  END IF;

  SELECT chegada_service_limite, saida_service_limite, transito_max_minutos
  INTO v_chegada_limite, v_saida_limite, v_transito_max
  FROM public.transferencia_slas
  WHERE base_id = v_t.base_id AND lower(service) = lower(v_t.service) AND ativo
  LIMIT 1;
  v_chegada_limite := coalesce(v_chegada_limite, '07:00'::time);
  v_saida_limite := coalesce(v_saida_limite, '09:00'::time);
  v_transito_max := coalesce(v_transito_max, 80);

  IF p_etapa = 'chegada_service' THEN
    v_referencia := (v_t.data_operacional::text || ' ' || v_chegada_limite::text)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  ELSIF p_etapa = 'saida_service' THEN
    v_referencia := (v_t.data_operacional::text || ' ' || v_saida_limite::text)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  ELSIF p_etapa = 'chegada_xpt' THEN
    v_referencia := v_anterior + make_interval(mins => v_transito_max);
  ELSE
    v_referencia := p_ocorrido_em;
  END IF;
  v_atraso := greatest(0, ceil(extract(epoch FROM (p_ocorrido_em - v_referencia)) / 60.0)::integer);

  IF v_atraso > 0 THEN
    SELECT * INTO v_motivo FROM public.transferencia_motivos
    WHERE codigo = coalesce(nullif(btrim(p_motivo_codigo), ''), 'OUTRO') AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'motivo_invalido' USING ERRCODE = '22023'; END IF;
    v_responsabilidade := coalesce(nullif(btrim(p_responsabilidade), ''), v_motivo.responsabilidade, 'EM_ANALISE');
  END IF;

  INSERT INTO public.transferencia_eventos (
    transferencia_id, etapa, ocorrido_em, localizacao_texto, minutos_atraso, registrado_por
  ) VALUES (
    v_t.id, p_etapa, p_ocorrido_em, nullif(btrim(p_localizacao_texto), ''), v_atraso, v_uid
  ) RETURNING id INTO v_evento_id;

  v_evidencia := nullif(btrim(p_storage_path), '') IS NOT NULL OR nullif(btrim(p_timemark_url), '') IS NOT NULL;
  IF v_evidencia THEN
    INSERT INTO public.transferencia_evidencias (
      transferencia_id, evento_id, etapa, storage_path, timemark_url,
      horario_evidencia, localizacao_texto, status, enviado_por
    ) VALUES (
      v_t.id, v_evento_id, p_etapa, nullif(btrim(p_storage_path), ''),
      nullif(btrim(p_timemark_url), ''), p_horario_evidencia,
      nullif(btrim(p_localizacao_texto), ''), 'enviada', v_uid
    );
  END IF;

  IF v_atraso > 0 THEN
    INSERT INTO public.transferencia_ocorrencias (
      transferencia_id, evento_id, etapa, motivo_id, responsabilidade,
      minutos_atraso, observacao, registrado_por
    ) VALUES (
      v_t.id, v_evento_id, p_etapa, v_motivo.id, v_responsabilidade,
      v_atraso, coalesce(nullif(btrim(p_observacao), ''), 'Pendente de classificação operacional.'), v_uid
    );
  END IF;

  v_status := public.transferencia_status_atual(v_t.id);
  UPDATE public.transferencias SET
    status = v_status,
    finalizada_em = CASE WHEN p_etapa = 'saida_xpt' THEN p_ocorrido_em ELSE finalizada_em END
  WHERE id = v_t.id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.evento.' || p_etapa, 'transferencia', v_t.id::text,
    jsonb_build_object('evento_id', v_evento_id, 'minutos_atraso', v_atraso,
      'responsabilidade', coalesce(v_responsabilidade, 'SEM_ATRASO'), 'evidencia_anexada', v_evidencia));

  RETURN jsonb_build_object('id', v_t.id, 'evento_id', v_evento_id, 'etapa', p_etapa,
    'minutos_atraso', v_atraso, 'status', v_status, 'evidencia_anexada', v_evidencia);
END;
$$;

CREATE OR REPLACE FUNCTION public.anexar_evidencia_transferencia_v2(
  p_transferencia_id uuid,
  p_etapa text,
  p_storage_path text DEFAULT NULL,
  p_timemark_url text DEFAULT NULL,
  p_horario_evidencia timestamptz DEFAULT NULL,
  p_localizacao_texto text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.transferencias%ROWTYPE;
  v_evento public.transferencia_eventos%ROWTYPE;
  v_evidencia_id uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF p_etapa NOT IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt') THEN
    RAISE EXCEPTION 'etapa_invalida' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_storage_path), '') IS NULL AND nullif(btrim(p_timemark_url), '') IS NULL THEN
    RAISE EXCEPTION 'evidencia_vazia' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public.transferencias WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'transferencia_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_storage_path), '') IS NOT NULL
     AND p_storage_path NOT LIKE v_t.base_id::text || '/' || v_t.id::text || '/%' THEN
    RAISE EXCEPTION 'caminho_evidencia_invalido' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_timemark_url), '') IS NOT NULL
     AND p_timemark_url !~* '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'link_timemark_invalido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_evento FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id AND etapa = p_etapa;
  IF NOT FOUND THEN RAISE EXCEPTION 'evento_nao_encontrado' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.transferencia_evidencias (
    transferencia_id, evento_id, etapa, storage_path, timemark_url,
    horario_evidencia, localizacao_texto, status, enviado_por
  ) VALUES (
    v_t.id, v_evento.id, p_etapa, nullif(btrim(p_storage_path), ''),
    nullif(btrim(p_timemark_url), ''), p_horario_evidencia,
    nullif(btrim(p_localizacao_texto), ''), 'enviada', v_uid
  ) RETURNING id INTO v_evidencia_id;

  v_status := public.transferencia_status_atual(v_t.id);
  UPDATE public.transferencias SET status = v_status WHERE id = v_t.id;
  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.evidencia.anexar', 'transferencia', v_t.id::text,
    jsonb_build_object('evento_id', v_evento.id, 'etapa', p_etapa, 'evidencia_id', v_evidencia_id));
  RETURN jsonb_build_object('id', v_t.id, 'evidencia_id', v_evidencia_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_evento_transferencia_v2(uuid, text, timestamptz, text, text, timestamptz, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anexar_evidencia_transferencia_v2(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_evento_transferencia_v2(uuid, text, timestamptz, text, text, timestamptz, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anexar_evidencia_transferencia_v2(uuid, text, text, text, timestamptz, text) TO authenticated;

UPDATE public.transferencias t
SET status = public.transferencia_status_atual(t.id),
    finalizada_em = CASE
      WHEN EXISTS (SELECT 1 FROM public.transferencia_eventos e WHERE e.transferencia_id = t.id AND e.etapa = 'saida_xpt')
      THEN (SELECT e.ocorrido_em FROM public.transferencia_eventos e WHERE e.transferencia_id = t.id AND e.etapa = 'saida_xpt')
      ELSE NULL END
WHERE t.status <> 'cancelada';

COMMIT;
