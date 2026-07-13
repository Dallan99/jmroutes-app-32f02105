import { createFileRoute, Outlet, redirect, Link, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, X, Play, Pause, Gauge, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/tv")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
  },
  component: TvShell,
});

const ROTATION_MS = 20_000;

function TvShell() {
  const rs = useRouterState();
  const path = rs.location.pathname;
  const [isFs, setIsFs] = useState(false);
  const [rotate, setRotate] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (!rotate) return;
    const id = setInterval(() => {
      const next = path.endsWith("/gerencial") ? "/tv/dashboard" : "/tv/gerencial";
      window.history.pushState({}, "", next);
      // Trigger router re-evaluation
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, ROTATION_MS);
    return () => clearInterval(id);
  }, [rotate, path]);

  async function toggleFs() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {}
  }

  return (
    <div ref={rootRef} className="min-h-screen bg-[var(--brand-navy)] text-white flex flex-col">
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-white/10 bg-black/20">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] font-semibold text-[var(--brand-yellow)]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Modo TV
          </span>
          <nav className="flex items-center gap-1">
            <TvNav to="/tv/dashboard" icon={Gauge} label="Operacional" active={path.endsWith("/dashboard")} />
            <TvNav to="/tv/gerencial" icon={BarChart3} label="Gerencial" active={path.endsWith("/gerencial")} />
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => setRotate((r) => !r)}
          >
            {rotate ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}
            {rotate ? "Pausar" : "Alternar auto"}
          </Button>
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={toggleFs}>
            {isFs ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
          <Link to="/dashboard">
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
              <X className="w-4 h-4 mr-1" /> Sair
            </Button>
          </Link>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function TvNav({ to, icon: Icon, label, active }: { to: string; icon: typeof Gauge; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition ${
        active ? "bg-[var(--brand-yellow)] text-[var(--brand-navy)]" : "text-white/70 hover:text-white hover:bg-white/10"
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </Link>
  );
}