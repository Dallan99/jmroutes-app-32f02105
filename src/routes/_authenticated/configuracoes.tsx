import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Settings } from "lucide-react";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — JM Transportes" }] }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Parâmetros gerais do sistema, políticas de sessão e preferências operacionais.
        </p>
      </div>
      <Card className="p-10 flex flex-col items-center justify-center text-center gap-3 border-dashed">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Settings className="w-6 h-6 text-primary" />
        </div>
        <div className="space-y-1">
          <div className="font-medium">Módulo em construção</div>
          <p className="text-sm text-muted-foreground max-w-md">
            Em breve: tempo de inatividade, política de senhas, integrações, notificações
            e preferências por base.
          </p>
        </div>
      </Card>
    </div>
  );
}