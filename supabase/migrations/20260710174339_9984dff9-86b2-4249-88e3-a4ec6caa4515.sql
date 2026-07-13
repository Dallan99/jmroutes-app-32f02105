
-- 1) Rotate seed admin password (invalidate plaintext committed in migration history)
UPDATE auth.users
   SET encrypted_password = crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf')),
       updated_at = now()
 WHERE email = 'dallan.zanini@jmdistribuicao.com.br';

-- 2) Column-level protection for PII on motoristas.
--    RLS cannot restrict columns; use column privileges so base staff cannot
--    read cpf/cnh even though row-level policies allow them to see the row.
REVOKE SELECT ON public.motoristas FROM authenticated;
GRANT SELECT (
  id, nome, placa, transportadora, base_id, ativo, created_at
) ON public.motoristas TO authenticated;

-- Keep write privileges for staff-managed columns unchanged
GRANT INSERT, UPDATE, DELETE ON public.motoristas TO authenticated;

-- service_role retains full access for admin operations
GRANT ALL ON public.motoristas TO service_role;
