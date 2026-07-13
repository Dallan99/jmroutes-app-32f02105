
-- 1) profiles: recriar policies do gerente restritas a authenticated
DROP POLICY IF EXISTS "gerentes insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "gerentes manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "supervisors read all profiles" ON public.profiles;

CREATE POLICY "gerentes insert profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "gerentes manage profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "supervisors read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
  );

-- 2) user_roles: restringir policies do gerente a authenticated
DROP POLICY IF EXISTS "gerentes assign non-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "gerentes update non-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "gerentes delete non-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "supervisors read all roles" ON public.user_roles;

CREATE POLICY "gerentes assign non-admin roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    role <> 'admin'::app_role
    AND (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "gerentes update non-admin roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    role <> 'admin'::app_role
    AND (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  )
  WITH CHECK (
    role <> 'admin'::app_role
    AND (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "gerentes delete non-admin roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (
    role <> 'admin'::app_role
    AND (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "supervisors read all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
  );

-- 3) motoristas: adicionar policy de leitura para staff com acesso à base
CREATE POLICY "base staff read motoristas" ON public.motoristas
  FOR SELECT TO authenticated
  USING (base_id IS NOT NULL AND has_base_access(auth.uid(), base_id));

-- 4) SECURITY DEFINER -> INVOKER e revoke execute de public
CREATE OR REPLACE FUNCTION public.has_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
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
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT id FROM public.bases WHERE public.has_base_access(_user_id, id);
$$;

REVOKE EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_allowed_bases(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_allowed_bases(uuid) TO authenticated, service_role;
