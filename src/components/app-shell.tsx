import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  ScanBarcode,
  PackageSearch,
  ClipboardList,
  History,
  TrendingUp,
  Users,
  Settings,
  ShieldCheck,
  LogOut,
  Boxes,
  RotateCcw,
} from "lucide-react";
import { JmLogo, JmWordmark } from "@/components/jm-logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { meuPerfil } from "@/lib/recebimento.functions";
import { useClock, formatDateTimeBR } from "@/lib/use-clock";
import { toast } from "sonner";
import { BaseOperacionalProvider, useBaseOperacional } from "@/lib/base-operacional-context";
import { SeletorBaseDia } from "@/components/base-operacional-selector";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const INACTIVITY_MS = 4 * 60 * 60 * 1000; // 4 horas

function useInactivityLogout() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        try {
          const { registrarAudit } = await import("@/lib/audit.functions");
          await registrarAudit({ data: { acao: "logout.inatividade", entidade: "auth" } });
        } catch {
          /* ignore */
        }
        await supabase.auth.signOut();
        toast.info("Sessão expirada por inatividade. Faça login novamente.");
        window.location.href = "/auth";
      }, INACTIVITY_MS);
    };
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}

type NavItem = {
  title: string;
  to: string;
  icon: typeof LayoutDashboard;
  /** Quando true, o item aparece desabilitado com selo "em breve". */
  soon?: boolean;
  /** Se definido, só renderiza para esses perfis. */
  roles?: Array<Role>;
};

type Role = "admin" | "supervisor" | "gerente" | "operador";

const NAV_OPERACIONAL: NavItem[] = [
  { title: "Bases", to: "/bases", icon: Boxes },
  { title: "Dashboard", to: "/dashboard", icon: LayoutDashboard, roles: ["admin", "supervisor", "gerente"] },
  { title: "Recebimento", to: "/recebimento", icon: ScanBarcode },
  { title: "Triagem", to: "/triagem", icon: PackageSearch },
  { title: "Contagem", to: "/contagem", icon: ClipboardList },
  { title: "Devoluções", to: "/devolucoes", icon: RotateCcw },
  { title: "Inventário", to: "/inventario", icon: ClipboardList },
];
const NAV_GESTAO: NavItem[] = [
  { title: "Histórico", to: "/historico", icon: History, roles: ["admin", "supervisor", "gerente"] },
  { title: "Gerencial", to: "/gerencial", icon: TrendingUp, roles: ["admin", "supervisor", "gerente"] },
];
const NAV_ADMIN: NavItem[] = [
  { title: "Usuários", to: "/usuarios", icon: Users, roles: ["admin"] },
  { title: "Configurações", to: "/configuracoes", icon: Settings, roles: ["admin"] },
  { title: "Auditoria", to: "/auditoria", icon: ShieldCheck, roles: ["admin"] },
];

export function AppShell() {
  const fetchPerfil = useServerFn(meuPerfil);
  const perfilQuery = useQuery({
    queryKey: ["meu-perfil"],
    queryFn: () => fetchPerfil(),
    staleTime: 60_000,
  });
  const roles = (perfilQuery.data?.roles ?? ["operador"]) as Array<Role>;
  useInactivityLogout();

  return (
    <BaseOperacionalProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar roles={roles} />
          <div className="flex-1 flex flex-col min-w-0">
            <TopBar nome={perfilQuery.data?.profile?.nome ?? null} roles={roles} />
            <main className="flex-1 min-w-0">
              <Outlet />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </BaseOperacionalProvider>
  );
}

function AppSidebar({ roles }: { roles: Array<Role> }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const allow = (item: NavItem) => !item.roles || item.roles.some((r) => roles.includes(r));

  const renderGroup = (label: string, items: NavItem[]) => {
    const visible = items.filter(allow);
    if (!visible.length) return null;
    return (
      <SidebarGroup>
        {!collapsed && <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase tracking-[0.14em] text-[10px]">{label}</SidebarGroupLabel>}
        <SidebarGroupContent>
          <SidebarMenu>
            {visible.map((item) => {
              const active = pathname.startsWith(item.to);
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild={!item.soon}
                    isActive={active}
                    disabled={item.soon}
                    tooltip={item.title}
                    className={item.soon ? "opacity-50 cursor-not-allowed" : ""}
                  >
                    {item.soon ? (
                      <div className="flex items-center gap-2 w-full">
                        <item.icon className="w-4 h-4 shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="truncate">{item.title}</span>
                            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-sidebar-accent/60 text-sidebar-foreground/60 uppercase">
                              em breve
                            </span>
                          </>
                        )}
                      </div>
                    ) : (
                      <Link to={item.to} className="flex items-center gap-2">
                        <item.icon className="w-4 h-4 shrink-0" />
                        {!collapsed && <span className="truncate">{item.title}</span>}
                      </Link>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border h-14 flex items-center justify-center px-3">
        <Link to="/inicio" title="Voltar para o início" className="flex items-center justify-center w-full">
          {collapsed ? <JmLogo size={28} /> : <JmWordmark />}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {renderGroup("Operação", NAV_OPERACIONAL)}
        {renderGroup("Gestão", NAV_GESTAO)}
        {renderGroup("Administração", NAV_ADMIN)}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && (
          <div className="text-[10px] text-sidebar-foreground/50 px-2 py-1">
            v1.0 · Iteração 1
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

function TopBar({ nome, roles }: { nome: string | null; roles: string[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const now = useClock(1000);
  const { base, diaOperacional, limpar } = useBaseOperacional();
  const [trocarOpen, setTrocarOpen] = useState(false);
  const principal = roles.includes("admin")
    ? "Administrador"
    : roles.includes("gerente")
    ? "Gerente"
    : roles.includes("supervisor")
    ? "Supervisor"
    : "Operador";

  async function logout() {
    try {
      const { registrarAudit } = await import("@/lib/audit.functions");
      await registrarAudit({ data: { acao: "logout", entidade: "auth" } });
    } catch {
      /* segue o logout mesmo sem auditoria */
    }
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Sessão encerrada.");
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="h-14 border-b bg-card flex items-center px-3 gap-3 sticky top-0 z-30">
      <SidebarTrigger />
      <div className="hidden md:flex items-center text-xs text-muted-foreground font-mono">
        {formatDateTimeBR(now)}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="text-right leading-tight">
          <div className="text-sm font-medium">{nome ?? "—"}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {principal}
            {base && diaOperacional && (
              <>
                {" · "}
                <span className="font-mono normal-case">
                  {base.codigo} · {new Date(diaOperacional + "T00:00:00").toLocaleDateString("pt-BR")}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="w-8 h-8 rounded-full brand-gradient text-white flex items-center justify-center text-xs font-bold uppercase">
          {(nome ?? "?").slice(0, 2)}
        </div>
        <Button variant="ghost" size="icon" onClick={logout} title="Sair">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={trocarOpen} onOpenChange={setTrocarOpen}>
        <DialogContent className="max-w-3xl p-0 bg-transparent border-none shadow-none">
          <SeletorBaseDia
            titulo="Trocar Base Operacional"
            descricao="Escolha a Base e o Dia com que você quer trabalhar."
            onSelecionar={() => setTrocarOpen(false)}
          />
          {base && (
            <div className="text-center pb-4">
              <Button variant="ghost" size="sm" onClick={() => { limpar(); setTrocarOpen(false); }}>
                Limpar seleção
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </header>
  );
}