// In-memory backend for local dev and tests, mirroring DynamoDB's guard and TTL behavior.
import { ConflictError, type Guard, type Row, type TableStore, type WriteOp } from "./types.ts";

// Composite key; NUL can't appear in our keys, so pairs never collide.
const k = (pk: string, sk: string) => `${pk}\u0000${sk}`;
// Copies in and out, as with a real database, so callers can't mutate stored rows.
const clone = <T>(v: T): T => structuredClone(v);

/** In-memory table with the same semantics as the DynamoDB backend. */
export class MemoryTable implements TableStore {
  private rows = new Map<string, Row>();

  async get(pk: string, sk: string) {
    const r = this.rows.get(k(pk, sk));
    return r && !this.expired(r) ? clone(r) : undefined;
  }

  async query(pk: string, prefix = "", opts: { limit?: number; reverse?: boolean } = {}) {
    let out = [...this.rows.values()]
      .filter((r) => r.PK === pk && r.SK.startsWith(prefix) && !this.expired(r))
      .sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
    if (opts.reverse) out.reverse();
    if (opts.limit) out = out.slice(0, opts.limit);
    return out.map(clone);
  }

  // Indexes are scanned; fine for demo-sized data.
  async queryIndex(index: "GSI1" | "GSI2", pk: string, prefix = "") {
    const P = `${index}PK` as const;
    const S = `${index}SK` as const;
    return [...this.rows.values()]
      .filter((r) => r[P] === pk && String(r[S] ?? "").startsWith(prefix) && !this.expired(r))
      .sort((a, b) => String(a[S]).localeCompare(String(b[S])))
      .map(clone);
  }

  // Check every guard first, then apply every write: the same all-or-nothing rule as a transaction.
  async write(ops: WriteOp[]) {
    for (const op of ops) {
      const key = "put" in op ? op.put : op.delete;
      if (op.guard) this.check(this.rows.get(k(key.PK, key.SK)), op.guard);
    }
    for (const op of ops) {
      if ("put" in op) this.rows.set(k(op.put.PK, op.put.SK), clone(op.put));
      else this.rows.delete(k(op.delete.PK, op.delete.SK));
    }
  }

  async increment(pk: string, sk: string) {
    const r = this.rows.get(k(pk, sk)) ?? { PK: pk, SK: sk, n: 0 };
    const n = Number(r.n ?? 0) + 1;
    this.rows.set(k(pk, sk), { ...r, n });
    return n;
  }

  /** Throw ConflictError when a guard fails, matching DynamoDB's semantics. */
  private check(current: Row | undefined, guard: Guard) {
    const live = current && !this.expired(current) ? current : undefined;
    if ("create" in guard && live) throw new ConflictError(clone(live), "This already exists.");
    if ("version" in guard && live?.version !== guard.version) throw new ConflictError(live && clone(live));
  }

  /** Rows past their TTL count as gone, as in DynamoDB. */
  private expired(r: Row) {
    return typeof r.ttl === "number" && r.ttl * 1000 < Date.now();
  }
}
