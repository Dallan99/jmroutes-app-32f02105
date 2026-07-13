
DROP POLICY IF EXISTS "users with role update rotas" ON public.rotas;
CREATE POLICY "staff update rotas in own base"
ON public.rotas FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'supervisor'::app_role)
      AND base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'supervisor'::app_role)
      AND base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid()))
);

DROP POLICY IF EXISTS "users with role update volumes" ON public.volumes;
CREATE POLICY "staff update volumes in own base"
ON public.volumes FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'supervisor'::app_role)
      AND EXISTS (SELECT 1 FROM public.rotas r
                  WHERE r.id = volumes.rota_id
                    AND r.base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'supervisor'::app_role)
      AND EXISTS (SELECT 1 FROM public.rotas r
                  WHERE r.id = volumes.rota_id
                    AND r.base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())))
);

DROP POLICY IF EXISTS "staff read motoristas" ON public.motoristas;
CREATE POLICY "admins read motoristas full"
ON public.motoristas FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
);

CREATE OR REPLACE VIEW public.motoristas_safe
WITH (security_invoker = true) AS
SELECT id, nome, placa, transportadora, base_id, ativo, created_at
FROM public.motoristas
WHERE base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())
   OR has_role(auth.uid(), 'admin'::app_role)
   OR has_role(auth.uid(), 'supervisor'::app_role);

GRANT SELECT ON public.motoristas_safe TO authenticated;
