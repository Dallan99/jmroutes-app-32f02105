import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tipo: caracterização estática. NÃO substitui integração RLS.
const src = readFileSync(resolve(process.cwd(), "src/lib/contagem-lock.functions.ts"), "utf8");

describe("contagem-lock — caracterização", () => {
  it("exige role admin para operar com baseSolicitadaId arbitrária", () => {
    expect(src).toMatch(/resolveBaseOperacionalAutorizada/);
    expect(src).toMatch(/rolesArr\.includes\("admin"\)/);
    expect(src).toMatch(/Operação bloqueada: base não autorizada/);
  });

  it("bloqueia usuário inativo e sem base vinculada", () => {
    expect(src).toMatch(/ativo === false/);
    expect(src).toMatch(/sem base operacional vinculada/);
  });

  it("aplica o helper em listar/reservar/liberar", () => {
    for (const fn of ["listarRotasLock", "reservarRotaLock", "liberarRotaLock"]) {
      const re = new RegExp(`export const ${fn}[\\s\\S]+?resolveBaseOperacionalAutorizada`);
      expect(src).toMatch(re);
    }
  });
});
