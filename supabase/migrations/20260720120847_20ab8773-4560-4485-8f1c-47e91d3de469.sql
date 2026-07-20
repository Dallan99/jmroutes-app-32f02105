GRANT SELECT, INSERT, UPDATE, DELETE ON public.bases TO authenticated;
GRANT ALL ON public.bases TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bases TO authenticated;
GRANT ALL ON public.user_bases TO service_role;