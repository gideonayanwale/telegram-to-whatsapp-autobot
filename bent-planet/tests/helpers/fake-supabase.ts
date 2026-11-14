/**
 * Minimal in-memory Supabase admin-client fake for route-level tests.
 * Implements the query-builder subset used by the API route handlers and
 * lib code under test (select/insert/update/upsert with filters, counts,
 * single/maybeSingle, order, limit).
 */
import { randomUUID } from "crypto";

export type Row = Record<string, any>;

type FilterOp = "eq" | "neq" | "is" | "not" | "gte" | "lte" | "in";
type Filter = { op: FilterOp; col: string; value: any };

function matches(row: Row, filter: Filter): boolean {
  const actual = row[filter.col];
  switch (filter.op) {
    case "eq":
      return actual === filter.value;
    case "neq":
      return actual !== filter.value;
    case "is":
      return filter.value === null ? actual === null || actual === undefined : actual === filter.value;
    case "not":
      // .not(col, "is", null) => NOT (IS NULL)
      return !matches(row, { op: "is", col: filter.col, value: filter.value });
    case "gte":
      return actual != null && actual >= filter.value;
    case "lte":
      return actual != null && actual <= filter.value;
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(actual);
    default:
      return false;
  }
}

class FakeQuery implements PromiseLike<{ data: any; error: any; count?: number | null }> {
  private mode: "select" | "insert" | "update" | "upsert" = "select";
  private payload: any = null;
  private upsertOnConflict: string | null = null;
  private filters: Filter[] = [];
  private orderBy: { col: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private wantCount = false;
  private headOnly = false;
  private returning = false;
  private singleMode: "single" | "maybe" | null = null;

  constructor(
    private db: FakeSupabase,
    private table: string
  ) {}

  select(_cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.mode !== "select") this.returning = true;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(row: Row) {
    this.mode = "insert";
    this.payload = row;
    return this;
  }

  update(row: Row) {
    this.mode = "update";
    this.payload = row;
    return this;
  }

  upsert(row: Row, opts?: { onConflict?: string }) {
    this.mode = "upsert";
    this.payload = row;
    this.upsertOnConflict = opts?.onConflict ?? "id";
    return this;
  }

  eq(col: string, value: any) {
    this.filters.push({ op: "eq", col, value });
    return this;
  }

  neq(col: string, value: any) {
    this.filters.push({ op: "neq", col, value });
    return this;
  }

  is(col: string, value: any) {
    this.filters.push({ op: "is", col, value });
    return this;
  }

  not(col: string, _op: string, value: any) {
    this.filters.push({ op: "not", col, value });
    return this;
  }

  gte(col: string, value: any) {
    this.filters.push({ op: "gte", col, value });
    return this;
  }

  lte(col: string, value: any) {
    this.filters.push({ op: "lte", col, value });
    return this;
  }

  in(col: string, value: any[]) {
    this.filters.push({ op: "in", col, value });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, ascending: opts?.ascending !== false };
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  then<TResult1 = { data: any; error: any; count?: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): { data: any; error: any; count?: number | null } {
    const rows = this.db.table(this.table);

    if (this.mode === "select") {
      let matched = rows.filter((r) => this.filters.every((f) => matches(r, f)));
      const count = matched.length;
      if (this.wantCount) {
        return { data: this.headOnly ? null : matched.map((r) => ({ ...r })), error: null, count };
      }
      if (this.orderBy) {
        const { col, ascending } = this.orderBy;
        matched = [...matched].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === bv) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av > bv ? 1 : -1) * (ascending ? 1 : -1);
        });
      }
      if (this.limitN != null) matched = matched.slice(0, this.limitN);
      return this.wrapRows(matched);
    }

    if (this.mode === "insert") {
      const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...this.payload };
      rows.push(row);
      return this.returning ? this.wrapRows([row]) : { data: null, error: null };
    }

    if (this.mode === "update") {
      const matched = rows.filter((r) => this.filters.every((f) => matches(r, f)));
      for (const r of matched) Object.assign(r, this.payload);
      return this.returning ? this.wrapRows(matched) : { data: null, error: null };
    }

    if (this.mode === "upsert") {
      const conflictCols = this.upsertOnConflict!.split(",").map((c) => c.trim());
      const existing = rows.find((r) => conflictCols.every((c) => r[c] === this.payload[c]));
      if (existing) {
        Object.assign(existing, this.payload);
        return this.returning ? this.wrapRows([existing]) : { data: null, error: null };
      }
      const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...this.payload };
      rows.push(row);
      return this.returning ? this.wrapRows([row]) : { data: null, error: null };
    }

    return { data: null, error: { message: "unsupported mode" } };
  }

  private wrapRows(matched: Row[]): { data: any; error: any } {
    const cloned = matched.map((r) => ({ ...r }));
    if (this.singleMode === "single") {
      if (cloned.length !== 1) {
        return { data: null, error: { message: `expected a single row, got ${cloned.length}` } };
      }
      return { data: cloned[0], error: null };
    }
    if (this.singleMode === "maybe") {
      return { data: cloned[0] ?? null, error: null };
    }
    return { data: cloned, error: null };
  }
}

export class FakeSupabase {
  private tables = new Map<string, Row[]>();

  table(name: string): Row[] {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }

  seed(name: string, rows: Row[]) {
    this.tables.set(name, rows.map((r) => ({ ...r })));
  }

  rows(name: string): Row[] {
    return this.table(name);
  }

  reset() {
    this.tables.clear();
  }

  from(name: string): FakeQuery {
    return new FakeQuery(this, name);
  }
}
