// apps/api/src/files.ts - A file's way from upload link to ready. The browser's "done" and a once-a-
// minute sweep both settle files here, so a scan that finishes late still makes the file ready
// without another upload, and every outcome (missing bytes, wrong size, threat, scan trouble, a
// provider hiccup) ends in its own state. Downloads stay refused until a trusted clean verdict.


import { fileState, type DocumentRecord, type FileProblem } from "@1neon/domain";
import type { Storage } from "./services.ts";
import type { Repo } from "./store/repo.ts";
import { ConflictError, type WriteOp } from "./store/types.ts";


// --- Watch list -----------------------------------------------------------

// Files not yet settled, one small partition the sweep reads whole; a row goes when its file settles
const WATCH = "DOCWATCH";
// Bytes not seen this long after the link was issued never arrived (links live five minutes)
const ARRIVE_MS = 15 * 60_000;
// A scan still running after this long is treated as stuck
const SCAN_MS = 6 * 60 * 60_000;


/** The watch row for a new file, written with its record */
export function watchOp(x: DocumentRecord): WriteOp {
  return { put: { PK: WATCH, SK: watchKey(x), tenantId: x.tenantId, projectId: x.projectId, id: x.id, ttl: Math.floor(Date.now() / 1000) + 2 * 86_400 }, guard: { always: true } };
}

/** One watch row per file */
function watchKey(x: Pick<DocumentRecord, "tenantId" | "projectId" | "id">) {
  return `${x.tenantId}#${x.projectId ?? "_"}#${x.id}`;
}


// --- Settling -------------------------------------------------------------

/** What settling needs: the store and the bytes */
export interface FileDeps {
  repo: Repo;
  storage: Storage;
}


/**
 * Move one file as far as storage allows and save it. Idempotent: a ready, rejected, or failed file
 * comes back as it is, and a write that loses a race returns whatever the winner saved. Becoming
 * ready writes the record, its audit event, and the "file needed" item it answers in one transaction,
 * so a retry can never check an item off twice or off a file that isn't clean
 */
export async function settleFile(d: FileDeps, x: DocumentRecord, opts: { confirmed?: boolean } = {}): Promise<DocumentRecord> {
  const state = fileState(x);
  if (state === "ready" || state === "rejected" || state === "failed") return x;
  const age = Date.now() - Date.parse(x.createdAt);
  const verdict = await d.storage.scan(x.key);
  // Nothing at the key: still in flight for a while, then never arrived
  if (verdict === "absent") return age > ARRIVE_MS ? finish(d, x, "failed", "missing") : x;
  // Couldn't ask; the next pass tries again
  if (verdict === "error") return x;
  if (verdict === "infected") return finish(d, x, "rejected", undefined, { scan: "infected" });
  if (verdict === "unsupported" || verdict === "failed") return finish(d, x, "failed", verdict === "unsupported" ? "scan_unsupported" : "scan_failed");
  if (verdict === "pending") {
    if (age > SCAN_MS) return finish(d, x, "failed", "timeout");
    // Tagging answered, so the bytes are there and the scan is running: show the file as checking
    return state === "receiving" ? save(d, x, { state: "checking" }) : x;
  }
  // Clean: now the size can be read, and it must match what the link was signed for
  const seen = await d.storage.inspect(x.key);
  if (seen.kind === "present") return seen.size === x.size ? ready(d, x) : finish(d, x, "failed", "size_mismatch", { scan: "clean" });
  if (seen.kind === "absent") return finish(d, x, "failed", "missing");
  // Refused after a clean tag, or a provider problem: keep checking, and leave a trace for us
  console.error(JSON.stringify({ level: "warn", message: "file check deferred", reason: seen.kind === "denied" ? "AccessDenied" : seen.code }));
  return state === "receiving" && opts.confirmed ? save(d, x, { state: "checking" }) : x;
}


/** Ready: the record, the audit event people are notified from, and the item it answers, together */
async function ready(d: FileDeps, x: DocumentRecord) {
  const ts = new Date().toISOString();
  const next: DocumentRecord = { ...x, state: "ready", problem: undefined, scan: "clean", uploaded: true, version: x.version + 1, updatedAt: ts };
  const ops: WriteOp[] = [d.repo.docOp(next, { version: x.version }), d.repo.auditOp({ tenantId: x.tenantId, actorId: x.updatedBy, action: "doc.uploaded", target: x.id, summary: `Uploaded "${x.name}"` }), { delete: { PK: WATCH, SK: watchKey(x) } }];
  const item = x.projectId && x.itemId ? await d.repo.getItem(x.tenantId, x.projectId, x.itemId) : undefined;
  if (item && item.status !== "done") ops.push(d.repo.itemOp({ ...item, status: "done", version: item.version + 1, updatedAt: ts, updatedBy: x.updatedBy }, { version: item.version }));
  return commit(d, x, next, ops);
}


/** A final state other than ready; the watch row goes with it */
function finish(d: FileDeps, x: DocumentRecord, state: "rejected" | "failed", problem?: FileProblem, extra: Partial<DocumentRecord> = {}) {
  const next: DocumentRecord = { ...x, ...extra, state, problem, uploaded: false, version: x.version + 1, updatedAt: new Date().toISOString() };
  return commit(d, x, next, [d.repo.docOp(next, { version: x.version }), { delete: { PK: WATCH, SK: watchKey(x) } }]);
}


/** An in-between change (receiving to checking) */
function save(d: FileDeps, x: DocumentRecord, patch: Partial<DocumentRecord>) {
  const next: DocumentRecord = { ...x, ...patch, version: x.version + 1, updatedAt: new Date().toISOString() };
  return commit(d, x, next, [d.repo.docOp(next, { version: x.version })]);
}


/** Write under the version guard; on a lost race, the record as the winner left it */
async function commit(d: FileDeps, x: DocumentRecord, next: DocumentRecord, ops: WriteOp[]) {
  try {
    await d.repo.table.write(ops);
    return next;
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    return (await d.repo.getDoc(x.tenantId, x.projectId, x.id)) ?? x;
  }
}


// --- Sweep ----------------------------------------------------------------

/** Settle every watched file; called by the scheduled worker. Returns how many changed state */
export async function sweepFiles(d: FileDeps, opts: { max?: number; deadline?: number } = {}): Promise<{ watched: number; settled: number; deferred?: boolean }> {
  const rows = (await d.repo.table.query(WATCH)).slice(0, opts.max ?? 50);
  let settled = 0;
  for (const r of rows) {
    // The scheduled pass shares one deadline with the outbox: stop before it, the next pass carries on
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) return { watched: rows.length, settled, deferred: true };
    const x = await d.repo.getDoc(String(r.tenantId), r.projectId ? String(r.projectId) : undefined, String(r.id));
    // Removed meanwhile: nothing left to watch
    if (!x) {
      await d.repo.table.write([{ delete: { PK: WATCH, SK: String(r.SK) } }]);
      continue;
    }
    const after = await settleFile(d, x);
    if (fileState(after) !== fileState(x)) settled++;
    // A file settled some other way still leaves its row; tidy it
    if (fileState(after) !== "receiving" && fileState(after) !== "checking" && fileState(x) === fileState(after)) await d.repo.table.write([{ delete: { PK: WATCH, SK: String(r.SK) } }]);
  }
  return { watched: rows.length, settled };
}


/** The watch row's key for a file being removed */
export function unwatchOp(x: DocumentRecord): WriteOp {
  return { delete: { PK: WATCH, SK: watchKey(x) } };
}

