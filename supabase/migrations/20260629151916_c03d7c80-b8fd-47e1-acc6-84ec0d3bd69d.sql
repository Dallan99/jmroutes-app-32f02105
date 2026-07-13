
DROP POLICY IF EXISTS "auth read motoristas" ON public.motoristas;
CREATE POLICY "staff read motoristas" ON public.motoristas FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'supervisor'::app_role)
  OR base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "auth read rotas" ON public.rotas;
CREATE POLICY "staff read rotas" ON public.rotas FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'supervisor'::app_role)
  OR base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())
  OR base_origem_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())
);

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
