
DROP POLICY IF EXISTS "Autenticados deletam escalas" ON public.escalas;

CREATE POLICY "Staff deletam escalas da propria base"
ON public.escalas FOR DELETE TO authenticated
USING (
  importado_por = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())
);
