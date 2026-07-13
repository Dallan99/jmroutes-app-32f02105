
-- ============ Enums ============
CREATE TYPE public.app_role AS ENUM ('admin', 'supervisor', 'operador');
CREATE TYPE public.rota_status AS ENUM ('pendente', 'em_recebimento', 'recebida_parcial', 'recebida_completa', 'cancelada', 'encerrada');
CREATE TYPE public.recebimento_resultado AS ENUM ('ok', 'duplicado', 'inexistente', 'outra_rota', 'outra_base', 'cancelada', 'encerrada', 'volume_repetido');

-- ============ Bases ============
CREATE TABLE public.bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  cidade TEXT NOT NULL,
  uf TEXT NOT NULL,
  ativa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bases TO authenticated;
GRANT ALL ON public.bases TO service_role;
ALTER TABLE public.bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read bases" ON public.bases FOR SELECT TO authenticated USING (true);

-- ============ Motoristas ============
CREATE TABLE public.motoristas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cpf TEXT,
  cnh TEXT,
  placa TEXT,
  transportadora TEXT,
  base_id UUID REFERENCES public.bases(id) ON DELETE SET NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.motoristas TO authenticated;
GRANT ALL ON public.motoristas TO service_role;
ALTER TABLE public.motoristas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read motoristas" ON public.motoristas FOR SELECT TO authenticated USING (true);

-- ============ Profiles ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  matricula TEXT,
  base_id UUID REFERENCES public.bases(id) ON DELETE SET NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- ============ User roles ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Allow supervisors/admins broader profile reads
CREATE POLICY "supervisors read all profiles" ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage profiles" ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Allow supervisors/admins to see all roles
CREATE POLICY "supervisors read all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ Rotas ============
CREATE TABLE public.rotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  motorista_id UUID REFERENCES public.motoristas(id) ON DELETE SET NULL,
  base_id UUID NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  cidade TEXT NOT NULL,
  transportadora TEXT,
  data_expedicao DATE NOT NULL DEFAULT CURRENT_DATE,
  quantidade_prevista INT NOT NULL DEFAULT 0,
  status public.rota_status NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rotas TO authenticated;
GRANT ALL ON public.rotas TO service_role;
ALTER TABLE public.rotas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read rotas" ON public.rotas FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update rotas" ON public.rotas FOR UPDATE TO authenticated USING (true);
CREATE POLICY "admins insert rotas" ON public.rotas FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

-- ============ Volumes ============
CREATE TABLE public.volumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rota_id UUID NOT NULL REFERENCES public.rotas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL UNIQUE,
  sequencia INT NOT NULL,
  total INT NOT NULL,
  recebido BOOLEAN NOT NULL DEFAULT false,
  recebido_em TIMESTAMPTZ,
  recebido_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX volumes_rota_idx ON public.volumes(rota_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.volumes TO authenticated;
GRANT ALL ON public.volumes TO service_role;
ALTER TABLE public.volumes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read volumes" ON public.volumes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update volumes" ON public.volumes FOR UPDATE TO authenticated USING (true);

-- ============ Recebimentos (log imutável de cada bipagem) ============
CREATE TABLE public.recebimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_bipado TEXT NOT NULL,
  rota_id UUID REFERENCES public.rotas(id) ON DELETE SET NULL,
  volume_id UUID REFERENCES public.volumes(id) ON DELETE SET NULL,
  base_id UUID REFERENCES public.bases(id) ON DELETE SET NULL,
  operador_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  resultado public.recebimento_resultado NOT NULL,
  mensagem TEXT,
  ip TEXT,
  user_agent TEXT,
  tempo_desde_ultima_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX recebimentos_created_idx ON public.recebimentos(created_at DESC);
CREATE INDEX recebimentos_operador_idx ON public.recebimentos(operador_id);
CREATE INDEX recebimentos_rota_idx ON public.recebimentos(rota_id);
GRANT SELECT, INSERT ON public.recebimentos TO authenticated;
GRANT ALL ON public.recebimentos TO service_role;
ALTER TABLE public.recebimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operador insere proprio" ON public.recebimentos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = operador_id);
CREATE POLICY "operador le proprio" ON public.recebimentos FOR SELECT TO authenticated
  USING (auth.uid() = operador_id OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'admin'));

-- ============ Audit log ============
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acao TEXT NOT NULL,
  entidade TEXT,
  entidade_id TEXT,
  detalhes JSONB,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));
CREATE POLICY "auth insert audit" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============ Trigger: cria profile + role 'operador' no signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'operador');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ Realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.recebimentos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.volumes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rotas;
