UPDATE auth.users
SET encrypted_password = crypt('JMadmin@2026', gen_salt('bf')),
    updated_at = now()
WHERE email = 'dallan.zanini@jmdistribuicao.com.br';