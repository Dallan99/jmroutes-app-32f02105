import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizarCodigoTriagem } from "../../src/lib/triagem-domain";

const triagemPage = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/triagem.tsx"),
  "utf8",
);
const triagemFunctions = readFileSync(
  resolve(process.cwd(), "src/lib/triagem.functions.ts"),
  "utf8",
);
const contextoBase = readFileSync(
  resolve(process.cwd(), "src/lib/base-operacional.functions.ts"),
  "utf8",
);
const appShell = readFileSync(resolve(process.cwd(), "src/components/app-shell.tsx"), "utf8");

describe("Triagem — agilidade entre bips", () => {
  it.each(["445255252", "44525353"])("reconhece o código %s sem alteração", (codigo) => {
    expect(normalizarCodigoTriagem(codigo)).toBe(codigo);
  });

  it("consolida atualizações pesadas após uma sequência de leituras", () => {
    expect(triagemPage).toContain("agendarAtualizacoes");
    expect(triagemPage).toContain("}, 800)");
  });

  it("registra histórico e auditoria em paralelo", () => {
    expect(triagemFunctions).toContain("Promise.all([registro, auditoria])");
  });
});

describe("Devoluções — acesso dos logins", () => {
  it("mantém a página no menu operacional sem restrição por cargo", () => {
    expect(appShell).toContain('{ title: "Devoluções", to: "/devolucoes", icon: RotateCcw }');
  });

  it("considera bases atribuídas por user_bases ao liberar a tela", () => {
    expect(contextoBase).toContain('.from("user_bases")');
    expect(contextoBase).toContain("podeSelecionarBase");
    expect(contextoBase).toContain("permitidas.length > 1");
  });
});
