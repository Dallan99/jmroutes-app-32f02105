import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tipo: caracterização por leitura estática do código.
// NÃO substitui integração PostgreSQL.
const src = readFileSync(resolve(process.cwd(), "src/lib/recebimento.functions.ts"), "utf8");

describe("recebimento.bipar — caracterização do código atual", () => {
  it("faz check-then-act em volume.recebido sem lock", () => {
    expect(src).toMatch(/from\("volumes"\)[\s\S]{0,400}\.eq\("codigo"/);
    expect(src).toMatch(/if\s*\(volume\.recebido\)/);
    expect(src).toMatch(/\.update\(\{\s*recebido:\s*true/);
    expect(src).not.toMatch(/for\s+update/i);
    expect(src).not.toMatch(/registrar_bipagem|\.rpc\(/);
  });

  it("insert em recebimentos não desestrutura error (auditoria best-effort)", () => {
    expect(src).toMatch(/from\("recebimentos"\)\s*\.insert\(/);
    expect(src).not.toMatch(/const\s*\{\s*error[^}]*\}\s*=\s*await\s+supabase\s*\.from\("recebimentos"\)/);
  });

  it("log usa base da ROTA (r.base_id), não a base do operador", () => {
    expect(src).toMatch(/logResult\("outra_base",\s*msg,\s*r\.id,\s*volume\.id,\s*r\.base_id\)/);
  });

  it("volume ausente é classificado como 'inexistente' (inclui efeito de RLS)", () => {
    expect(src).toMatch(/if\s*\(!volume\)[\s\S]{0,400}resultado:\s*"inexistente"/);
  });
});
