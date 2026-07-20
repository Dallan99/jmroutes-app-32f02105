import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startAlarm, stopAlarm } from "@/lib/scanner-sound";

type Props = {
  mensagem: string | null;
  onOk: () => void;
};

/**
 * Overlay fullscreen bloqueante para erros operacionais.
 * Pisca em vermelho e toca alarme alto até o usuário confirmar com OK.
 */
export function ErroBloqueioOverlay({ mensagem, onOk }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mensagem) return;
    startAlarm();
    btnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Bloqueia teclas do scanner e Enter enquanto o alerta está ativo,
      // exceto Enter/Space para confirmar via botão focado (default do browser).
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      stopAlarm();
    };
  }, [mensagem]);

  if (!mensagem) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Erro operacional"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-6 erro-bloqueio-backdrop"
    >
      <div className="max-w-2xl w-full rounded-2xl bg-white border-4 border-red-700 shadow-2xl p-8 md:p-10 text-center animate-in fade-in zoom-in duration-150">
        <div className="mx-auto w-20 h-20 rounded-full bg-red-600 text-white flex items-center justify-center mb-5 erro-bloqueio-icone">
          <AlertTriangle className="w-12 h-12" />
        </div>
        <h2 className="text-3xl md:text-4xl font-black uppercase tracking-wider text-red-700 mb-4">
          Erro na Triagem
        </h2>
        <p className="text-lg md:text-xl font-semibold text-red-900 leading-snug mb-8 break-words">
          {mensagem}
        </p>
        <Button
          ref={btnRef}
          size="lg"
          onClick={onOk}
          className="w-full h-16 text-2xl font-bold bg-red-600 hover:bg-red-700 text-white uppercase tracking-widest"
        >
          OK — Entendi
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          Confirme para liberar a tela e continuar a operação.
        </p>
      </div>
    </div>
  );
}
