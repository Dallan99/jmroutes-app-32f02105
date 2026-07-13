import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { JmLogo } from "@/components/jm-logo";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Redefinir senha — JM Transportes" },
      { name: "description", content: "Defina uma nova senha para sua conta." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Supabase entrega a sessão de recovery no hash da URL.
    // O client processa automaticamente; validamos que existe sessão.
    const timer = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        toast.error("Link inválido ou expirado. Solicite outro.");
        navigate({ to: "/auth", replace: true });
        return;
      }
      setReady(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [navigate]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 6) return toast.error("A senha deve ter ao menos 6 caracteres.");
    if (senha !== confirmar) return toast.error("As senhas não conferem.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Senha atualizada. Faça login novamente.");
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center brand-gradient p-6">
      <Card className="w-full max-w-md p-6 shadow-2xl border-0">
        <div className="flex items-center gap-3 mb-6">
          <JmLogo size={40} />
          <div>
            <div className="font-display font-bold text-lg">Redefinir senha</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider">JM Transportes</div>
          </div>
        </div>
        {!ready ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Validando link…
          </div>
        ) : (
          <form onSubmit={salvar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nova">Nova senha</Label>
              <div className="relative">
                <Input
                  id="nova"
                  type={show ? "text" : "password"}
                  required
                  minLength={6}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                  tabIndex={-1}
                >
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="conf">Confirmar nova senha</Label>
              <Input
                id="conf"
                type={show ? "text" : "password"}
                required
                minLength={6}
                value={confirmar}
                onChange={(e) => setConfirmar(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar nova senha
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}