-- Add 'gerente' role to app_role enum and grant Supervisor-level access plus user management.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gerente';
