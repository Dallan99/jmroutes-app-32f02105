-- Rotate seed admin password to a random value so the leaked literal is no longer active.
UPDATE auth.users
   SET encrypted_password = crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf')),
       updated_at = now()
 WHERE email = 'dallan.zanini@jmdistribuicao.com.br';

-- Restrict direct execution of internal SECURITY DEFINER access helpers.
-- These helpers remain callable from policies and trusted database code, but not via the public API.
REVOKE EXECUTE ON FUNCTION public.inventario_base_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventario_global_access(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transferencia_base_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transferencia_access(uuid, uuid) FROM PUBLIC, anon, authenticated;