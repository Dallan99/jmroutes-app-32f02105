import { describe, it, expect } from "vitest";
import { FakeSupabase, TST } from "./fake-supabase-client";

// Tipo: unitário. Valida o próprio fake. NÃO é evidência do Supabase.
describe("FakeSupabase (smoke)", () => {
  it("filtra por eq e retorna maybeSingle=null quando vazio", async () => {
    const s = new FakeSupabase();
    s.setTable("profiles", [{ id: "u1", base_id: TST.baseA }]);
    const hit = await s.from("profiles").select().eq("id", "u1").maybeSingle();
    const miss = await s.from("profiles").select().eq("id", "u2").maybeSingle();
    expect(hit.data).toEqual({ id: "u1", base_id: TST.baseA });
    expect(miss.data).toBeNull();
  });

  it("insert acumula e select conta com count:exact", async () => {
    const s = new FakeSupabase();
    s.setTable("volumes", []);
    await s.from("volumes").insert({ id: TST.volume1, recebido: true });
    await s.from("volumes").insert({ id: TST.rota1, recebido: true });
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

// Contrato explícito: quando nextError está armado, a operação NÃO produz
// side-effect nas linhas — insert não adiciona, update não altera, delete
// não remove. O erro é consumido uma única vez.
describe("FakeSupabase — garantias de nextError sem side-effect", () => {
  it("insert com erro não adiciona linha; próximo insert adiciona normalmente", async () => {
    const s = new FakeSupabase();
    s.setTable("recebimentos", [], {
      nextError: { op: "insert", error: { message: "rls" } },
    });
    const bad = await s.from("recebimentos").insert({ id: "x1", ok: false });
    expect((bad as { error: unknown }).error).toEqual({ message: "rls" });
    expect(s.tables["recebimentos"].rows.length).toBe(0);

    const good = await s.from("recebimentos").insert({ id: "x2", ok: true });
    expect((good as { error: unknown }).error).toBeNull();
    expect(s.tables["recebimentos"].rows).toEqual([{ id: "x2", ok: true }]);
  });

  it("update com erro não altera a linha", async () => {
    const s = new FakeSupabase();
    s.setTable("volumes", [{ id: TST.volume1, recebido: false }], {
      nextError: { op: "update", error: { message: "denied" } },
    });
    const resp = await s
      .from("volumes")
      .update({ recebido: true })
      .eq("id", TST.volume1);
    expect((resp as { error: unknown }).error).toEqual({ message: "denied" });
    expect(s.tables["volumes"].rows[0]).toEqual({ id: TST.volume1, recebido: false });

    // sem erro armado, o update passa a valer
    const ok = await s
      .from("volumes")
      .update({ recebido: true })
      .eq("id", TST.volume1);
    expect((ok as { error: unknown }).error).toBeNull();
    expect(s.tables["volumes"].rows[0]).toEqual({ id: TST.volume1, recebido: true });
  });

  it("delete com erro não remove a linha", async () => {
    const s = new FakeSupabase();
    s.setTable("recebimentos", [{ id: "r1" }, { id: "r2" }], {
      nextError: { op: "delete", error: { message: "policy" } },
    });
    const resp = await s.from("recebimentos").delete().eq("id", "r1");
    expect((resp as { error: unknown }).error).toEqual({ message: "policy" });
    expect(s.tables["recebimentos"].rows.length).toBe(2);

    const ok = await s.from("recebimentos").delete().eq("id", "r1");
    expect((ok as { error: unknown }).error).toBeNull();
    expect(s.tables["recebimentos"].rows).toEqual([{ id: "r2" }]);
  });

  it("nextError é consumido apenas pela op correspondente", async () => {
    const s = new FakeSupabase();
    s.setTable("recebimentos", [{ id: "r1" }], {
      nextError: { op: "delete", error: { message: "policy" } },
    });
    // insert não deve consumir o erro armado para delete
    const ins = await s.from("recebimentos").insert({ id: "r2" });
    expect((ins as { error: unknown }).error).toBeNull();
    expect(s.tables["recebimentos"].rows.length).toBe(2);

    // o delete armado ainda está pendente
    const del = await s.from("recebimentos").delete().eq("id", "r1");
    expect((del as { error: unknown }).error).toEqual({ message: "policy" });
    expect(s.tables["recebimentos"].rows.length).toBe(2);
  });
});
