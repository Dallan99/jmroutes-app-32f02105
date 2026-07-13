
DROP POLICY IF EXISTS "admins read audit" ON public.audit_logs;
CREATE POLICY "admins read audit"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'supervisor')
  OR public.has_role(auth.uid(), 'gerente')
);

DROP POLICY IF EXISTS "admins read motoristas full" ON public.motoristas;
CREATE POLICY "admins read motoristas full"
ON public.motoristas
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'supervisor')
  OR public.has_role(auth.uid(), 'gerente')
);

-- Preserve audit-trail integrity: recebimentos is append-only.
CREATE POLICY "recebimentos deny update"
ON public.recebimentos
FOR UPDATE
TO authenticated, anon
USING (false)
WITH CHECK (false);

CREATE POLICY "recebimentos deny delete"
ON public.recebimentos
FOR DELETE
TO authenticated, anon
USING (false);
