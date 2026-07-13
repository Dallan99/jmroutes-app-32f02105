import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tipo: caracterização estática. NÃO substitui integração RLS/PostgreSQL.
//
// Estratégia: isolamos o corpo de cada server function ANTES de checar
// se ela invoca `resolveBaseOperacionalAutorizada`. Isso evita que uma
// única ocorrência global do helper "vaze" a regex para outra função e
// dê um falso positivo.
const src = readFileSync(
  resolve(process.cwd(), "src/lib/contagem-lock.functions.ts"),
  "utf8",
);

/**
 * Extrai o corpo de `export const <nome> = ...` até o próximo
 * `export const` ou o fim do arquivo. Retorna string vazia se não achou.
 */
function extrairCorpo(nome: string): string {
  const re = new RegExp(
    `export\\s+const\\s+${nome}\\b[\\s\\S]*?(?=\\n\\s*export\\s+const\\s|\\n?$)`,
  );
  const m = src.match(re);
  return m ? m[0] : "";
}

describe("contagem-lock — caracterização (helpers globais)", () => {
  it("define o helper resolveBaseOperacionalAutorizada com regras de admin/inativo", () => {
    expect(src).toMatch(/async\s+function\s+resolveBaseOperacionalAutorizada/);
    expect(src).toMatch(/rolesArr\.includes\("admin"\)/);
    expect(src).toMatch(/Operação bloqueada: base não autorizada/);
    expect(src).toMatch(/ativo === false/);
    expect(src).toMatch(/sem base operacional vinculada/);
  });
});

describe("contagem-lock — cada função aplica o helper isoladamente", () => {
  for (const fn of ["listarRotasLock", "reservarRotaLock", "liberarRotaLock"]) {
    it(`${fn}: corpo isolado invoca resolveBaseOperacionalAutorizada`, () => {
      const corpo = extrairCorpo(fn);
      // 1) O corpo foi realmente encontrado e isolado.
      expect(corpo, `função ${fn} não foi localizada como export const`).not.toBe("");
      expect(corpo.startsWith(`export const ${fn}`)).toBe(true);
      // 2) Ele não engoliu a próxima função — se houver outra export const
      //    posterior no arquivo, ela NÃO pode estar dentro do corpo isolado.
      const outros = ["listarRotasLock", "reservarRotaLock", "liberarRotaLock"].filter(
        (n) => n !== fn,
      );
      for (const n of outros) {
        expect(corpo.includes(`export const ${n}`)).toBe(false);
      }
      // 3) Só então validamos o uso do helper dentro do corpo isolado.
      expect(corpo).toMatch(/resolveBaseOperacionalAutorizada\s*\(/);
    });
  }
});
