-- Update RLS policies to grant 'gerente' the same access as 'supervisor',
-- plus user management (manage profiles + user_roles), except cannot grant 'admin'
-- (already enforced by prevent_admin_role_grant trigger).

-- audit_logs: gerente can read
DROP POLICY IF EXISTS "admins read audit" ON public.audit_logs;
CREATE POLICY "admins read audit" ON public.audit_logs FOR SELECT
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'));

-- escalas
DROP POLICY IF EXISTS "Staff leem escalas da propria base" ON public.escalas;
CREATE POLICY "Staff leem escalas da propria base" ON public.escalas FOR SELECT
USING (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente')
  OR importado_por = auth.uid()
  OR base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Staff deletam escalas da propria base" ON public.escalas;
CREATE POLICY "Staff deletam escalas da propria base" ON public.escalas FOR DELETE
USING (
  importado_por = auth.uid()
  OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gerente')
  OR base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())
);

-- motoristas
DROP POLICY IF EXISTS "admins read motoristas full" ON public.motoristas;
CREATE POLICY "admins read motoristas full" ON public.motoristas FOR SELECT
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'));

-- profiles: gerente can read all and manage (except role changes)
DROP POLICY IF EXISTS "supervisors read all profiles" ON public.profiles;
CREATE POLICY "supervisors read all profiles" ON public.profiles FOR SELECT
USING (has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gerente'));

CREATE POLICY "gerentes manage profiles" ON public.profiles FOR UPDATE
USING (has_role(auth.uid(),'gerente'))
WITH CHECK (has_role(auth.uid(),'gerente'));

CREATE POLICY "gerentes insert profiles" ON public.profiles FOR INSERT
WITH CHECK (has_role(auth.uid(),'gerente'));

-- recebimentos
DROP POLICY IF EXISTS "operador le proprio" ON public.recebimentos;
CREATE POLICY "operador le proprio" ON public.recebimentos FOR SELECT
USING (
  auth.uid() = operador_id
  OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gerente')
);

-- rotas
DROP POLICY IF EXISTS "staff read rotas" ON public.rotas;
CREATE POLICY "staff read rotas" ON public.rotas FOR SELECT
USING (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente')
  OR base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())
  OR base_origem_id = (SELECT base_id FROM profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "admins insert rotas" ON public.rotas;
CREATE POLICY "admins insert rotas" ON public.rotas FOR INSERT
WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'));

DROP POLICY IF EXISTS "staff update rotas in own base" ON public.rotas;
CREATE POLICY "staff update rotas in own base" ON public.rotas FOR UPDATE
USING (
  has_role(auth.uid(),'admin')
  OR ((has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'))
      AND base_id = (SELECT base_id FROM profiles WHERE id = auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(),'admin')
  OR ((has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'))
      AND base_id = (SELECT base_id FROM profiles WHERE id = auth.uid()))
);

-- user_roles: gerente can read all and assign non-admin roles
DROP POLICY IF EXISTS "supervisors read all roles" ON public.user_roles;
CREATE POLICY "supervisors read all roles" ON public.user_roles FOR SELECT
USING (has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gerente'));

CREATE POLICY "gerentes assign non-admin roles" ON public.user_roles FOR INSERT
WITH CHECK (has_role(auth.uid(),'gerente') AND role <> 'admin');

CREATE POLICY "gerentes update non-admin roles" ON public.user_roles FOR UPDATE
USING (has_role(auth.uid(),'gerente') AND role <> 'admin')
WITH CHECK (has_role(auth.uid(),'gerente') AND role <> 'admin');

CREATE POLICY "gerentes delete non-admin roles" ON public.user_roles FOR DELETE
USING (has_role(auth.uid(),'gerente') AND role <> 'admin');

-- volumes
DROP POLICY IF EXISTS "staff read volumes in own base" ON public.volumes;
CREATE POLICY "staff read volumes in own base" ON public.volumes FOR SELECT
USING (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente')
  OR EXISTS (SELECT 1 FROM rotas r WHERE r.id = volumes.rota_id
             AND (r.base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())
               OR r.base_origem_id = (SELECT base_id FROM profiles WHERE id = auth.uid())))
);

DROP POLICY IF EXISTS "staff update volumes in own base" ON public.volumes;
CREATE POLICY "staff update volumes in own base" ON public.volumes FOR UPDATE
USING (
  has_role(auth.uid(),'admin')
  OR ((has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'))
      AND EXISTS (SELECT 1 FROM rotas r WHERE r.id = volumes.rota_id
                  AND r.base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())))
)
WITH CHECK (
  has_role(auth.uid(),'admin')
  OR ((has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'))
      AND EXISTS (SELECT 1 FROM rotas r WHERE r.id = volumes.rota_id
                  AND r.base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())))
);
