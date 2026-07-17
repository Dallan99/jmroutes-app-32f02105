/**
 * fake-supabase-client
 *
 * ATENÇÃO — ESCOPO E LIMITES (obrigatório antes de usar):
 *
 * Este stub imita SOMENTE a superfície de chamadas do supabase-js
 * (`from().select()/insert()/update()/delete()/eq()/maybeSingle()/single()`)
 * o suficiente para caracterizar decisões do TypeScript em server functions.
 *
 * O QUE ELE PODE PROVAR:
 *  - Sequência de chamadas realizadas pelo código.
 *  - Como o código trata retornos (linha, null, erro).
 *  - Que o código faz check-then-act sem lock (evidencia RISCO de corrida).
 *  - Que uma linha invisível (efeito deduzido de RLS) resulta em `null`
 *    e o código a classifica como "inexistente".
 *  - Que erros de insert/update são ignorados pelo handler.
 *
 * O QUE ELE NÃO PODE PROVAR:
 *  - RLS real do PostgreSQL.
 *  - Comportamento de SECURITY DEFINER.
 *  - Policies concretas do banco.
 *  - Transações, savepoints, rollback.
 *  - Locks (FOR UPDATE / advisory locks).
 *  - Concorrência real entre conexões distintas.
 *  - Constraints (UNIQUE, FK, CHECK) — só o código PG as impõe.
 *  - Semântica da Data API (PostgREST).
 *  - Performance.
 *
 * SEMÂNTICA DE nextError (contrato):
 *  - Quando `nextError` está configurado e a próxima operação é da op
 *    correspondente, a operação NÃO produz efeito nas linhas: insert não
 *    adiciona, update não altera, delete não remove. O erro retorna em
 *    `error` e é consumido uma única vez.
 *
 * Regra: nunca escrever no fake um comportamento apenas "esperado".
 * Cada tabela e cada retorno modelado abaixo referencia a evidência
 * (arquivo + linhas ou migration) usada para configurá-lo.
 */

export type FakeRow = Record<string, unknown>;

export type CallLogEntry = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters?: Record<string, unknown>;
  payload?: unknown;
};

export type TableConfig = {
  rows: FakeRow[];
  /** Erro forçado na próxima op (consumido uma vez, sem aplicar side-effect). */
  nextError?: { op: CallLogEntry["op"]; error: { message: string; code?: string } };
  /** Hook chamado após cada op bem-sucedida (usado em testes de corrida). */
  onOp?: (op: CallLogEntry["op"], ctx: FakeSupabase) => void;
};

export class FakeSupabase {
  tables: Record<string, TableConfig> = {};
  calls: CallLogEntry[] = [];

  setTable(name: string, rows: FakeRow[], opts: Omit<TableConfig, "rows"> = {}) {
    this.tables[name] = { rows: [...rows], ...opts };
  }

  private tbl(name: string) {
    if (!this.tables[name]) this.tables[name] = { rows: [] };
    return this.tables[name];
  }

  from(table: string) {
    const self = this;
    const filters: Record<string, unknown> = {};
    const preds: Array<(r: FakeRow) => boolean> = [];
    const orders: Array<{ col: string; ascending: boolean }> = [];
    let rangeSel: { from: number; to: number } | null = null;
    const state = { op: "select" as CallLogEntry["op"], payload: undefined as unknown };

    const compareVals = (a: unknown, b: unknown): number => {
      if (typeof a === "number" && typeof b === "number") return a - b;
      const sa = String(a ?? "");
      const sb = String(b ?? "");
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    };

    const applyAll = (rows: FakeRow[]) => {
      let out = rows.filter((r) => preds.every((p) => p(r)));
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const c = compareVals(a[o.col], b[o.col]);
            if (c !== 0) return o.ascending ? c : -c;
          }
          return 0;
        });
      }
      if (rangeSel) out = out.slice(rangeSel.from, rangeSel.to + 1);
      return out;
    };

    const consumeErrorIfArmed = () => {
      const cfg = self.tbl(table);
      if (cfg.nextError && cfg.nextError.op === state.op) {
        const err = cfg.nextError.error;
        cfg.nextError = undefined;
        return { data: null, error: err, count: null };
      }
      return null;
    };

    const finalize = <T>(compute: () => T) => {
      self.calls.push({ table, op: state.op, filters: { ...filters }, payload: state.payload });
      const errResp = consumeErrorIfArmed();
      if (errResp) return Promise.resolve(errResp as unknown as T);
      const value = compute();
      self.tbl(table).onOp?.(state.op, self);
      return Promise.resolve(value);
    };

    const builder: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        state.op = "select";
        (builder as any)._selectOpts = opts;
        return builder;
      },
      insert(payload: unknown) {
        state.op = "insert";
        state.payload = payload;
        return builder;
      },
      update(payload: unknown) {
        state.op = "update";
        state.payload = payload;
        return builder;
      },
      delete() {
        state.op = "delete";
        return builder;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        preds.push((r) => r[col] === val);
        return builder;
      },
      gte(col: string, val: unknown) {
        preds.push((r) => compareVals(r[col], val) >= 0);
        return builder;
      },
      lte(col: string, val: unknown) {
        preds.push((r) => compareVals(r[col], val) <= 0);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        preds.push((r) => vals.includes(r[col]));
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orders.push({ col, ascending: opts?.ascending !== false });
        return builder;
      },
      limit() {
        return builder;
      },
      range(from: number, to: number) {
        rangeSel = { from, to };
        return builder;
      },
      maybeSingle() {
        return finalize(() => {
          const cfg = self.tbl(table);
          if (state.op === "insert") {
            const arr = Array.isArray(state.payload)
              ? (state.payload as FakeRow[])
              : [state.payload as FakeRow];
            cfg.rows.push(...arr);
            return { data: arr[0] ?? null, error: null };
          }
          const rows = applyAll(cfg.rows);
          const row = rows[0] ?? null;
          if (state.op === "update" && row) {
            Object.assign(row, state.payload as FakeRow);
          }
          if (state.op === "delete") {
            cfg.rows = cfg.rows.filter((r) => !rows.includes(r));
            return { data: null, error: null };
          }
          return { data: row, error: null };
        });
      },
      single() {
        return builder.maybeSingle();
      },
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return finalize(() => {
          const cfg = self.tbl(table);
          if (state.op === "insert") {
            const arr = Array.isArray(state.payload)
              ? (state.payload as FakeRow[])
              : [state.payload as FakeRow];
            cfg.rows.push(...arr);
            return { data: state.payload, error: null };
          }
          const rows = applyAll(cfg.rows);
          if (state.op === "update") {
            rows.forEach((r) => Object.assign(r, state.payload as FakeRow));
            return { data: rows, error: null };
          }
          if (state.op === "delete") {
            cfg.rows = cfg.rows.filter((r) => !rows.includes(r));
            return { data: null, error: null };
          }
          const opts = (builder as any)._selectOpts as
            { count?: string; head?: boolean } | undefined;
          const count = opts?.count ? rows.length : null;
          return { data: rows, error: null, count };
        }).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }
}

/**
 * UUIDs fictícios (TST-*) reutilizados em todos os testes.
 * Todos são UUIDs sintéticos, porém sintaticamente VÁLIDOS
 * (apenas caracteres hexadecimais [0-9a-f], nas posições corretas).
 */
export const TST = {
  baseA: "00000000-0000-0000-0000-0000000000aa",
  baseB: "00000000-0000-0000-0000-0000000000bb",
  userOp: "00000000-0000-0000-0000-0000000000a1",
  userAdmin: "00000000-0000-0000-0000-0000000000ad",
  rota1: "00000000-0000-0000-0000-000000000001",
  volume1: "00000000-0000-0000-0000-000000000002",
};
