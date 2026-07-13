
-- Fix: has_base_access should NOT auto-grant when base_id is NULL
CREATE OR REPLACE FUNCTION public.has_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    _base_id IS NOT NULL
    AND (
      public.has_role(_user_id, 'admin')
      OR public.has_role(_user_id, 'gerente')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.base_id = _base_id)
      OR EXISTS (SELECT 1 FROM public.user_bases ub WHERE ub.user_id = _user_id AND ub.base_id = _base_id)
    );
$$;

-- Scope bases SELECT to accessible bases only
DROP POLICY IF EXISTS "auth read bases" ON public.bases;
CREATE POLICY "auth read bases"
ON public.bases
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'gerente')
  OR public.has_role(auth.uid(), 'supervisor')
  OR public.has_base_access(auth.uid(), id)
);

-- Prevent forged audit_logs inserts from client: only service_role writes
DROP POLICY IF EXISTS "auth insert audit" ON public.audit_logs;
