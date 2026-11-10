// apps/api/src/store/types.ts - One single-table design, two backends: memory (local dev and tests)
// and DynamoDB.


/** A stored item: keys, optional index keys, optional TTL (epoch seconds), and the record's fields */
export interface Row {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  ttl?: number;
  version?: number;
  [k: string]: unknown;
}


/**
 * How a put is guarded: create-only, match a version, or (rarely) unconditional. A version guard may
 * also name the row's `id`, so a write meant for one short-lived record (such as one texted code)
 * can never land on a newer record that happens to reuse the same version number
 */
export type Guard = { create: true } | { version: number; id?: string } | { always: true };


/** The storage operations the repository needs, nothing more */
export interface TableStore {
  // One row by its full key, or undefined if missing or expired
  get(pk: string, sk: string): Promise<Row | undefined>;
  /** Rows in one partition whose SK starts with `prefix`, ascending */
  query(pk: string, prefix?: string, opts?: { limit?: number; reverse?: boolean }): Promise<Row[]>;
  /** Rows in a GSI partition whose sort key starts with `prefix` */
  queryIndex(index: "GSI1" | "GSI2", pk: string, prefix?: string): Promise<Row[]>;
  /** Writes are all-or-nothing; a failed guard throws ConflictError with the current row */
  write(ops: WriteOp[]): Promise<void>;
  /** Atomically add 1 to a counter row and return the new value */
  increment(pk: string, sk: string): Promise<number>;
}


/** One write inside an all-or-nothing batch */
export type WriteOp =
  | { put: Row; guard: Guard }
  | { delete: { PK: string; SK: string }; guard?: Guard };


/** A guard failed: someone else saved first, or the record already exists. `current` is for the
 * server's own use; what reaches a browser is decided by the API's public conflict policy */
export class ConflictError extends Error {
  constructor(
    readonly current: Row | undefined,
    message = "This record changed since you opened it.",
  ) {
    super(message);
  }
}


/** The table was too busy or the transaction collided with another one; nothing was written, and
 * trying again shortly is safe. Kept apart from ConflictError so it never reads as an edit conflict */
export class StoreBusyError extends Error {
  constructor(readonly reason: string) {
    super("The database is busy. Try again in a moment.");
  }
}
