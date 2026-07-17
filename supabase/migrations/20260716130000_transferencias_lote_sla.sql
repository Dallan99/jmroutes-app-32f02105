-- JMRoutes — ajuste operacional do módulo Transferências
-- Migration aditiva: lote, SLA de trajeto de 80 minutos e responsabilidade automática MELI na saída tardia.

BEGIN;

-- O trajeto Service -> XPT passa a aceitar até 1h20 sem atraso.
ALTER TABLE public.transferencia_slas
  ALTER COLUMN transito_max_minutos SET DEFAULT 80;

-- Atualiza somente configurações que ainda estão no padrão antigo de 60 minutos.
UPDATE public.transferencia_slas
SET transito_max_minutos = 80
WHERE transito_max_minutos = 60;

-- Garante que atrasos na etapa de saída do Service sejam atribuídos ao MELI,
-- independentemente do valor enviado pela interface.
CREATE OR REPLACE FUNCTION public.tg_transferencia_saida_service_meli()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_motivo_id uuid;
BEGIN
  IF NEW.etapa = 'saida_service' AND NEW.minutos_atraso > 0 THEN
    SELECT id INTO v_motivo_id
    FROM public.transferencia_motivos
    WHERE codigo = 'ATRASO_CARREGAMENTO'
      AND ativo = true
    LIMIT 1;

    NEW.responsabilidade := 'MELI';
    NEW.motivo_id := coalesce(v_motivo_id, NEW.motivo_id);
    NEW.observacao := coalesce(
      nullif(btrim(NEW.observacao), ''),
      'Saída do Service após o horário limite; responsabilidade MELI aplicada automaticamente.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transferencia_saida_service_meli
  ON public.transferencia_ocorrencias;

CREATE TRIGGER trg_transferencia_saida_service_meli
BEFORE INSERT OR UPDATE ON public.transferencia_ocorrencias
FOR EACH ROW
EXECUTE FUNCTION public.tg_transferencia_saida_service_meli();

INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
SELECT
  auth.uid(),
  'transferencia.regra_operacional.atualizar',
  'transferencia_configuracao',
  'sla_trajeto_80_meli_saida',
  jsonb_build_object(
    'transito_max_minutos', 80,
    'saida_service_responsabilidade', 'MELI',
    'motivo', 'ATRASO_CARREGAMENTO'
  )
WHERE auth.uid() IS NOT NULL;

COMMIT;
