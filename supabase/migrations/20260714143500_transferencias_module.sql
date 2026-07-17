-- JMRoutes — módulo Transferências
-- Migration aditiva. Não executa backfill, não remove dados e não publica nada.
-- Aplicar primeiro em homologação somente após backup e revisão do PR.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Modelo operacional
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.transferencia_motivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  responsabilidade text NOT NULL CHECK (responsabilidade IN ('JM_FROTA', 'MELI', 'EXTERNO', 'EM_ANALISE')),
  etapa text CHECK (etapa IS NULL OR etapa IN ('chegada_service', 'saida_service', 'chegada_xpt')),
  exige_descricao boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transferencia_slas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  service text NOT NULL,
  chegada_service_limite time NOT NULL DEFAULT '07:00',
  saida_service_limite time NOT NULL DEFAULT '09:00',
  transito_max_minutos integer NOT NULL DEFAULT 60 CHECK (transito_max_minutos BETWEEN 1 AND 1440),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transferencia_sla_ativa
  ON public.transferencia_slas (base_id, lower(service)) WHERE ativo;

CREATE TABLE IF NOT EXISTS public.transferencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  data_operacional date NOT NULL,
  service text NOT NULL,
  motorista text NOT NULL,
  placa text NOT NULL,
  tipo_veiculo text,
  status text NOT NULL DEFAULT 'aguardando_chegada_service' CHECK (status IN (
    'aguardando_chegada_service',
    'no_service',
    'em_transito_xpt',
    'concluida_no_prazo',
    'concluida_com_atraso',
    'pendente_evidencia',
    'em_analise',
    'cancelada'
  )),
  observacao text,
  criado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  finalizada_em timestamptz,
  cancelada_em timestamptz,
  cancelada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelamento_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(service)) BETWEEN 2 AND 120),
  CHECK (length(btrim(motorista)) BETWEEN 2 AND 160),
  CHECK (length(btrim(placa)) BETWEEN 5 AND 20)
);

CREATE INDEX IF NOT EXISTS idx_transferencias_base_data
  ON public.transferencias (base_id, data_operacional DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transferencias_status
  ON public.transferencias (status, data_operacional DESC);
CREATE INDEX IF NOT EXISTS idx_transferencias_service
  ON public.transferencias (lower(service), data_operacional DESC);
CREATE INDEX IF NOT EXISTS idx_transferencias_motorista
  ON public.transferencias (lower(motorista), data_operacional DESC);

CREATE TABLE IF NOT EXISTS public.transferencia_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transferencia_id uuid NOT NULL REFERENCES public.transferencias(id) ON DELETE RESTRICT,
  etapa text NOT NULL CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt')),
  ocorrido_em timestamptz NOT NULL,
  localizacao_texto text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  minutos_atraso integer NOT NULL DEFAULT 0 CHECK (minutos_atraso >= 0),
  registrado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transferencia_id, etapa)
);

CREATE INDEX IF NOT EXISTS idx_transferencia_eventos_transferencia
  ON public.transferencia_eventos (transferencia_id, ocorrido_em);

CREATE TABLE IF NOT EXISTS public.transferencia_ocorrencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transferencia_id uuid NOT NULL REFERENCES public.transferencias(id) ON DELETE RESTRICT,
  evento_id uuid NOT NULL REFERENCES public.transferencia_eventos(id) ON DELETE RESTRICT,
  etapa text NOT NULL CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt')),
  motivo_id uuid REFERENCES public.transferencia_motivos(id) ON DELETE RESTRICT,
  responsabilidade text NOT NULL CHECK (responsabilidade IN ('SEM_ATRASO', 'JM_FROTA', 'MELI', 'EXTERNO', 'EM_ANALISE')),
  minutos_atraso integer NOT NULL DEFAULT 0 CHECK (minutos_atraso >= 0),
  observacao text,
  registrado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transferencia_ocorrencias_transferencia
  ON public.transferencia_ocorrencias (transferencia_id, etapa);
CREATE INDEX IF NOT EXISTS idx_transferencia_ocorrencias_motivo
  ON public.transferencia_ocorrencias (motivo_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.transferencia_evidencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transferencia_id uuid NOT NULL REFERENCES public.transferencias(id) ON DELETE RESTRICT,
  evento_id uuid NOT NULL REFERENCES public.transferencia_eventos(id) ON DELETE RESTRICT,
  etapa text NOT NULL CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt')),
  storage_path text,
  timemark_url text,
  horario_evidencia timestamptz,
  localizacao_texto text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviada', 'validada', 'rejeitada')),
  enviado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  validado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  validado_em timestamptz,
  rejeicao_motivo text,
  substituida_por uuid REFERENCES public.transferencia_evidencias(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path IS NOT NULL OR timemark_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_transferencia_evidencias_transferencia
  ON public.transferencia_evidencias (transferencia_id, etapa, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transferencia_evidencias_status
  ON public.transferencia_evidencias (status, created_at DESC);

DROP TRIGGER IF EXISTS trg_transferencias_updated ON public.transferencias;
CREATE TRIGGER trg_transferencias_updated BEFORE UPDATE ON public.transferencias
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_transferencia_slas_updated ON public.transferencia_slas;
CREATE TRIGGER trg_transferencia_slas_updated BEFORE UPDATE ON public.transferencia_slas
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Acesso: somente admin é global; todos os demais ficam na profiles.base_id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transferencia_base_access(_user_id uuid, _base_id uuid)
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
      AND _base_id IS NOT NULL
      AND (
        public.has_role(_user_id, 'admin')
        OR p.base_id = _base_id
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.transferencia_access(_user_id uuid, _transferencia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.transferencias t
    WHERE t.id = _transferencia_id
      AND public.transferencia_base_access(_user_id, t.base_id)
  );
$$;

REVOKE ALL ON FUNCTION public.transferencia_base_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transferencia_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transferencia_base_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transferencia_access(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.transferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_ocorrencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_evidencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_motivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_slas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transferencias select base" ON public.transferencias
  FOR SELECT TO authenticated
  USING (public.transferencia_base_access(auth.uid(), base_id));
CREATE POLICY "transferencias insert base" ON public.transferencias
  FOR INSERT TO authenticated
  WITH CHECK (criado_por = auth.uid() AND public.transferencia_base_access(auth.uid(), base_id));
CREATE POLICY "transferencias update base" ON public.transferencias
  FOR UPDATE TO authenticated
  USING (public.transferencia_base_access(auth.uid(), base_id))
  WITH CHECK (public.transferencia_base_access(auth.uid(), base_id));

CREATE POLICY "transferencia eventos select" ON public.transferencia_eventos
  FOR SELECT TO authenticated
  USING (public.transferencia_access(auth.uid(), transferencia_id));
CREATE POLICY "transferencia ocorrencias select" ON public.transferencia_ocorrencias
  FOR SELECT TO authenticated
  USING (public.transferencia_access(auth.uid(), transferencia_id));
CREATE POLICY "transferencia evidencias select" ON public.transferencia_evidencias
  FOR SELECT TO authenticated
  USING (public.transferencia_access(auth.uid(), transferencia_id));

CREATE POLICY "transferencia motivos select" ON public.transferencia_motivos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "transferencia motivos admin" ON public.transferencia_motivos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "transferencia slas select" ON public.transferencia_slas
  FOR SELECT TO authenticated
  USING (public.transferencia_base_access(auth.uid(), base_id));
CREATE POLICY "transferencia slas admin" ON public.transferencia_slas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.transferencia_motivos, public.transferencia_slas,
  public.transferencias, public.transferencia_eventos,
  public.transferencia_ocorrencias, public.transferencia_evidencias TO authenticated;
GRANT ALL ON public.transferencia_motivos, public.transferencia_slas,
  public.transferencias, public.transferencia_eventos,
  public.transferencia_ocorrencias, public.transferencia_evidencias TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Motivos iniciais (editáveis pelo admin, sem dados pessoais)
-- ---------------------------------------------------------------------------

INSERT INTO public.transferencia_motivos (codigo, nome, responsabilidade, etapa, exige_descricao, ordem)
VALUES
  ('MOTORISTA_ATRASADO', 'Motorista apresentou-se com atraso', 'JM_FROTA', 'chegada_service', false, 10),
  ('ROTA_ANTERIOR', 'Rota anterior atrasou a apresentação', 'JM_FROTA', 'chegada_service', false, 20),
  ('QUEBRA_ANTES_SERVICE', 'Quebra do veículo antes do Service', 'JM_FROTA', 'chegada_service', false, 30),
  ('FALTA_MOTORISTA', 'Falta ou troca de motorista', 'JM_FROTA', 'chegada_service', false, 40),
  ('DOCUMENTACAO_FROTA', 'Pendência de documentação da frota', 'JM_FROTA', NULL, false, 50),
  ('ATRASO_CARREGAMENTO', 'Atraso no carregamento', 'MELI', 'saida_service', false, 60),
  ('FILA_DOCA', 'Fila de doca', 'MELI', 'saida_service', false, 70),
  ('PORTA_BLOQUEADA', 'Porta ou doca bloqueada', 'MELI', 'saida_service', false, 80),
  ('CARGA_NAO_LIBERADA', 'Carga não liberada', 'MELI', 'saida_service', false, 90),
  ('SISTEMA_SERVICE', 'Sistema ou documentação do Service', 'MELI', 'saida_service', false, 100),
  ('QUEBRA_NO_SERVICE', 'Quebra do veículo no Service', 'JM_FROTA', 'saida_service', false, 110),
  ('QUEBRA_TRAJETO', 'Quebra do veículo no trajeto', 'JM_FROTA', 'chegada_xpt', false, 120),
  ('PARADA_DESVIO', 'Parada ou desvio no trajeto', 'JM_FROTA', 'chegada_xpt', true, 130),
  ('TRANSITO_SEVERO', 'Trânsito severo', 'EXTERNO', 'chegada_xpt', false, 140),
  ('ACIDENTE_INTERDICAO', 'Acidente ou interdição', 'EXTERNO', 'chegada_xpt', false, 150),
  ('CLIMA', 'Condição climática', 'EXTERNO', 'chegada_xpt', false, 160),
  ('FISCALIZACAO', 'Fiscalização', 'EXTERNO', 'chegada_xpt', false, 170),
  ('OUTRO', 'Outro motivo', 'EM_ANALISE', NULL, true, 999)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. RPCs atômicas: criação, registro de etapa e cancelamento
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.criar_transferencia(
  p_base_id uuid,
  p_data_operacional date,
  p_service text,
  p_motorista text,
  p_placa text,
  p_tipo_veiculo text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_codigo text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT public.transferencia_base_access(v_uid, p_base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF p_data_operacional IS NULL OR p_service IS NULL OR length(btrim(p_service)) < 2
     OR p_motorista IS NULL OR length(btrim(p_motorista)) < 2
     OR p_placa IS NULL OR length(btrim(p_placa)) < 5 THEN
    RAISE EXCEPTION 'dados_obrigatorios_invalidos' USING ERRCODE = '22023';
  END IF;

  v_codigo := 'TRF-' || to_char(p_data_operacional, 'YYYYMMDD') || '-' || upper(substr(replace(v_id::text, '-', ''), 1, 8));

  INSERT INTO public.transferencias (
    id, codigo, base_id, data_operacional, service, motorista, placa,
    tipo_veiculo, observacao, criado_por
  ) VALUES (
    v_id, v_codigo, p_base_id, p_data_operacional, btrim(p_service), btrim(p_motorista),
    upper(btrim(p_placa)), nullif(btrim(p_tipo_veiculo), ''), nullif(btrim(p_observacao), ''), v_uid
  );

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.criar', 'transferencia', v_id::text,
    jsonb_build_object('base_id', p_base_id, 'codigo', v_codigo));

  RETURN jsonb_build_object('id', v_id, 'codigo', v_codigo, 'status', 'aguardando_chegada_service');
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_evento_transferencia(
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
  v_chegada_limite time := '07:00';
  v_saida_limite time := '09:00';
  v_transito_max integer := 60;
  v_referencia timestamptz;
  v_chegada_service timestamptz;
  v_saida_service timestamptz;
  v_atraso integer := 0;
  v_evidencia_completa boolean;
  v_status text;
  v_tem_atraso boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF p_etapa NOT IN ('chegada_service', 'saida_service', 'chegada_xpt') THEN
    RAISE EXCEPTION 'etapa_invalida' USING ERRCODE = '22023';
  END IF;
  IF p_ocorrido_em IS NULL THEN RAISE EXCEPTION 'horario_obrigatorio' USING ERRCODE = '22023'; END IF;
  IF p_ocorrido_em > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'horario_futuro_invalido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t FROM public.transferencias WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF v_t.status = 'cancelada' THEN RAISE EXCEPTION 'transferencia_cancelada' USING ERRCODE = '55000'; END IF;
  IF nullif(btrim(p_storage_path), '') IS NOT NULL
     AND p_storage_path NOT LIKE v_t.base_id::text || '/' || v_t.id::text || '/%' THEN
    RAISE EXCEPTION 'caminho_evidencia_invalido' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_timemark_url), '') IS NOT NULL
     AND p_timemark_url !~* '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'link_timemark_invalido' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transferencia_eventos WHERE transferencia_id = v_t.id AND etapa = p_etapa) THEN
    RAISE EXCEPTION 'etapa_ja_registrada' USING ERRCODE = '23505';
  END IF;
  IF p_etapa = 'saida_service' AND NOT EXISTS (
    SELECT 1 FROM public.transferencia_eventos WHERE transferencia_id = v_t.id AND etapa = 'chegada_service'
  ) THEN RAISE EXCEPTION 'registre_chegada_service_primeiro' USING ERRCODE = '22023'; END IF;
  IF p_etapa = 'saida_service' THEN
    SELECT ocorrido_em INTO v_chegada_service FROM public.transferencia_eventos
      WHERE transferencia_id = v_t.id AND etapa = 'chegada_service';
    IF p_ocorrido_em < v_chegada_service THEN
      RAISE EXCEPTION 'saida_anterior_a_chegada_service' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_etapa = 'chegada_xpt' THEN
    SELECT ocorrido_em INTO v_saida_service FROM public.transferencia_eventos
      WHERE transferencia_id = v_t.id AND etapa = 'saida_service';
    IF v_saida_service IS NULL THEN
      RAISE EXCEPTION 'registre_saida_service_primeiro' USING ERRCODE = '22023';
    END IF;
    IF p_ocorrido_em < v_saida_service THEN
      RAISE EXCEPTION 'chegada_xpt_anterior_a_saida_service' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT chegada_service_limite, saida_service_limite, transito_max_minutos
    INTO v_chegada_limite, v_saida_limite, v_transito_max
  FROM public.transferencia_slas
  WHERE base_id = v_t.base_id AND lower(service) = lower(v_t.service) AND ativo
  LIMIT 1;

  -- SELECT INTO zera as variáveis quando não encontra configuração. Nesse caso,
  -- preserva os SLAs corporativos iniciais do módulo.
  v_chegada_limite := coalesce(v_chegada_limite, '07:00'::time);
  v_saida_limite := coalesce(v_saida_limite, '09:00'::time);
  v_transito_max := coalesce(v_transito_max, 60);

  IF p_etapa = 'chegada_service' THEN
    v_referencia := (v_t.data_operacional::text || ' ' || v_chegada_limite::text)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  ELSIF p_etapa = 'saida_service' THEN
    v_referencia := (v_t.data_operacional::text || ' ' || v_saida_limite::text)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  ELSE
    v_referencia := v_saida_service + make_interval(mins => v_transito_max);
  END IF;

  v_atraso := greatest(0, ceil(extract(epoch FROM (p_ocorrido_em - v_referencia)) / 60.0)::integer);
  v_evidencia_completa := nullif(btrim(p_storage_path), '') IS NOT NULL
    AND nullif(btrim(p_timemark_url), '') IS NOT NULL;

  IF v_atraso > 0 THEN
    IF p_responsabilidade NOT IN ('JM_FROTA', 'MELI', 'EXTERNO', 'EM_ANALISE') THEN
      RAISE EXCEPTION 'responsabilidade_obrigatoria' USING ERRCODE = '22023';
    END IF;
    IF nullif(btrim(p_motivo_codigo), '') IS NULL THEN
      RAISE EXCEPTION 'motivo_obrigatorio' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_motivo FROM public.transferencia_motivos
      WHERE codigo = p_motivo_codigo AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'motivo_invalido' USING ERRCODE = '22023'; END IF;
    IF v_motivo.etapa IS NOT NULL AND v_motivo.etapa <> p_etapa THEN
      RAISE EXCEPTION 'motivo_incompativel_com_etapa' USING ERRCODE = '22023';
    END IF;
    IF v_motivo.responsabilidade <> p_responsabilidade AND p_responsabilidade <> 'EM_ANALISE' THEN
      RAISE EXCEPTION 'motivo_responsabilidade_incompativeis' USING ERRCODE = '22023';
    END IF;
    IF v_motivo.exige_descricao AND length(btrim(coalesce(p_observacao, ''))) < 5 THEN
      RAISE EXCEPTION 'descricao_obrigatoria' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.transferencia_eventos (
    transferencia_id, etapa, ocorrido_em, localizacao_texto, minutos_atraso, registrado_por
  ) VALUES (
    v_t.id, p_etapa, p_ocorrido_em, nullif(btrim(p_localizacao_texto), ''), v_atraso, v_uid
  ) RETURNING id INTO v_evento_id;

  IF nullif(btrim(p_storage_path), '') IS NOT NULL OR nullif(btrim(p_timemark_url), '') IS NOT NULL THEN
    INSERT INTO public.transferencia_evidencias (
      transferencia_id, evento_id, etapa, storage_path, timemark_url,
      horario_evidencia, localizacao_texto, status, enviado_por
    ) VALUES (
      v_t.id, v_evento_id, p_etapa, nullif(btrim(p_storage_path), ''),
      nullif(btrim(p_timemark_url), ''), p_horario_evidencia,
      nullif(btrim(p_localizacao_texto), ''),
      CASE WHEN v_evidencia_completa THEN 'enviada' ELSE 'pendente' END, v_uid
    );
  END IF;

  IF v_atraso > 0 THEN
    INSERT INTO public.transferencia_ocorrencias (
      transferencia_id, evento_id, etapa, motivo_id, responsabilidade,
      minutos_atraso, observacao, registrado_por
    ) VALUES (
      v_t.id, v_evento_id, p_etapa, v_motivo.id, p_responsabilidade,
      v_atraso, nullif(btrim(p_observacao), ''), v_uid
    );
  END IF;

  IF NOT v_evidencia_completa THEN
    v_status := 'pendente_evidencia';
  ELSIF p_etapa = 'chegada_service' THEN
    v_status := 'no_service';
  ELSIF p_etapa = 'saida_service' THEN
    v_status := 'em_transito_xpt';
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.transferencia_eventos e
      WHERE e.transferencia_id = v_t.id AND e.minutos_atraso > 0
    ) INTO v_tem_atraso;
    v_status := CASE WHEN v_tem_atraso THEN 'concluida_com_atraso' ELSE 'concluida_no_prazo' END;
  END IF;

  UPDATE public.transferencias
  SET status = v_status,
      finalizada_em = CASE WHEN p_etapa = 'chegada_xpt' THEN p_ocorrido_em ELSE finalizada_em END
  WHERE id = v_t.id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.evento.' || p_etapa, 'transferencia', v_t.id::text,
    jsonb_build_object('evento_id', v_evento_id, 'minutos_atraso', v_atraso,
      'responsabilidade', CASE WHEN v_atraso > 0 THEN p_responsabilidade ELSE 'SEM_ATRASO' END,
      'evidencia_completa', v_evidencia_completa));

  RETURN jsonb_build_object(
    'id', v_t.id, 'evento_id', v_evento_id, 'etapa', p_etapa,
    'minutos_atraso', v_atraso, 'status', v_status,
    'evidencia_completa', v_evidencia_completa
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.anexar_evidencia_transferencia(
  p_transferencia_id uuid,
  p_etapa text,
  p_storage_path text,
  p_timemark_url text,
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
  v_evidencia public.transferencia_evidencias%ROWTYPE;
  v_completa boolean;
  v_status text;
  v_ultima_etapa text;
  v_tem_atraso boolean;
  v_tem_pendente boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF p_etapa NOT IN ('chegada_service', 'saida_service', 'chegada_xpt') THEN
    RAISE EXCEPTION 'etapa_invalida' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_storage_path), '') IS NULL AND nullif(btrim(p_timemark_url), '') IS NULL THEN
    RAISE EXCEPTION 'evidencia_vazia' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t FROM public.transferencias WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF v_t.status = 'cancelada' THEN RAISE EXCEPTION 'transferencia_cancelada' USING ERRCODE = '55000'; END IF;
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

  SELECT * INTO v_evidencia FROM public.transferencia_evidencias
  WHERE evento_id = v_evento.id AND substituida_por IS NULL
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    UPDATE public.transferencia_evidencias SET
      storage_path = coalesce(nullif(btrim(p_storage_path), ''), storage_path),
      timemark_url = coalesce(nullif(btrim(p_timemark_url), ''), timemark_url),
      horario_evidencia = coalesce(p_horario_evidencia, horario_evidencia),
      localizacao_texto = coalesce(nullif(btrim(p_localizacao_texto), ''), localizacao_texto),
      status = CASE
        WHEN coalesce(nullif(btrim(p_storage_path), ''), storage_path) IS NOT NULL
         AND coalesce(nullif(btrim(p_timemark_url), ''), timemark_url) IS NOT NULL
        THEN 'enviada' ELSE 'pendente' END
    WHERE id = v_evidencia.id
    RETURNING * INTO v_evidencia;
  ELSE
    INSERT INTO public.transferencia_evidencias (
      transferencia_id, evento_id, etapa, storage_path, timemark_url,
      horario_evidencia, localizacao_texto, status, enviado_por
    ) VALUES (
      v_t.id, v_evento.id, p_etapa, nullif(btrim(p_storage_path), ''),
      nullif(btrim(p_timemark_url), ''), p_horario_evidencia,
      nullif(btrim(p_localizacao_texto), ''),
      CASE WHEN nullif(btrim(p_storage_path), '') IS NOT NULL
             AND nullif(btrim(p_timemark_url), '') IS NOT NULL
           THEN 'enviada' ELSE 'pendente' END,
      v_uid
    ) RETURNING * INTO v_evidencia;
  END IF;

  v_completa := v_evidencia.storage_path IS NOT NULL AND v_evidencia.timemark_url IS NOT NULL;

  SELECT EXISTS (
    SELECT 1 FROM public.transferencia_eventos e
    WHERE e.transferencia_id = v_t.id
      AND NOT EXISTS (
        SELECT 1 FROM public.transferencia_evidencias ev
        WHERE ev.evento_id = e.id AND ev.storage_path IS NOT NULL
          AND ev.timemark_url IS NOT NULL AND ev.substituida_por IS NULL
      )
  ) INTO v_tem_pendente;

  SELECT etapa INTO v_ultima_etapa FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id
  ORDER BY CASE etapa
    WHEN 'chegada_service' THEN 1 WHEN 'saida_service' THEN 2 ELSE 3 END DESC
  LIMIT 1;

  IF v_tem_pendente THEN
    v_status := 'pendente_evidencia';
  ELSIF v_ultima_etapa = 'chegada_service' THEN
    v_status := 'no_service';
  ELSIF v_ultima_etapa = 'saida_service' THEN
    v_status := 'em_transito_xpt';
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.transferencia_eventos e
      WHERE e.transferencia_id = v_t.id AND e.minutos_atraso > 0
    ) INTO v_tem_atraso;
    v_status := CASE WHEN v_tem_atraso THEN 'concluida_com_atraso' ELSE 'concluida_no_prazo' END;
  END IF;

  UPDATE public.transferencias SET status = v_status WHERE id = v_t.id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.evidencia.anexar', 'transferencia', v_t.id::text,
    jsonb_build_object('evento_id', v_evento.id, 'etapa', p_etapa,
      'evidencia_id', v_evidencia.id, 'evidencia_completa', v_completa));

  RETURN jsonb_build_object('id', v_t.id, 'evidencia_id', v_evidencia.id,
    'status', v_status, 'evidencia_completa', v_completa);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_transferencia(
  p_transferencia_id uuid,
  p_justificativa text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.transferencias%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF length(btrim(coalesce(p_justificativa, ''))) < 10 THEN
    RAISE EXCEPTION 'justificativa_minimo_10_caracteres' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public.transferencias WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF v_t.status = 'cancelada' THEN RAISE EXCEPTION 'transferencia_ja_cancelada' USING ERRCODE = '55000'; END IF;

  UPDATE public.transferencias SET
    status = 'cancelada', cancelada_em = now(), cancelada_por = v_uid,
    cancelamento_motivo = btrim(p_justificativa)
  WHERE id = v_t.id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.cancelar', 'transferencia', v_t.id::text,
    jsonb_build_object('justificativa', btrim(p_justificativa)));

  RETURN jsonb_build_object('id', v_t.id, 'status', 'cancelada');
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_sla_transferencia(
  p_base_id uuid,
  p_service text,
  p_chegada_service_limite time,
  p_saida_service_limite time,
  p_transito_max_minutos integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT public.has_role(v_uid, 'admin') OR NOT public.transferencia_base_access(v_uid, p_base_id) THEN
    RAISE EXCEPTION 'somente_admin' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_service, ''))) < 2
     OR p_chegada_service_limite IS NULL OR p_saida_service_limite IS NULL
     OR p_transito_max_minutos IS NULL OR p_transito_max_minutos NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'sla_invalido' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id FROM public.transferencia_slas
  WHERE base_id = p_base_id AND lower(service) = lower(btrim(p_service)) AND ativo
  FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public.transferencia_slas (
      base_id, service, chegada_service_limite, saida_service_limite, transito_max_minutos
    ) VALUES (
      p_base_id, btrim(p_service), p_chegada_service_limite,
      p_saida_service_limite, p_transito_max_minutos
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.transferencia_slas SET
      service = btrim(p_service),
      chegada_service_limite = p_chegada_service_limite,
      saida_service_limite = p_saida_service_limite,
      transito_max_minutos = p_transito_max_minutos
    WHERE id = v_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.sla.salvar', 'transferencia_sla', v_id::text,
    jsonb_build_object('base_id', p_base_id, 'service', btrim(p_service),
      'chegada_service_limite', p_chegada_service_limite,
      'saida_service_limite', p_saida_service_limite,
      'transito_max_minutos', p_transito_max_minutos));

  RETURN jsonb_build_object('id', v_id, 'base_id', p_base_id, 'service', btrim(p_service));
END;
$$;

REVOKE ALL ON FUNCTION public.criar_transferencia(uuid, date, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_evento_transferencia(uuid, text, timestamptz, text, text, timestamptz, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anexar_evidencia_transferencia(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_transferencia(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salvar_sla_transferencia(uuid, text, time, time, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_transferencia(uuid, date, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_evento_transferencia(uuid, text, timestamptz, text, text, timestamptz, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anexar_evidencia_transferencia(uuid, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_transferencia(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_sla_transferencia(uuid, text, time, time, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Bucket privado. Caminho: <base_id>/<transferencia_id>/<arquivo>
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'transferencias-evidencias', 'transferencias-evidencias', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "transferencias evidencia upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'transferencias-evidencias'
    AND public.transferencia_access(auth.uid(), ((storage.foldername(name))[2])::uuid)
  );

CREATE POLICY "transferencias evidencia read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'transferencias-evidencias'
    AND public.transferencia_access(auth.uid(), ((storage.foldername(name))[2])::uuid)
  );

COMMIT;

-- Rollback operacional (usar apenas antes de existir dado real):
-- DROP POLICY ...; DROP FUNCTION ...; DROP TABLE ... em ordem inversa.
-- O bucket deve ser removido somente depois de confirmar que está vazio.
