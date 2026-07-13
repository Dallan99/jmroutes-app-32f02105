
REVOKE EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_allowed_bases(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_allowed_bases(uuid) TO authenticated, service_role;
