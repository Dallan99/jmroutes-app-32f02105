-- Gate 2 (RASCUNHO — NÃO APLICADA, NÃO EXECUTAR)
-- RPC única e transacional para bipagem no modelo canônico
--   importacoes_escala (base+data+versão) + escalas (shipment) + recebimentos (append-only).
-- Pressupõe Gate 1 aplicado (colunas base_leitura_id, base_rota_id, escala_id,
--   importacao_id, client_event_id em public.recebimentos + valor 'outra_data'
--   em public.recebimento_resultado + índices únicos).

CREATE OR REPLACE FUNCTION public.registrar_bipagem_escala(
  p_codigo                  text,
  p_base_leitura_id         uuid,
  p_data_operacional        date,
  p_stage                   public.bip_stage,
  p_rota_selecionada        text    DEFAULT NULL,
  p_tempo_desde_ultima_ms   integer DEFAULT NULL,
  p_ip                      text    DEFAULT NULL,
  p_user_agent              text    DEFAULT NULL,
  p_client_event_id         uuid    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id          uuid := auth.uid();
  v_codigo           text;
  v_now              timestamptz := clock_timestamp();
  v_resultado        public.recebimento_resultado;
  v_mensagem         text;
  v_escala           record;
  v_importacao_ativa record;
  v_base_rota_id     uuid;
  v_escala_id        uuid;
  v_importacao_id    uuid;
  v_base_rota_codigo text;
  v_base_rota_nome   text;
  v_atualizou        boolean := false;
  v_recebimento_id   uuid;
  v_prev             record;
  v_dto              jsonb;
BEGIN
  ------------------------------------------------------------------
  -- 0. Autenticação + normalização
  ------------------------------------------------------------------
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_codigo IS NULL OR length(btrim(p_codigo)) = 0 THEN
    RAISE EXCEPTION 'codigo_obrigatorio' USING ERRCODE = '22023';
  END IF;
  v_codigo := regexp_replace(p_codigo, '[^0-9A-Za-z]', '', 'g');

  IF p_base_leitura_id IS NULL OR p_data_operacional IS NULL OR p_stage IS NULL THEN
    RAISE EXCEPTION 'parametros_obrigatorios' USING ERRCODE = '22023';
  END IF;

  IF NOT public.has_base_access(v_user_id, p_base_leitura_id) THEN
    RAISE EXCEPTION 'sem_acesso_base' USING ERRCODE = '42501';
  END IF;

  ------------------------------------------------------------------
  -- 1. Idempotência: retry com mesmo (operador, client_event_id)
  ------------------------------------------------------------------
  IF p_client_event_id IS NOT NULL THEN
    SELECT r.id, r.resultado, r.mensagem, r.created_at,
           r.base_leitura_id, r.base_rota_id, r.escala_id,
           r.importacao_id, r.data_operacional, r.stage, r.codigo_bipado,
           b.codigo AS base_rota_codigo, b.nome AS base_rota_nome
      INTO v_prev
      FROM public.recebimentos r
      LEFT JOIN public.bases b ON b.id = r.base_rota_id
     WHERE r.operador_id     = v_user_id
       AND r.client_event_id = p_client_event_id
     LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'retry',            true,
        'recebimento_id',   v_prev.id,
        'resultado',        v_prev.resultado,
        'mensagem',         v_prev.mensagem,
        'hora',             v_prev.created_at,
        'codigo',           v_prev.codigo_bipado,
        'stage',            v_prev.stage,
        'data_operacional', v_prev.data_operacional,
        'base_leitura_id',  v_prev.base_leitura_id,
        'base_rota',        CASE
          WHEN v_prev.base_rota_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id',     v_prev.base_rota_id,
            'codigo', v_prev.base_rota_codigo,
            'nome',   v_prev.base_rota_nome)
        END,
        'escala_id',        v_prev.escala_id,
        'importacao_id',    v_prev.importacao_id
      );
    END IF;
  END IF;

  ------------------------------------------------------------------
  -- 2. Importação ativa da base+data (contexto oficial da leitura)
  ------------------------------------------------------------------
  SELECT id, base_id, data_operacional
    INTO v_importacao_ativa
    FROM public.importacoes_escala
   WHERE base_id          = p_base_leitura_id
     AND data_operacional = p_data_operacional
     AND ativa            = true
   LIMIT 1;

  ------------------------------------------------------------------
  -- 3. Busca do shipment: mesma base+data → outra_data → outra_base
  ------------------------------------------------------------------
  v_resultado := NULL;

  IF v_importacao_ativa.id IS NOT NULL THEN
    SELECT e.id, e.base_id, e.otimizada, e.planejada, e.recebido, e.triado,
           e.importacao_id
      INTO v_escala
      FROM public.escalas e
     WHERE e.importacao_id = v_importacao_ativa.id
       AND e.shipment      = v_codigo
     LIMIT 1;
  END IF;

  IF v_escala.id IS NOT NULL THEN
    v_escala_id     := v_escala.id;
    v_importacao_id := v_escala.importacao_id;
    v_base_rota_id  := v_escala.base_id;
  ELSE
    -- outra_data: mesma base, outra data (importação ativa)
    SELECT e.id, e.base_id, e.importacao_id, ie.data_operacional
      INTO v_escala
      FROM public.escalas e
      JOIN public.importacoes_escala ie ON ie.id = e.importacao_id
     WHERE e.shipment = v_codigo
       AND ie.base_id = p_base_leitura_id
       AND ie.ativa   = true
       AND ie.data_operacional <> p_data_operacional
     ORDER BY ie.data_operacional DESC
     LIMIT 1;

    IF FOUND THEN
      v_resultado     := 'outra_data';
      v_escala_id     := v_escala.id;
      v_importacao_id := v_escala.importacao_id;
      v_base_rota_id  := v_escala.base_id;
      v_mensagem      := 'Shipment pertence a outra data operacional desta base.';
    ELSE
      -- outra_base: importação ativa de outra base
      SELECT e.id, e.base_id, e.importacao_id
        INTO v_escala
        FROM public.escalas e
        JOIN public.importacoes_escala ie ON ie.id = e.importacao_id
       WHERE e.shipment = v_codigo
         AND ie.base_id <> p_base_leitura_id
         AND ie.ativa   = true
       ORDER BY ie.data_operacional DESC
       LIMIT 1;

      IF FOUND THEN
        v_resultado     := 'outra_base';
        v_escala_id     := v_escala.id;
        v_importacao_id := v_escala.importacao_id;
        v_base_rota_id  := v_escala.base_id;
        v_mensagem      := 'Shipment pertence a outra base.';
      ELSE
        v_resultado := 'inexistente';
        v_mensagem  := 'Shipment não encontrado nas importações ativas.';
      END IF;
    END IF;
  END IF;

  ------------------------------------------------------------------
  -- 4. Se escala foi encontrada na base+data corretas, avaliar
  --    rota divergente e tentar atualizar a escala atomicamente.
  ------------------------------------------------------------------
  IF v_resultado IS NULL THEN
    -- rota divergente (opcional)
    IF p_rota_selecionada IS NOT NULL AND length(btrim(p_rota_selecionada)) > 0 THEN
      IF COALESCE(v_escala.otimizada, v_escala.planejada) IS DISTINCT FROM btrim(p_rota_selecionada) THEN
        v_resultado := 'outra_rota';
        v_mensagem  := 'Shipment pertence a outra rota desta base/data.';
      END IF;
    END IF;

    IF v_resultado IS NULL THEN
      IF p_stage = 'recebimento' THEN
        UPDATE public.escalas
           SET recebido    = true,
               recebido_em = v_now,
               recebido_por= v_user_id
         WHERE id       = v_escala_id
           AND recebido = false
        RETURNING true INTO v_atualizou;

        IF v_atualizou THEN
          v_resultado := 'ok';
          v_mensagem  := 'Recebimento registrado.';
        ELSE
          v_resultado := 'duplicado';
          v_mensagem  := 'Shipment já recebido nesta base/data.';
        END IF;

      ELSIF p_stage = 'triagem' THEN
        UPDATE public.escalas
           SET triado    = true,
               triado_em = v_now,
               triado_por= v_user_id
         WHERE id     = v_escala_id
           AND triado = false
        RETURNING true INTO v_atualizou;

        IF v_atualizou THEN
          v_resultado := 'ok';
          v_mensagem  := 'Triagem registrada.';
        ELSE
          v_resultado := 'duplicado';
          v_mensagem  := 'Shipment já triado nesta base/data.';
        END IF;

      ELSE
        RAISE EXCEPTION 'stage_invalido' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  ------------------------------------------------------------------
  -- 5. Bloco único final: insere recebimento + audit + monta DTO
  --    Se qualquer INSERT falhar, transação inteira reverte
  --    (inclusive o UPDATE em escalas do passo 4).
  ------------------------------------------------------------------
  INSERT INTO public.recebimentos (
    codigo_bipado, rota_id, volume_id,
    base_id, base_leitura_id, base_rota_id,
    escala_id, importacao_id,
    operador_id, resultado, mensagem,
    ip, user_agent, tempo_desde_ultima_ms,
    stage, data_operacional, client_event_id
  ) VALUES (
    v_codigo, NULL, NULL,
    p_base_leitura_id, p_base_leitura_id, v_base_rota_id,
    v_escala_id, v_importacao_id,
    v_user_id, v_resultado, v_mensagem,
    p_ip, p_user_agent, p_tempo_desde_ultima_ms,
    p_stage, p_data_operacional, p_client_event_id
  )
  RETURNING id INTO v_recebimento_id;

  INSERT INTO public.audit_logs (
    user_id, acao, entidade, entidade_id, detalhes, ip, user_agent
  ) VALUES (
    v_user_id,
    (CASE p_stage WHEN 'recebimento' THEN 'recebimento.' ELSE 'triagem.' END) || v_resultado::text,
    'escala',
    COALESCE(v_escala_id::text, v_recebimento_id::text),
    jsonb_build_object(
      'recebimento_id',   v_recebimento_id,
      'codigo',           v_codigo,
      'stage',            p_stage,
      'data_operacional', p_data_operacional,
      'base_leitura_id',  p_base_leitura_id,
      'base_rota_id',     v_base_rota_id,
      'importacao_id',    v_importacao_id,
      'resultado',        v_resultado
    ),
    p_ip, p_user_agent
  );

  IF v_base_rota_id IS NOT NULL AND v_resultado IN ('outra_base') THEN
    SELECT codigo, nome INTO v_base_rota_codigo, v_base_rota_nome
      FROM public.bases WHERE id = v_base_rota_id;
  END IF;

  v_dto := jsonb_build_object(
    'retry',            false,
    'recebimento_id',   v_recebimento_id,
    'resultado',        v_resultado,
    'mensagem',         v_mensagem,
    'hora',             v_now,
    'codigo',           v_codigo,
    'stage',            p_stage,
    'data_operacional', p_data_operacional,
    'base_leitura_id',  p_base_leitura_id,
    'base_rota',        CASE
      WHEN v_resultado <> 'outra_base' OR v_base_rota_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id',     v_base_rota_id,
        'codigo', v_base_rota_codigo,
        'nome',   v_base_rota_nome)
    END,
    'escala_id',        v_escala_id,
    'importacao_id',    v_importacao_id
  );

  RETURN v_dto;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_bipagem_escala(
  text, uuid, date, public.bip_stage, text, integer, text, text, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.registrar_bipagem_escala(
  text, uuid, date, public.bip_stage, text, integer, text, text, uuid
) TO authenticated;