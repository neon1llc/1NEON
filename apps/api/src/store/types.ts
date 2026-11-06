// One single-table design, two backends: memory (local dev and tests) and DynamoDB.

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

/** How a put is guarded: create-only, match a version, or (rarely) unconditional. */
export type Guard = { create: true } | { version: number } | { always: true };

export interface TableStore {
  get(pk: string, sk: string): Promise<Row | undefined>;
  /** Rows in one partition whose SK starts with `prefix`, ascending. */
  query(pk: string, prefix?: string, opts?: { limit?: number; reverse?: boolean }): Promise<Row[]>;
  /** Rows in a GSI partition whose sort key starts with `prefix`. */
  queryIndex(index: "GSI1" | "GSI2", pk: string, prefix?: string): Promise<Row[]>;
  /** Writes are all-or-nothing; a failed guard throws ConflictError with the current row. */
  write(ops: WriteOp[]): Promise<void>;
  /** Atomically add 1 to a counter row and return the new value. */
  increment(pk: string, sk: string): Promise<number>;
}

export type WriteOp =
  | { put: Row; guard: Guard }
  | { delete: { PK: string; SK: string }; guard?: Guard };

export class ConflictError extends Error {
  constructor(
    readonly current: Row | undefined,
    message = "This record changed since you opened it.",
  ) {
    super(message);
  }
}
