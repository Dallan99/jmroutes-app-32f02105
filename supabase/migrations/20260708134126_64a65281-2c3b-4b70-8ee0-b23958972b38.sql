
-- bases_operacionais
DROP POLICY IF EXISTS "auth ver bases" ON public.bases_operacionais;
DROP POLICY IF EXISTS "auth criar bases" ON public.bases_operacionais;
DROP POLICY IF EXISTS "auth atualizar bases" ON public.bases_operacionais;

CREATE POLICY "staff ver bases operacionais" ON public.bases_operacionais
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR importado_por = auth.uid()
  OR status = 'ativa'::base_status
);

CREATE POLICY "staff criar bases operacionais" ON public.bases_operacionais
FOR INSERT TO authenticated
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role)
   OR has_role(auth.uid(), 'supervisor'::app_role)
   OR has_role(auth.uid(), 'gerente'::app_role))
  AND importado_por = auth.uid()
);

CREATE POLICY "staff atualizar bases operacionais" ON public.bases_operacionais
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
);

-- shipments
DROP POLICY IF EXISTS "auth ver shipments" ON public.shipments;
DROP POLICY IF EXISTS "auth criar shipments" ON public.shipments;
DROP POLICY IF EXISTS "auth atualizar shipments" ON public.shipments;
DROP POLICY IF EXISTS "auth remover shipments" ON public.shipments;

CREATE POLICY "staff ver shipments" ON public.shipments
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.bases_operacionais bo
    WHERE bo.id = shipments.base_operacional_id
      AND bo.status = 'ativa'::base_status
  )
);

CREATE POLICY "staff criar shipments" ON public.shipments
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
);

CREATE POLICY "staff atualizar shipments" ON public.shipments
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
);

CREATE POLICY "staff remover shipments" ON public.shipments
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
);

-- contagens
DROP POLICY IF EXISTS "Autenticados leem contagens" ON public.contagens;

CREATE POLICY "Staff ou dono leem contagens" ON public.contagens
FOR SELECT TO authenticated
USING (
  usuario_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR base_id = (SELECT p.base_id FROM public.profiles p WHERE p.id = auth.uid())
);

-- importacoes_escala
DROP POLICY IF EXISTS "Autenticados leem importacoes" ON public.importacoes_escala;

CREATE POLICY "Staff ou base leem importacoes" ON public.importacoes_escala
FOR SELECT TO authenticated
USING (
  importado_por = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR base_id = (SELECT p.base_id FROM public.profiles p WHERE p.id = auth.uid())
);
