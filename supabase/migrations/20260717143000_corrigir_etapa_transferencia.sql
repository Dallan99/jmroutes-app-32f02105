-- Corrige uma etapa com a sessão autenticada, sem chave secreta no Vercel.
-- A função valida acesso à base, ordem cronológica, evidência e registra auditoria.
CREATE OR REPLACE FUNCTION public.corrigir_etapa_transferencia(
  p_transferencia_id uuid,
  p_etapa text,
  p_ocorrido_em timestamptz,
  p_localizacao_texto text DEFAULT NULL,
  p_storage_path text DEFAULT NULL,
  p_timemark_url text DEFAULT NULL,
  p_horario_evidencia timestamptz DEFAULT NULL,
  p_editar_evidencia boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.transferencias%ROWTYPE;
  v_evento public.transferencia_eventos%ROWTYPE;
  v_anterior timestamptz;
  v_seguinte timestamptz;
  v_evidencia public.transferencia_evidencias%ROWTYPE;
  v_nova_evidencia_id uuid;
  v_storage_path text;
  v_timemark_url text;
  v_limite time;
  v_transito_max integer := 80;
  v_referencia timestamptz;
  v_atraso integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000';
  END IF;
  IF p_etapa NOT IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt') THEN
    RAISE EXCEPTION 'etapa_invalida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t
  FROM public.transferencias
  WHERE id = p_transferencia_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_evento
  FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id AND etapa = p_etapa
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'etapa_nao_encontrada' USING ERRCODE = 'P0002';
  END IF;

  SELECT ocorrido_em INTO v_anterior
  FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id
    AND etapa = CASE p_etapa
      WHEN 'saida_service' THEN 'chegada_service'
      WHEN 'chegada_xpt' THEN 'saida_service'
      WHEN 'saida_xpt' THEN 'chegada_xpt'
      ELSE '__sem_anterior__'
    END;
  SELECT ocorrido_em INTO v_seguinte
  FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id
    AND etapa = CASE p_etapa
      WHEN 'chegada_service' THEN 'saida_service'
      WHEN 'saida_service' THEN 'chegada_xpt'
      WHEN 'chegada_xpt' THEN 'saida_xpt'
      ELSE '__sem_seguinte__'
    END;

  IF v_anterior IS NOT NULL AND p_ocorrido_em < v_anterior THEN
    RAISE EXCEPTION 'horario_anterior_etapa_precedente' USING ERRCODE = '22023';
  END IF;
  IF v_seguinte IS NOT NULL AND p_ocorrido_em > v_seguinte THEN
    RAISE EXCEPTION 'horario_posterior_etapa_seguinte' USING ERRCODE = '22023';
  END IF;

  IF p_etapa IN ('chegada_service', 'saida_service') THEN
    SELECT
      CASE p_etapa
        WHEN 'chegada_service' THEN chegada_service_limite
        ELSE saida_service_limite
      END
    INTO v_limite
    FROM public.transferencia_slas
    WHERE base_id = v_t.base_id AND lower(service) = lower(v_t.service) AND ativo = true
    LIMIT 1;
    v_limite := coalesce(v_limite, CASE WHEN p_etapa = 'chegada_service' THEN '07:00'::time ELSE '09:00'::time END);
    v_referencia := (v_t.data_operacional + v_limite) AT TIME ZONE 'America/Sao_Paulo';
  ELSIF p_etapa = 'chegada_xpt' AND v_anterior IS NOT NULL THEN
    SELECT transito_max_minutos INTO v_transito_max
    FROM public.transferencia_slas
    WHERE base_id = v_t.base_id AND lower(service) = lower(v_t.service) AND ativo = true
    LIMIT 1;
    v_referencia := v_anterior + make_interval(mins => coalesce(v_transito_max, 80));
  ELSE
    v_referencia := p_ocorrido_em;
  END IF;
  v_atraso := greatest(0, ceil(extract(epoch FROM (p_ocorrido_em - v_referencia)) / 60.0)::integer);

  UPDATE public.transferencia_eventos
  SET ocorrido_em = p_ocorrido_em,
      localizacao_texto = nullif(btrim(p_localizacao_texto), ''),
      minutos_atraso = v_atraso
  WHERE id = v_evento.id;

  UPDATE public.transferencia_ocorrencias
  SET minutos_atraso = v_atraso
  WHERE evento_id = v_evento.id;

  IF p_editar_evidencia THEN
    SELECT * INTO v_evidencia
    FROM public.transferencia_evidencias
    WHERE transferencia_id = v_t.id AND etapa = p_etapa AND substituida_por IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    v_storage_path := coalesce(nullif(btrim(p_storage_path), ''), v_evidencia.storage_path);
    v_timemark_url := nullif(btrim(p_timemark_url), '');
    IF v_storage_path IS NOT NULL
       AND v_storage_path NOT LIKE v_t.base_id::text || '/' || v_t.id::text || '/%' THEN
      RAISE EXCEPTION 'caminho_evidencia_invalido' USING ERRCODE = '22023';
    END IF;

    IF v_storage_path IS NOT NULL OR v_timemark_url IS NOT NULL THEN
      INSERT INTO public.transferencia_evidencias (
        transferencia_id, evento_id, etapa, storage_path, timemark_url,
        horario_evidencia, localizacao_texto, status, enviado_por
      ) VALUES (
        v_t.id, v_evento.id, p_etapa, v_storage_path, v_timemark_url,
        coalesce(p_horario_evidencia, p_ocorrido_em),
        nullif(btrim(p_localizacao_texto), ''), 'enviada', v_uid
      ) RETURNING id INTO v_nova_evidencia_id;

      IF v_evidencia.id IS NOT NULL THEN
        UPDATE public.transferencia_evidencias
        SET substituida_por = v_nova_evidencia_id
        WHERE id = v_evidencia.id;
      END IF;
    END IF;
  END IF;

  IF v_t.finalizada_em IS NOT NULL
     AND (p_etapa = 'saida_xpt' OR (p_etapa = 'chegada_xpt' AND v_seguinte IS NULL)) THEN
    UPDATE public.transferencias SET finalizada_em = p_ocorrido_em WHERE id = v_t.id;
  END IF;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (
    v_uid,
    'transferencia.evento.corrigir',
    'transferencia_evento',
    v_evento.id::text,
    jsonb_build_object(
      'etapa', p_etapa,
      'horario_anterior', v_evento.ocorrido_em,
      'horario_novo', p_ocorrido_em,
      'localizacao_anterior', v_evento.localizacao_texto,
      'localizacao_nova', nullif(btrim(p_localizacao_texto), ''),
      'evidencia_corrigida', p_editar_evidencia,
      'minutos_atraso', v_atraso
    )
  );

  RETURN jsonb_build_object('id', v_evento.id, 'ocorrido_em', p_ocorrido_em, 'minutos_atraso', v_atraso);
END;
$$;

REVOKE ALL ON FUNCTION public.corrigir_etapa_transferencia(
  uuid, text, timestamptz, text, text, text, timestamptz, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_etapa_transferencia(
  uuid, text, timestamptz, text, text, text, timestamptz, boolean
) TO authenticated, service_role;
