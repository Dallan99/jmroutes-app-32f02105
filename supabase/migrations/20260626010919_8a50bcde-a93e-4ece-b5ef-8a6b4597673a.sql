
-- Restringe UPDATEs amplos a usuários que tenham QUALQUER role válida
DROP POLICY "auth update rotas" ON public.rotas;
CREATE POLICY "users with role update rotas" ON public.rotas FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY "auth update volumes" ON public.volumes;
CREATE POLICY "users with role update volumes" ON public.volumes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

-- Revoga EXECUTE público das funções SECURITY DEFINER
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
