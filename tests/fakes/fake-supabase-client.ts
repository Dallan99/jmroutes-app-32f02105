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
  /** Erro forçado na próxima op (consumido uma vez). */
  nextError?: { op: CallLogEntry["op"]; error: { message: string; code?: string } };
  /** Hook chamado após cada op (usado em testes de corrida). */
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
    const state = { op: "select" as CallLogEntry["op"], payload: undefined as unknown };

    const applyFilters = (rows: FakeRow[]) =>
      rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));

    const finalize = <T>(value: T) => {
      self.calls.push({ table, op: state.op, filters: { ...filters }, payload: state.payload });
      const cfg = self.tbl(table);
      if (cfg.nextError && cfg.nextError.op === state.op) {
        const err = cfg.nextError.error;
        cfg.nextError = undefined;
        return Promise.resolve({ data: null, error: err, count: null } as unknown as T);
      }
      cfg.onOp?.(state.op, self);
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
        const cfg = self.tbl(table);
        const arr = Array.isArray(payload) ? payload : [payload];
        cfg.rows.push(...(arr as FakeRow[]));
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
        return builder;
      },
      in(_col: string, _vals: unknown[]) {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        const cfg = self.tbl(table);
        const rows = applyFilters(cfg.rows);
        const row = rows[0] ?? null;
        if (state.op === "update" && row) Object.assign(row, state.payload as FakeRow);
        if (state.op === "delete") {
          cfg.rows = cfg.rows.filter((r) => !rows.includes(r));
          return finalize({ data: null, error: null });
        }
        return finalize({ data: row, error: null });
      },
      single() {
        return builder.maybeSingle();
      },
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        const cfg = self.tbl(table);
        const rows = applyFilters(cfg.rows);
        if (state.op === "update") {
          rows.forEach((r) => Object.assign(r, state.payload as FakeRow));
          return finalize({ data: rows, error: null }).then(onFulfilled, onRejected);
        }
        if (state.op === "delete") {
          cfg.rows = cfg.rows.filter((r) => !rows.includes(r));
          return finalize({ data: null, error: null }).then(onFulfilled, onRejected);
        }
        if (state.op === "insert") {
          return finalize({ data: state.payload, error: null }).then(onFulfilled, onRejected);
        }
        // select simples: retorna array + count quando pedido
        const opts = (builder as any)._selectOpts as { count?: string; head?: boolean } | undefined;
        const count = opts?.count ? rows.length : null;
        return finalize({ data: rows, error: null, count }).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }
}

/** UUIDs fictícios (TST-*) reutilizados em todos os testes. */
export const TST = {
  baseA: "00000000-0000-0000-0000-00000000AAAA",
  baseB: "00000000-0000-0000-0000-00000000BBBB",
  userOp: "00000000-0000-0000-0000-0000000000A1",
  userAdmin: "00000000-0000-0000-0000-0000000000AD",
  rota1: "00000000-0000-0000-0000-0000000R0001",
  volume1: "00000000-0000-0000-0000-0000000V0001",
};