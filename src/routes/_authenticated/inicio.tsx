import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Boxes, ScanBarcode, PackageSearch, ClipboardList, TrendingUp, RotateCcw } from "lucide-react";
import { JmLogo } from "@/components/jm-logo";
import { JM_HERO_DATA_URL } from "@/assets/brand-images";

export const Route = createFileRoute("/_authenticated/inicio")({
  component: InicioPage,
});

const ATALHOS = [
  { to: "/bases", title: "Bases", desc: "Importar escalas e gerenciar bases operacionais", icon: Boxes },
  { to: "/recebimento", title: "Recebimento", desc: "Bipar pedidos na chegada", icon: ScanBarcode },
  { to: "/triagem", title: "Triagem", desc: "Separar pedidos por rota", icon: PackageSearch },
  { to: "/contagem", title: "Contagem", desc: "Conferir volumes por rota", icon: ClipboardList },
  { to: "/devolucoes", title: "Devoluções", desc: "Registrar insucessos retornados", icon: RotateCcw },
  { to: "/gerencial", title: "Gerencial", desc: "Visão em tempo real de todas as bases", icon: TrendingUp },
] as const;

function InicioPage() {
  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
      <section className="relative overflow-hidden rounded-2xl border bg-card">
        <img
          src={JM_HERO_DATA_URL}
          alt="Frota JM Transportes"
          className="w-full h-56 md:h-72 object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-transparent" />
        <div className="absolute inset-0 flex items-center px-6 md:px-10">
          <div className="max-w-xl space-y-3">
            <div className="flex items-center gap-3">
              <JmLogo size={40} />
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                JM Transportes · Last Mile
              </div>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Bem-vindo à Plataforma Operacional
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Gerencie escalas, recebimento, triagem, contagem e devoluções em um só lugar.
            </p>
            <div className="pt-2">
              <Button asChild size="lg">
                <Link to="/bases">Ir para Bases</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Acesso rápido
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ATALHOS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="group rounded-xl border bg-card p-5 hover:border-primary/60 hover:shadow-md transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <a.icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold group-hover:text-primary transition-colors">
                    {a.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{a.desc}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
