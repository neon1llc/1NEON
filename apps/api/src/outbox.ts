// apps/api/src/outbox.ts - Durable notification and invitation delivery. Each audit event (and each
// invitation) writes an outbox row in the same transaction as the change itself, so a committed
// change always has its messages queued. A worker outside the request sends them with a time limit,
// counts attempts, retries with backoff, never sends one delivery twice, and keeps failures visible.


import { groupOf, wants, type AuditEvent, type Member, type User } from "@1neon/domain";
import type { Config } from "./config.ts";
import { inviteEmail, noticeEmail } from "./emails.ts";
import type { Mailer, Texter } from "./services.ts";
import { smsReady, smsSendAllowed, textNotice, isOptOut } from "./sms.ts";
import type { Repo } from "./store/repo.ts";
import { ConflictError, type Row, type WriteOp } from "./store/types.ts";


// --- Storage --------------------------------------------------------------

// Every pending outbox row lives in one small partition, read whole by the worker
const OUTBOX = "OUTBOX";
// One row per delivery (outbox row, recipient, channel): its presence with state "sent" stops a resend
const DELIVERY = "OUTBOX#DELIVERY";
// Retry schedule after each failed pass, then the row is marked failed for an operator to look at
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];
// A claimed row is left alone by other workers for this long
const LEASE_MS = 60_000;
// One provider call may take this long before it counts as a failed attempt
const SEND_TIMEOUT_MS = 5_000;
// Failed rows and delivery receipts are kept a month, then expire
const KEEP_S = 30 * 24 * 3600;


/** What an outbox row carries: an audit event to fan out, or one invitation email */
export type OutboxPayload =
  | { kind: "event"; event: AuditEvent }
  | { kind: "invite"; tenantId: string; userId: string; email: string; orgName: string; inviter: string; url: string };


/** The outbox row for a payload, to add to the transaction that makes the change */
export function outboxOp(id: string, payload: OutboxPayload): WriteOp {
  const at = new Date().toISOString();
  return { put: { PK: OUTBOX, SK: id, type: "outbox", state: "pending", payload, createdAt: at, nextAt: at, attempts: 0, version: 1 }, guard: { create: true } };
}


/** Outbox rows for every audit event in a batch of writes (the event's own ID names its row) */
export function outboxForAudit(ops: WriteOp[]): WriteOp[] {
  return ops.flatMap((o) => ("put" in o && o.put.type === "audit" ? [outboxOp(`E#${String(o.put.id)}`, { kind: "event", event: o.put as unknown as AuditEvent })] : []));
}


// --- Worker ---------------------------------------------------------------

/** What the worker needs from outside */
export interface OutboxDeps {
  repo: Repo;
  mailer: Mailer;
  texter?: Texter;
  cfg: Config;
  // Per-call provider time limit; tests shorten it
  sendTimeoutMs?: number;
}


/** One pass's counts, logged without message bodies or addresses */
export interface DrainResult {
  processed: number;
  sent: number;
  retrying: number;
  failed: number;
  pending: number;
  oldestAgeSec: number;
}


/**
 * Send what's due. `ids` limits the pass to rows just written (the inline mode used locally and in
 * tests); without it every due row is considered. Stops starting new rows after `budgetMs` so a pass
 * always ends well inside the Lambda timeout.
 */
export async function drainOutbox(d: OutboxDeps, opts: { ids?: string[]; budgetMs?: number; max?: number } = {}): Promise<DrainResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 9_000;
  const all = await d.repo.table.query(OUTBOX);
  const pending = all.filter((r) => r.state === "pending");
  const due = pending
    .filter((r) => (opts.ids ? opts.ids.includes(r.SK) : Date.parse(String(r.nextAt)) <= Date.now() && !(typeof r.leaseUntil === "string" && Date.parse(r.leaseUntil) > Date.now())))
    .sort((a, b) => String(a.nextAt).localeCompare(String(b.nextAt)))
    .slice(0, opts.max ?? 25);
  const out: DrainResult = { processed: 0, sent: 0, retrying: 0, failed: 0, pending: pending.length, oldestAgeSec: 0 };
  for (const row of due) {
    if (Date.now() - started > budget) break;
    // Claim the row; a worker that loses the race skips it
    const claimed = { ...row, leaseUntil: new Date(Date.now() + LEASE_MS).toISOString(), version: Number(row.version) + 1 };
    try {
      await d.repo.table.write([{ put: claimed, guard: { version: Number(row.version) } }]);
    } catch (e) {
      if (e instanceof ConflictError) continue;
      throw e;
    }
    out.processed++;
    const result = await deliver(d, claimed);
    out.sent += result.sent;
    if (result.open === 0) {
      // Everything sent or given up: the row is done
      await d.repo.table.write([{ delete: { PK: OUTBOX, SK: row.SK }, guard: { version: claimed.version } }]).catch(ignoreConflict);
      continue;
    }
    const attempts = Number(row.attempts ?? 0) + 1;
    const give = attempts > BACKOFF_MS.length;
    if (give) out.failed++;
    else out.retrying++;
    const next: Row = give
      ? { ...claimed, state: "failed", attempts, leaseUntil: undefined, failedAt: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + KEEP_S, version: claimed.version + 1 }
      : { ...claimed, attempts, leaseUntil: undefined, nextAt: new Date(Date.now() + BACKOFF_MS[attempts - 1]!).toISOString(), version: claimed.version + 1 };
    await d.repo.table.write([{ put: next, guard: { version: claimed.version } }]).catch(ignoreConflict);
    if (give) await settleInvite(d, claimed, "failed");
  }
  // Queue health for logs and alarms: how many wait, and how old the oldest is
  const left = (await d.repo.table.query(OUTBOX)).filter((r) => r.state === "pending");
  out.pending = left.length;
  out.oldestAgeSec = left.length ? Math.round((Date.now() - Math.min(...left.map((r) => Date.parse(String(r.createdAt))))) / 1000) : 0;
  return out;
}


/** Try every delivery a row implies; returns how many sent now and how many are still open */
async function deliver(d: OutboxDeps, row: Row): Promise<{ sent: number; open: number }> {
  const payload = row.payload as OutboxPayload;
  const targets = payload.kind === "invite" ? [{ key: payload.email, channel: "email" as const, send: () => sendInvite(d, payload) }] : await eventTargets(d, payload.event);
  let sent = 0;
  let open = 0;
  for (const t of targets) {
    const id = `${row.SK}#${t.key}#${t.channel}`;
    // Sent before (a replay or a retried pass): never again
    if ((await d.repo.table.get(DELIVERY, id))?.state === "sent") continue;
    try {
      await withTimeout(t.send(), d.sendTimeoutMs ?? SEND_TIMEOUT_MS);
      await d.repo.table.write([{ put: { PK: DELIVERY, SK: id, state: "sent", at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + KEEP_S }, guard: { always: true } }]);
      sent++;
    } catch (e) {
      // A carrier opt-out is final for that person: record it instead of retrying
      if (t.channel === "sms" && isOptOut(e)) {
        await t.optedOut?.();
        continue;
      }
      open++;
      console.error(JSON.stringify({ level: "error", message: "outbox delivery failed", channel: t.channel, outbox: row.SK, error: (e as Error).name || "Error" }));
    }
  }
  if (payload.kind === "invite" && open === 0) await settleInvite(d, row, "sent");
  return { sent, open };
}


/** Who should hear about an event, on which channels, decided when the event is sent */
async function eventTargets(d: OutboxDeps, e: AuditEvent) {
  const { repo, cfg } = d;
  const [members, tenant, actor] = await Promise.all([repo.listMembers(e.tenantId), repo.getTenant(e.tenantId), repo.getUser(e.actorId)]);
  const by = actor?.name || actor?.email || "Someone";
  const targets: { key: string; channel: "email" | "sms"; send: () => Promise<void>; optedOut?: () => Promise<void> }[] = [];
  for (const m of members) {
    if (m.status !== "joined" || m.userId === e.actorId) continue;
    const u = await repo.getUser(m.userId);
    if (!u) continue;
    if (wants(u.notify, e.action, "email")) {
      const mail = noticeEmail({ orgName: tenant?.name ?? "1NEON", by, summary: e.summary, url: `${cfg.publicUrl}/1NEON/o/${tenant?.slug ?? ""}/workspace`, important: groupOf(e.action).level === "critical" });
      targets.push({ key: u.id, channel: "email", send: () => d.mailer.send(u.email, mail.subject, mail.text, mail.html) });
    }
    // Texts only to a verified number the person still has, within the budgets, with no project detail
    if (d.texter && smsReady(u) && wants(u.notify, e.action, "sms")) {
      const texter = d.texter;
      targets.push({
        key: u.id,
        channel: "sms",
        send: async () => {
          if (!(await smsSendAllowed(repo, u.id))) throw Object.assign(new Error("text budget reached"), { name: "TextBudget" });
          await texter.send(u.smsPhone!, textNotice(cfg.publicUrl));
        },
        optedOut: () => markOptedOut(repo, u),
      });
    }
  }
  return targets;
}


/** Send one invitation email */
async function sendInvite(d: OutboxDeps, p: Extract<OutboxPayload, { kind: "invite" }>) {
  const mail = inviteEmail({ orgName: p.orgName, inviter: p.inviter, url: p.url });
  await d.mailer.send(p.email, mail.subject, mail.text, mail.html);
}


/** Record an invitation's outcome on the membership, if it is still the latest one queued */
async function settleInvite(d: OutboxDeps, row: Row, state: "sent" | "failed") {
  const p = row.payload as OutboxPayload;
  if (p.kind !== "invite") return;
  for (let tries = 0; tries < 3; tries++) {
    const m = await d.repo.getMember(p.tenantId, p.userId);
    if (!m?.invite || m.invite.queuedAt !== row.createdAt) return;
    const next: Member = { ...m, invite: { ...m.invite, state, sentAt: state === "sent" ? new Date().toISOString() : undefined }, version: m.version + 1 };
    try {
      await d.repo.saveMember(next, { version: m.version });
      return;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
}


/** A STOP from the person's number: consent ends until they agree again */
async function markOptedOut(repo: Repo, u: User) {
  const cur = await repo.getUser(u.id);
  if (!cur) return;
  await repo.saveUser({ ...cur, smsConsentAt: undefined, smsOptedOutAt: new Date().toISOString(), version: cur.version + 1 }, cur.version).catch(ignoreConflict);
}


// --- helpers --------------------------------------------------------------

/** Reject a provider call that runs past `ms`; the provider may still finish, which a retry tolerates */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("send timed out"), { name: "Timeout" })), ms); })]).finally(() => clearTimeout(timer));
}


// A lost race on bookkeeping is fine; the next pass sees the newer row
function ignoreConflict(e: unknown) {
  if (!(e instanceof ConflictError)) throw e;
}
