
-- Limpa dados fictícios anteriores
DELETE FROM public.recebimentos;
DELETE FROM public.volumes;
DELETE FROM public.rotas;

-- Adiciona campos reais da etiqueta na tabela rotas
ALTER TABLE public.rotas
  ADD COLUMN IF NOT EXISTS base_origem_id uuid REFERENCES public.bases(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pack_id text,
  ADD COLUMN IF NOT EXISTS nf text,
  ADD COLUMN IF NOT EXISTS rota_final text,
  ADD COLUMN IF NOT EXISTS destinatario_nome text,
  ADD COLUMN IF NOT EXISTS destinatario_cep text,
  ADD COLUMN IF NOT EXISTS destinatario_endereco text,
  ADD COLUMN IF NOT EXISTS destinatario_complemento text,
  ADD COLUMN IF NOT EXISTS data_prevista date,
  ADD COLUMN IF NOT EXISTS janela_despacho text;

CREATE INDEX IF NOT EXISTS rotas_base_origem_idx ON public.rotas (base_origem_id);
CREATE INDEX IF NOT EXISTS rotas_pack_id_idx ON public.rotas (pack_id);

-- Garante índice de busca rápida por código de volume (já é unique, mas reforça)
CREATE INDEX IF NOT EXISTS volumes_codigo_idx ON public.volumes (codigo);
