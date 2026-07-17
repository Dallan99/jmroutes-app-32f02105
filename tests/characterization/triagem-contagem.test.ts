import { describe, expect, it } from "vitest";
import {
  resumirRotasTriagem,
  rotaEfetivaTriagem,
  type LinhaResumoTriagem,
} from "../../src/lib/triagem-domain";

describe("contagem canônica da Triagem", () => {
  it("mostra 21 triados quando existem 21 shipments triados em uma rota de 70", () => {
    const linhas: LinhaResumoTriagem[] = Array.from({ length: 70 }, (_, indice) => ({
      shipment: `TST${String(indice + 1).padStart(4, "0")}`,
      planejada: "K12_AM1",
      otimizada: "K12_AM1",
      triado: indice < 21,
    }));

    expect(resumirRotasTriagem(linhas)).toEqual([
      {
        rota: "K12_AM1",
        previstos: 70,
        triados: 21,
        pendentes: 49,
        percentual: 30,
        status: "aberta",
      },
    ]);
  });

  it("não aumenta o previsto com linhas sem shipment bipável", () => {
    const resumo = resumirRotasTriagem([
      { shipment: "TST0001", planejada: "K1_AM1", otimizada: null, triado: true },
      { shipment: null, planejada: "K1_AM1", otimizada: null, triado: false },
      { shipment: "   ", planejada: "K1_AM1", otimizada: null, triado: false },
    ]);

    expect(resumo[0]).toMatchObject({ previstos: 1, triados: 1, status: "fechada" });
  });

  it("usa a rota otimizada e recorre à planejada somente quando necessário", () => {
    expect(rotaEfetivaTriagem({ otimizada: "K9_AM1", planejada: "K1_AM1" })).toBe("K9_AM1");
    expect(rotaEfetivaTriagem({ otimizada: null, planejada: "K1_AM1" })).toBe("K1_AM1");
    expect(rotaEfetivaTriagem({ otimizada: " ", planejada: "K2_AM1" })).toBe("K2_AM1");
  });

  it("mantém a rota vermelha/aberta até que todos os shipments estejam triados", () => {
    const incompleta = resumirRotasTriagem([
      { shipment: "TST1", planejada: "K1", otimizada: null, triado: true },
      { shipment: "TST2", planejada: "K1", otimizada: null, triado: false },
    ])[0];
    const completa = resumirRotasTriagem([
      { shipment: "TST1", planejada: "K1", otimizada: null, triado: true },
      { shipment: "TST2", planejada: "K1", otimizada: null, triado: true },
    ])[0];

    expect(incompleta).toMatchObject({ percentual: 50, status: "aberta" });
    expect(completa).toMatchObject({ percentual: 100, status: "fechada" });
  });
});
