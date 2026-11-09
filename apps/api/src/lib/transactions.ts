// apps/api/src/lib/transactions.ts - The notification outbox on every table write: audit events
// bring their outbox rows into the same transaction, then (inline mode) get sent right after.


import type { WriteOp } from "../store/types.ts";
import { drainOutbox, outboxForAudit } from "../outbox.ts";
import type { Deps } from "./kit.ts";


// Each table's own write, before any app wrapped it
const rawWrites = new WeakMap<object, (ops: WriteOp[]) => Promise<void>>();


/**
 * Wrap the table's write so notifications ride on the audit trail, and return the inline sender.
 *
 * Invariant: every write that records audit events also writes their outbox rows in the same
 * transaction, so a committed change always has its messages queued. The worker sends them outside
 * the request; locally, in tests, and in the demo they're sent right after.
 * The raw write is kept once per table, so a second app built on the same table (tests, the demo)
 * replaces the wrapper instead of stacking on it with the first app's stale services
 */
export function installOutbox(d: Deps) {
  const { repo, cfg } = d;
  const write = rawWrites.get(repo.table) ?? repo.table.write.bind(repo.table);
  rawWrites.set(repo.table, write);
  repo.table.write = async (ops) => {
    const queued = outboxForAudit(ops);
    await write([...ops, ...queued]);
    if (queued.length && (d.outbox ?? "inline") === "inline") await drainNow(queued);
  };
  /** Inline mode: send the rows just written; a failure stays queued and is logged, never thrown */
  async function drainNow(queued: WriteOp[]) {
    const ids = queued.flatMap((o) => ("put" in o ? [o.put.SK] : []));
    await drainOutbox({ repo, mailer: d.mailer, texter: d.texter, cfg }, { ids }).catch((e) => console.error(JSON.stringify({ level: "error", message: `outbox: ${(e as Error).name}` })));
  }
  return drainNow;
}
