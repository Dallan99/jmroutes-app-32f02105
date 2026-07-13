import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type BaseSelecionada = {
  id: string;
  codigo: string;
  nome: string;
  cidade: string | null;
};

type BaseOperacionalState = {
  base: BaseSelecionada | null;
  diaOperacional: string | null; // YYYY-MM-DD
  setSelecao: (base: BaseSelecionada, dia: string) => void;
  trocarDia: (novoDia: string) => void;
  limpar: () => void;
};

const CTX = createContext<BaseOperacionalState | null>(null);

const STORAGE_KEY = "jm.baseOperacional";
// Usamos sessionStorage para que Admin/Gerente (que podem entrar em várias
// bases) sempre escolham a base ao iniciar uma nova sessão do navegador.
// Dentro da mesma aba, a seleção persiste normalmente.
const storage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function BaseOperacionalProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<BaseSelecionada | null>(null);
  const [diaOperacional, setDia] = useState<string | null>(null);

  useEffect(() => {
    try {
      // Migração: descarta seleção antiga persistida em localStorage,
      // para que Admin/Gerente escolham a base explicitamente.
      if (typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
      const raw = storage()?.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { base: BaseSelecionada; diaOperacional: string };
      if (s?.base?.id && s?.diaOperacional) {
        setBase(s.base);
        setDia(s.diaOperacional);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<BaseOperacionalState>(
    () => ({
      base,
      diaOperacional,
      setSelecao: (b, d) => {
        setBase(b);
        setDia(d);
        try {
          storage()?.setItem(STORAGE_KEY, JSON.stringify({ base: b, diaOperacional: d }));
        } catch {
          /* ignore */
        }
      },
      trocarDia: (novoDia) => {
        if (!base) return;
        // Aceita somente YYYY-MM-DD válido; rejeita silenciosamente qualquer outra forma.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(novoDia)) return;
        const d = new Date(novoDia + "T00:00:00");
        if (Number.isNaN(d.getTime())) return;
        setDia(novoDia);
        try {
          storage()?.setItem(STORAGE_KEY, JSON.stringify({ base, diaOperacional: novoDia }));
        } catch {
          /* ignore */
        }
      },
      limpar: () => {
        setBase(null);
        setDia(null);
        try {
          storage()?.removeItem(STORAGE_KEY);
          // Limpa também eventual valor antigo em localStorage.
          if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      },
    }),
    [base, diaOperacional],
  );

  return <CTX.Provider value={value}>{children}</CTX.Provider>;
}

export function useBaseOperacional() {
  const ctx = useContext(CTX);
  if (!ctx) throw new Error("useBaseOperacional deve ser usado dentro de BaseOperacionalProvider");
  return ctx;
}
