
ALTER TABLE public.volumes
  ADD COLUMN IF NOT EXISTS triado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS triado_em timestamptz,
  ADD COLUMN IF NOT EXISTS triado_por uuid REFERENCES auth.users(id);

DO $$ BEGIN
  CREATE TYPE public.bip_stage AS ENUM ('recebimento','triagem');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS stage public.bip_stage NOT NULL DEFAULT 'recebimento';

DO $$ BEGIN
  ALTER TYPE public.rota_status ADD VALUE IF NOT EXISTS 'em_triagem';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
