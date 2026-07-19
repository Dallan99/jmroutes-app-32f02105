import { describe, it, expect } from "vitest";
import { montarHtmlRelatorio, montarLinhasTriagemRota } from "../../src/lib/relatorio";

// Test C — Triagem: 239 faltantes + 10 triados na rota selecionada.
// Uma "outra rota" com IDs diferentes NÃO deve aparecer no relatório.
describe("montarLinhasTriagemRota — 239 faltantes + 10 triados = 249 linhas, sem outra rota", () => {
  const rotaAlvo = {
    pendentes: Array.from({ length: 239 }, (_, i) => ({ shipment: `A-${i}`, cidade: "Manaus" })),
    triados: Array.from({ length: 10 }, (_, i) => ({ shipment: `A-tri-${i}`, cidade: "Manaus" })),
  };
  // rota diferente — não deve vazar
  const outraRota = {
    pendentes: Array.from({ length: 20 }, (_, i) => ({ shipment: `B-${i}`, cidade: "Manacapuru" })),
    triados: Array.from({ length: 5 }, (_, i) => ({ shipment: `B-tri-${i}`, cidade: "Manacapuru" })),
  };

  it("gera 249 linhas exatas com status correto", () => {
    const linhas = montarLinhasTriagemRota(rotaAlvo);
    expect(linhas.length).toBe(249);
    expect(linhas.filter((l) => l.status === "triado").length).toBe(10);
    expect(linhas.filter((l) => l.status === "pendente").length).toBe(239);
    // Todos os IDs da rota aparecem — nenhum a menos, nenhum a mais.
    const shipments = new Set(linhas.map((l) => l.shipment));
    expect(shipments.size).toBe(249);
    rotaAlvo.pendentes.forEach((p) => expect(shipments.has(p.shipment)).toBe(true));
    rotaAlvo.triados.forEach((t) => expect(shipments.has(t.shipment)).toBe(true));
  });

  it("nenhum ID da outra rota aparece no relatório da rota alvo", () => {
    const linhas = montarLinhasTriagemRota(rotaAlvo);
    const shipments = new Set(linhas.map((l) => l.shipment));
    outraRota.pendentes.forEach((p) => expect(shipments.has(p.shipment)).toBe(false));
    outraRota.triados.forEach((t) => expect(shipments.has(t.shipment)).toBe(false));
  });
});

// Test D — HTML de impressão.
describe("montarHtmlRelatorio — CSS de quebra de página e cabeçalho de grupo no <thead>", () => {
  type Dev = { id: string; rota: string };
  const linhas: Dev[] = [
    { id: "1", rota: "V1_AM1" },
    { id: "2", rota: "V1_AM1" },
    { id: "3", rota: "K1_AM1" },
  ];

  const html = montarHtmlRelatorio<Dev>({
    titulo: "Devoluções agrupadas por rota",
    colunas: [
      { header: "ID", value: (d) => d.id },
      { header: "Rota", value: (d) => d.rota },
    ],
    linhas,
    agruparPor: (d) => d.rota,
  });

  it("declara thead como table-header-group e tfoot como table-footer-group", () => {
    expect(html).toMatch(/thead\s*\{\s*display\s*:\s*table-header-group\s*\}/);
    expect(html).toMatch(/tfoot\s*\{\s*display\s*:\s*table-footer-group\s*\}/);
  });

  it("declara break-inside: avoid nas linhas (tr)", () => {
    expect(html).toMatch(/tr\s*\{[^}]*break-inside\s*:\s*avoid/);
    expect(html).toMatch(/tr\s*\{[^}]*page-break-inside\s*:\s*avoid/);
  });

  it(".grupo permite quebra normal entre páginas (break-inside: auto)", () => {
    expect(html).toMatch(/\.grupo\s*\{[^}]*break-inside\s*:\s*auto/);
    expect(html).toMatch(/\.grupo\s*\{[^}]*page-break-inside\s*:\s*auto/);
  });

  it(".grupo-head evita quebra logo após (break-after: avoid)", () => {
    expect(html).toMatch(/\.grupo-head\s*\{[^}]*break-after\s*:\s*avoid/);
  });

  it("coloca o nome e a quantidade da rota DENTRO do <thead> com colspan", () => {
    expect(html).toMatch(
      /<thead><tr class="grupo-head"><th colspan="2">V1_AM1 — 2 registros<\/th>/,
    );
    expect(html).toMatch(
      /<thead><tr class="grupo-head"><th colspan="2">K1_AM1 — 1 registro<\/th>/,
    );
  });

  it("não aplica max-height nem overflow (auto|hidden) ao corpo do relatório", () => {
    // As regras do relatório impresso não podem esconder linhas.
    expect(html).not.toMatch(/max-height\s*:/);
    expect(html).not.toMatch(/overflow\s*:\s*(auto|hidden)/);
  });
});
