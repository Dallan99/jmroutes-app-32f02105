
DROP POLICY IF EXISTS "Autenticados atualizam importacoes" ON public.importacoes_escala;
CREATE POLICY "Dono ou admin/gerente atualizam importacoes"
  ON public.importacoes_escala FOR UPDATE TO authenticated
  USING (importado_por = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'))
  WITH CHECK (importado_por = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
