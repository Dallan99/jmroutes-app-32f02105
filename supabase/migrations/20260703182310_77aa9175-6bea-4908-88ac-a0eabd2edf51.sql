
-- 1) escalas: restrict SELECT to same-base users, uploader, admins, supervisors
DROP POLICY IF EXISTS "Autenticados leem escalas" ON public.escalas;
CREATE POLICY "Staff leem escalas da propria base"
ON public.escalas
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR importado_por = auth.uid()
  OR base_id = (SELECT profiles.base_id FROM public.profiles WHERE profiles.id = auth.uid())
);

-- 2) volumes: restrict SELECT via rotas base scoping
DROP POLICY IF EXISTS "auth read volumes" ON public.volumes;
CREATE POLICY "staff read volumes in own base"
ON public.volumes
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.rotas r
    WHERE r.id = volumes.rota_id
      AND (
        r.base_id = (SELECT profiles.base_id FROM public.profiles WHERE profiles.id = auth.uid())
        OR r.base_origem_id = (SELECT profiles.base_id FROM public.profiles WHERE profiles.id = auth.uid())
      )
  )
);

-- 3) user_roles: prevent admin self-grant / lateral admin grant via trigger.
-- Only service_role (migrations/backend) can insert/update/delete rows where role='admin'.
CREATE OR REPLACE FUNCTION public.prevent_admin_role_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' AND NEW.role = 'admin'::app_role THEN
    RAISE EXCEPTION 'Admin role can only be granted via service_role/migration';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.role = 'admin'::app_role OR OLD.role = 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin role changes can only be made via service_role/migration';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.role = 'admin'::app_role THEN
    RAISE EXCEPTION 'Admin role removals can only be made via service_role/migration';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_admin_role_grant ON public.user_roles;
CREATE TRIGGER trg_prevent_admin_role_grant
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_role_grant();
