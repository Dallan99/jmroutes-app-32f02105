
CREATE TABLE public.contagens_rotas_lock (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  base_id UUID NOT NULL REFERENCES public.bases(id) ON DELETE CASCADE,
  data_operacional DATE NOT NULL,
  nome TEXT NOT NULL,
  previsto INTEGER,
  motorista TEXT,
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (base_id, data_operacional, nome)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contagens_rotas_lock TO authenticated;
GRANT ALL ON public.contagens_rotas_lock TO service_role;

ALTER TABLE public.contagens_rotas_lock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver locks das bases acessíveis"
  ON public.contagens_rotas_lock FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));

CREATE POLICY "Criar locks nas bases acessíveis"
  ON public.contagens_rotas_lock FOR INSERT TO authenticated
  WITH CHECK (public.has_base_access(auth.uid(), base_id) AND criado_por = auth.uid());

CREATE POLICY "Dono ou admin/gerente pode apagar"
  ON public.contagens_rotas_lock FOR DELETE TO authenticated
  USING (
    criado_por = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
  );

CREATE POLICY "Dono ou admin/gerente pode atualizar"
  ON public.contagens_rotas_lock FOR UPDATE TO authenticated
  USING (
    criado_por = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
  );
