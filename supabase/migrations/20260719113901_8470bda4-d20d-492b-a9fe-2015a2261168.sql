
-- 1) Prevent self-escalation via profiles.base_id
CREATE OR REPLACE FUNCTION public.prevent_profile_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true) IS NULL
     OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.base_id IS DISTINCT FROM OLD.base_id
     AND NOT (public.has_role(auth.uid(), 'admin'::app_role)
              OR public.has_role(auth.uid(), 'gerente'::app_role)) THEN
    RAISE EXCEPTION 'Somente administradores ou gerentes podem alterar a base do usuário.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email THEN
    IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
            OR public.has_role(auth.uid(), 'gerente'::app_role)) THEN
      RAISE EXCEPTION 'Campos sensíveis não podem ser alterados por este usuário.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_self_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_self_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_self_escalation();

-- 2) Revoke EXECUTE on internal/trigger functions from anon and authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_admin_role_grant() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_transferencia_saida_service_meli() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_self_escalation() FROM PUBLIC, anon, authenticated;

-- 3) Revoke anon EXECUTE on SECURITY DEFINER RPCs and helpers (keep authenticated)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_allowed_bases(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transferencia_base_access(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transferencia_access(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inventario_base_access(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inventario_global_access(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.criar_transferencia(uuid, date, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.registrar_evento_transferencia(uuid, text, timestamptz, text, text, timestamptz, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.anexar_evidencia_transferencia(uuid, text, text, text, timestamptz, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancelar_transferencia(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.salvar_sla_transferencia(uuid, text, time, time, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.registrar_leitura_inventario(uuid, date, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalizar_inventario(uuid, text) FROM anon;
