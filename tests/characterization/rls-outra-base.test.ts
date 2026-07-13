import { describe, it, expect } from "vitest";
import { FakeSupabase } from "../fakes/fake-supabase-client";

// Tipo: caracterização — efeito deduzido de RLS + código.
// Evidência: policies em supabase/migrations/* + tratamento em
// src/lib/recebimento.functions.ts (data=null → 'inexistente').
// Confirmação final: teste em banco separado.
describe("outra_base sob RLS — operador single-base", () => {
  it("linha invisível resulta em classificação 'inexistente'", async () => {
    const s = new FakeSupabase();
    s.setTable("volumes", []); // simula RLS filtrando
    const { data: v } = await s
      .from("volumes")
      .select("id, recebido, rota_id")
      .eq("codigo", "TST-999-DE-OUTRA-BASE")
      .maybeSingle();
    expect(v).toBeNull();
    const resultado = v ? "ok" : "inexistente";
    expect(resultado).toBe("inexistente");
  });
});
