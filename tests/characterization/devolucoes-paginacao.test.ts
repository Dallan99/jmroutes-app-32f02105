import { describe, it, expect } from "vitest";
import {
  paginarTodasDevolucoes,
  DEVOLUCOES_PAGE,
  filtrarDevolucoesPorRota,
  normalizarRotaDevolucao,
} from "../../src/lib/devolucoes.functions";

type Row = { id: string; devolvido_em: string };

function makePage(from: number, count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const idx = from + i;
    rows.push({
      id: `id-${String(idx).padStart(6, "0")}`,
      devolvido_em: new Date(1_700_000_000_000 + idx).toISOString(),
    });
  }
  return rows;
}

describe("paginarTodasDevolucoes — 1.205 registros em duas páginas", () => {
  it("acumula 1.000 + 205 e faz exatamente duas chamadas com ranges corretos", async () => {
    const calls: Array<{ from: number; to: number }> = [];
    const total = 1205;
    const rows = await paginarTodasDevolucoes<Row>(async (from, to) => {
      calls.push({ from, to });
      const chunk = makePage(from, Math.max(0, Math.min(total - from, to - from + 1)));
      return { data: chunk, error: null };
    });

    expect(rows.length).toBe(total);
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual({ from: 0, to: DEVOLUCOES_PAGE - 1 });
    expect(calls[1]).toEqual({ from: DEVOLUCOES_PAGE, to: 2 * DEVOLUCOES_PAGE - 1 });

    // Nenhum ID perdido nem duplicado artificialmente.
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.size).toBe(total);
    expect(rows[0].id).toBe("id-000000");
    expect(rows[total - 1].id).toBe(`id-${String(total - 1).padStart(6, "0")}`);
  });

  it("aborta ao encontrar erro na segunda página e não devolve relatório parcial", async () => {
    let page = 0;
    await expect(
      paginarTodasDevolucoes<Row>(async (from, to) => {
        if (page++ === 0) return { data: makePage(from, to - from + 1), error: null };
        return { data: null, error: { message: "boom" } };
      }),
    ).rejects.toThrowError("boom");
  });

  it("respeita limite técnico de páginas com erro explícito", async () => {
    await expect(
      paginarTodasDevolucoes<Row>(
        async (from, _to) => ({ data: makePage(from, DEVOLUCOES_PAGE), error: null }),
        DEVOLUCOES_PAGE,
        3,
      ),
    ).rejects.toThrowError(/Limite técnico/);
  });

  it("aceita quantidade exatamente igual ao limite quando a página de prova vem vazia", async () => {
    const total = DEVOLUCOES_PAGE * 3;
    const rows = await paginarTodasDevolucoes<Row>(
      async (from, to) => ({
        data: makePage(from, Math.max(0, Math.min(total - from, to - from + 1))),
        error: null,
      }),
      DEVOLUCOES_PAGE,
      3,
    );
    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((r) => r.id)).size).toBe(total);
  });
});

// Test B — impressão de uma rota específica: filtro puro, sem outras
// rotas / cancelados / dias / bases misturados.
describe("filtrarDevolucoesPorRota — dados sintéticos V1_AM1 / K1_AM1 / cancelados / sem rota", () => {
  type Dev = { id: string; rota: string | null; cancelado: boolean };
  const dados: Dev[] = [
    ...Array.from({ length: 300 }, (_, i) => ({ id: `V-${i}`, rota: "V1_AM1", cancelado: false })),
    ...Array.from({ length: 50 }, (_, i) => ({ id: `K-${i}`, rota: "K1_AM1", cancelado: false })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `C-${i}`, rota: "V1_AM1", cancelado: true })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `S-${i}`, rota: null, cancelado: false })),
    // ruído: variações de caixa/espaço na rota devem casar após normalização
    { id: "V-extra-1", rota: " v1_am1 ", cancelado: false },
    { id: "V-extra-2", rota: "V1_am1", cancelado: false },
  ];

  it("V1_AM1 imprime exatamente 302 linhas (300 + 2 variações normalizadas) e nenhum K1_AM1/cancelado/sem rota", () => {
    const linhas = filtrarDevolucoesPorRota(dados, "V1_AM1");
    expect(linhas.length).toBe(302);
    expect(linhas.every((l) => normalizarRotaDevolucao(l.rota) === "V1_AM1")).toBe(true);
    expect(linhas.some((l) => l.cancelado)).toBe(false);
    expect(linhas.some((l) => l.id.startsWith("K-"))).toBe(false);
    expect(linhas.some((l) => l.id.startsWith("S-"))).toBe(false);
    expect(linhas.some((l) => l.id.startsWith("C-"))).toBe(false);
  });

  it("K1_AM1 retorna 50 registros e nada mais", () => {
    const linhas = filtrarDevolucoesPorRota(dados, "K1_AM1");
    expect(linhas.length).toBe(50);
    expect(linhas.every((l) => l.id.startsWith("K-"))).toBe(true);
  });

  it("grupo (sem rota) retorna somente os 5 registros sem rota", () => {
    const linhas = filtrarDevolucoesPorRota(dados, null);
    expect(linhas.length).toBe(5);
    expect(linhas.every((l) => l.id.startsWith("S-"))).toBe(true);
  });
});
