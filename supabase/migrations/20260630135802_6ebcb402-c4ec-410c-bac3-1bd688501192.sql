
DROP POLICY IF EXISTS "Admin/Supervisor inserem escalas" ON public.escalas;
DROP POLICY IF EXISTS "Admin/Supervisor deletam escalas" ON public.escalas;

CREATE POLICY "Autenticados inserem escalas"
ON public.escalas FOR INSERT TO authenticated
WITH CHECK (importado_por = auth.uid());

CREATE POLICY "Autenticados deletam escalas"
ON public.escalas FOR DELETE TO authenticated
USING (true);
