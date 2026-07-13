import { describe, it, expect } from "vitest";
import { FakeSupabase } from "./fake-supabase-client";

// Tipo: unitário. Valida o próprio fake. NÃO é evidência do Supabase.
describe("FakeSupabase (smoke)", () => {
  it("filtra por eq e retorna maybeSingle=null quando vazio", async () => {
    const s = new FakeSupabase();
    s.setTable("profiles", [{ id: "u1", base_id: "b1" }]);
    const hit = await s.from("profiles").select().eq("id", "u1").maybeSingle();
    const miss = await s.from("profiles").select().eq("id", "u2").maybeSingle();
    expect(hit.data).toEqual({ id: "u1", base_id: "b1" });
    expect(miss.data).toBeNull();
  });

  it("insert acumula e select conta com count:exact", async () => {
    const s = new FakeSupabase();
    s.setTable("volumes", []);
    await s.from("volumes").insert({ id: "v1", recebido: true });
    await s.from("volumes").insert({ id: "v2", recebido: true });
    const r = await s
      .from("volumes")
      .select("id", { count: "exact", head: true })
      .eq("recebido", true);
    expect(r.count).toBe(2);
  });

  it("nextError é consumido uma única vez", async () => {
    const s = new FakeSupabase();
    s.setTable("recebimentos", [], {
      nextError: { op: "insert", error: { message: "boom" } },
    });
    const bad = await s.from("recebimentos").insert({ x: 1 });
    const good = await s.from("recebimentos").insert({ x: 2 });
    expect((bad as { error: unknown }).error).toEqual({ message: "boom" });
    expect((good as { error: unknown }).error).toBeNull();
  });
});
