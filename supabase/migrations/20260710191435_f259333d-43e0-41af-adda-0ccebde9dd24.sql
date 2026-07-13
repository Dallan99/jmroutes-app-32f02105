
-- Recreate policies explicitly TO authenticated (drop any lingering public-role variants)
DROP POLICY IF EXISTS "admins read audit" ON public.audit_logs;
CREATE POLICY "admins read audit" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'));

DROP POLICY IF EXISTS "admins read motoristas full" ON public.motoristas;
CREATE POLICY "admins read motoristas full" ON public.motoristas
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'));

-- Restrict base staff PII exposure: revoke column privileges on cpf/cnh so only
-- service_role (used by privileged server code) can read those columns.
REVOKE SELECT (cpf, cnh) ON public.motoristas FROM authenticated;
REVOKE SELECT (cpf, cnh) ON public.motoristas FROM anon;
