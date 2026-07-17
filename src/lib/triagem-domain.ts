export type LinhaResumoTriagem = {
  shipment: string | null;
  planejada: string | null;
  otimizada: string | null;
  triado: boolean | null;
};

export type RotaResumoTriagem = {
  rota: string;
  previstos: number;
  triados: number;
  pendentes: number;
  percentual: number;
  status: "aberta" | "fechada";
};

/** Normaliza a leitura sem impor atraso artificial entre dois códigos distintos. */
export function normalizarCodigoTriagem(codigo: string): string {
  return codigo.trim().replace(/[^0-9A-Za-z]/g, "");
}

/** Regra canônica usada em toda a Triagem para determinar a rota operacional. */
export function rotaEfetivaTriagem(
  linha: Pick<LinhaResumoTriagem, "otimizada" | "planejada">,
): string | null {
  const otimizada = linha.otimizada?.trim();
  if (otimizada) return otimizada;
  const planejada = linha.planejada?.trim();
  return planejada || null;
}

/**
 * Conta apenas IDs realmente bipáveis. Linhas sem shipment não podem aumentar
 * o previsto da rota, pois nunca poderão ser triadas pelo operador.
 */
export function resumirRotasTriagem(linhas: LinhaResumoTriagem[]): RotaResumoTriagem[] {
  const acc = new Map<string, { previstos: number; triados: number }>();

  for (const linha of linhas) {
    if (!linha.shipment?.trim()) continue;
    const rota = rotaEfetivaTriagem(linha);
    if (!rota) continue;

    const atual = acc.get(rota) ?? { previstos: 0, triados: 0 };
    atual.previstos += 1;
    if (linha.triado) atual.triados += 1;
    acc.set(rota, atual);
  }

  return Array.from(acc.entries())
    .map(([rota, valores]) => {
      const pendentes = Math.max(valores.previstos - valores.triados, 0);
      const percentual = valores.previstos
        ? Math.round((valores.triados / valores.previstos) * 100)
        : 0;
      return {
        rota,
        previstos: valores.previstos,
        triados: valores.triados,
        pendentes,
        percentual,
        status: pendentes === 0 ? ("fechada" as const) : ("aberta" as const),
      };
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "aberta" ? -1 : 1;
      return a.rota.localeCompare(b.rota, "pt-BR", { numeric: true });
    });
}
