import { describe, it, expect } from "vitest";
import { FakeSupabase } from "../fakes/fake-supabase-client";

// Tipo: caracterização de RISCO com fake em memória.
// NÃO prova lock/transação do PostgreSQL. Comprovação definitiva
// exige integração em banco separado.
describe("bipagem concorrente — risco de check-then-act", () => {
  it("dois handlers leem 'recebido=false' e ambos aplicam update", async () => {
    const s = new FakeSupabase();
    s.setTable("volumes", [
      { id: "v1", codigo: "TST-001", recebido: false, rota_id: "r1" },
    ]);
    s.setTable("recebimentos", []);

    async function biparCaracterizacao() {
      const { data: v } = await s
        .from("volumes")
        .select("id, recebido")
        .eq("codigo", "TST-001")
        .maybeSingle();
      if (!v || (v as { recebido: boolean }).recebido) return "duplicado";
      await s.from("volumes").update({ recebido: true }).eq("id", (v as { id: string }).id);
      await s.from("recebimentos").insert({ volume_id: (v as { id: string }).id, resultado: "ok" });
      return "ok";
    }

    const [a, b] = await Promise.all([biparCaracterizacao(), biparCaracterizacao()]);
    expect([a, b].sort()).toEqual(["ok", "ok"]);
    expect(s.tables["recebimentos"].rows.length).toBe(2);
  });
});
