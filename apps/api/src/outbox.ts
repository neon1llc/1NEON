// apps/api/src/outbox.ts - Durable notification and invitation delivery. Each audit event (and each
// invitation) writes an outbox row in the same transaction as the change itself, so a committed
// change always has its messages queued. A worker outside the request sends them within one
// absolute deadline, counts attempts, retries with backoff, and keeps failures visible.
//
// Delivery is at least once. A per-recipient receipt stops a resend once a provider has accepted a
// message and the receipt is saved, but a provider can accept a message and the receipt write can
// still fail, or a send can time out here and be accepted later; the next pass then sends again.
// "Accepted" means the provider took the message; it is not proof that it was delivered.


import { actorHears, groupOf, isOwnOrg, isQuickFix, neon1Only, noticeSummary, wants, type AuditEvent, type Member, type User } from "@1neon/domain";
import type { Config } from "./config.ts";
import { inviteEmail, noticeEmail } from "./emails.ts";
import type { Mailer, Texter } from "./services.ts";
import { smsReady, smsSendAllowed, textNotice, isOptOut } from "./sms.ts";
import type { Repo } from "./store/repo.ts";
import { ConflictError, type Row, type WriteOp } from "./store/types.ts";


// --- Storage --------------------------------------------------------------

// Every pending outbox row lives in one small partition, read whole by the worker
const OUTBOX = "OUTBOX";
// One receipt per delivery (outbox row, recipient, channel). States: "submitting" is written just
// before the provider call, "accepted" once the provider took it ("sent" in receipts from before this
// distinction means the same). An accepted receipt stops a resend; a submitting one left by an earlier
// pass means the outcome is unknown, and the resend is logged as a possible duplicate
const DELIVERY = "OUTBOX#DELIVERY";
// Retry schedule after each failed pass, then the row is marked failed for an operator to look at
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];
// A claimed row is left alone by other workers for this long
const LEASE_MS = 60_000;
// One provider call may take this long before it counts as a failed attempt
const SEND_TIMEOUT_MS = 5_000;
// Failed rows and delivery receipts are kept a month, then expire
const KEEP_S = 30 * 24 * 3600;
// Time kept back from the deadline for saving progress; no new recipient starts inside it
const RESERVE_MS = 1_000;


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


/**
 * One pass's clock. `deadline` is absolute (epoch ms): every storage call and provider call is cut
 * off there. `soft` is the deadline less the bookkeeping reserve: nothing new starts after it
 */
interface Clock {
  deadline: number;
  soft: number;
}


/** The deadline passed while waiting on storage or a provider; the pass stops where it is */
export class DeadlineError extends Error {
  override name = "Deadline";
}


/** One pass's counts, logged without message bodies or addresses */
export interface DrainResult {
  processed: number;
  sent: number;
  retrying: number;
  failed: number;
  pending: number;
  oldestAgeSec: number;
  // Rows left part-way at the deadline, to resume on the next pass without counting a failed attempt
  deferred: number;
  // Resends where an earlier pass started the same delivery and its outcome is unknown
  possibleDuplicates: number;
}


/**
 * Send what's due. `ids` limits the pass to rows just written (the inline mode used locally and in
 * tests); without it every due row is considered. One absolute deadline (`deadline`, or now plus
 * `budgetMs`) bounds the whole pass: the outbox read, target lookups, receipts, and each provider
 * call. No new row or recipient starts within `reserveMs` of it, so progress can still be saved; a
 * row cut short keeps its receipts and resumes on the next pass.
 */
export async function drainOutbox(d: OutboxDeps, opts: { ids?: string[]; budgetMs?: number; deadline?: number; reserveMs?: number; max?: number } = {}): Promise<DrainResult> {
  const deadline = opts.deadline ?? Date.now() + (opts.budgetMs ?? 9_000);
  const clock: Clock = { deadline, soft: deadline - (opts.reserveMs ?? RESERVE_MS) };
  const io = <T>(p: Promise<T>) => beforeDeadline(p, clock.deadline);
  const all = await io(d.repo.table.query(OUTBOX));
  const pending = all.filter((r) => r.state === "pending");
  const due = pending
    .filter((r) => (opts.ids ? opts.ids.includes(r.SK) : Date.parse(String(r.nextAt)) <= Date.now() && !(typeof r.leaseUntil === "string" && Date.parse(r.leaseUntil) > Date.now())))
    .sort((a, b) => String(a.nextAt).localeCompare(String(b.nextAt)))
    .slice(0, opts.max ?? 25);
  const out: DrainResult = { processed: 0, sent: 0, retrying: 0, failed: 0, pending: pending.length, oldestAgeSec: ageOf(pending), deferred: 0, possibleDuplicates: 0 };
  try {
    for (const row of due) {
      if (Date.now() >= clock.soft) break;
      // Claim the row; a worker that loses the race skips it
      const claimed = { ...row, leaseUntil: new Date(Date.now() + LEASE_MS).toISOString(), version: Number(row.version) + 1 };
      try {
        await io(d.repo.table.write([{ put: claimed, guard: { version: Number(row.version) } }]));
      } catch (e) {
        if (e instanceof ConflictError) continue;
        throw e;
      }
      out.processed++;
      const result = await deliver(d, claimed, clock);
      out.sent += result.sent;
      out.possibleDuplicates += result.ambiguous;
      if (result.open === 0 && result.deferred === 0) {
        // Everything accepted or given up: the row is done
        await io(d.repo.table.write([{ delete: { PK: OUTBOX, SK: row.SK }, guard: { version: claimed.version } }])).catch(ignoreConflict);
        continue;
      }
      if (result.open === 0) {
        // Cut short by the deadline, not by a failure: release it for the next pass, attempts unchanged
        out.deferred++;
        await io(d.repo.table.write([{ put: { ...claimed, leaseUntil: undefined, nextAt: new Date().toISOString(), version: claimed.version + 1 }, guard: { version: claimed.version } }])).catch(ignoreConflict);
        continue;
      }
      const attempts = Number(row.attempts ?? 0) + 1;
      const give = attempts > BACKOFF_MS.length;
      if (give) out.failed++;
      else out.retrying++;
      const next: Row = give
        ? { ...claimed, state: "failed", attempts, leaseUntil: undefined, failedAt: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + KEEP_S, version: claimed.version + 1 }
        : { ...claimed, attempts, leaseUntil: undefined, nextAt: new Date(Date.now() + BACKOFF_MS[attempts - 1]!).toISOString(), version: claimed.version + 1 };
      await io(d.repo.table.write([{ put: next, guard: { version: claimed.version } }])).catch(ignoreConflict);
      if (give) await settleInvite(d, claimed, "failed", clock);
    }
  } catch (e) {
    // Storage or a provider hung past the deadline: stop here. A claimed row's lease runs out and the
    // next pass picks it up; receipts already saved keep their recipients from a resend
    if (!(e instanceof DeadlineError)) throw e;
    console.error(JSON.stringify({ level: "error", message: "outbox pass hit its deadline" }));
    return out;
  }
  // Queue health for logs and alarms: how many wait, and how old the oldest is. Read again only when
  // there's time; otherwise the counts from the start of the pass stand
  if (Date.now() < clock.soft) {
    const left = (await io(d.repo.table.query(OUTBOX)).catch(() => undefined))?.filter((r) => r.state === "pending");
    if (left) {
      out.pending = left.length;
      out.oldestAgeSec = ageOf(left);
    }
  }
  return out;
}


/** Age in seconds of the oldest row in a list, or zero */
function ageOf(rows: Row[]) {
  return rows.length ? Math.round((Date.now() - Math.min(...rows.map((r) => Date.parse(String(r.createdAt))))) / 1000) : 0;
}


/** One recipient on one channel; `send` takes an abort signal the provider call should honor */
interface Target {
  key: string;
  channel: "email" | "sms";
  send: (signal: AbortSignal) => Promise<void>;
  optedOut?: () => Promise<void>;
}


/**
 * Try every delivery a row implies, in order, until the clock's soft limit. Returns how many were
 * accepted now, how many failed (open), how many weren't started for lack of time (deferred), and how
 * many were resends of a delivery whose earlier outcome is unknown (ambiguous)
 */
async function deliver(d: OutboxDeps, row: Row, clock: Clock): Promise<{ sent: number; open: number; deferred: number; ambiguous: number }> {
  const io = <T>(p: Promise<T>) => beforeDeadline(p, clock.deadline);
  const payload = row.payload as OutboxPayload;
  const targets: Target[] = payload.kind === "invite" ? [{ key: payload.email, channel: "email", send: (signal) => sendInvite(d, payload, signal) }] : await eventTargets(d, payload.event, clock);
  let sent = 0;
  let open = 0;
  let deferred = 0;
  let ambiguous = 0;
  for (const [i, t] of targets.entries()) {
    // Not enough time left to send and record one more: leave the rest for the next pass
    const room = clock.soft - Date.now();
    if (room <= 0) {
      deferred = targets.length - i;
      break;
    }
    const id = `${row.SK}#${t.key}#${t.channel}`;
    const receipt = await io(d.repo.table.get(DELIVERY, id));
    // Accepted before (a replay or a resumed pass): not again
    if (receipt?.state === "accepted" || receipt?.state === "sent") continue;
    // Started before with no recorded outcome: the provider may have taken it, so this may duplicate
    if (receipt?.state === "submitting") ambiguous++;
    const ttl = Math.floor(Date.now() / 1000) + KEEP_S;
    const limit = d.sendTimeoutMs ?? SEND_TIMEOUT_MS;
    // The call gets its normal limit, or less when the deadline is closer
    const cut = room < limit;
    try {
      await io(d.repo.table.write([{ put: { PK: DELIVERY, SK: id, state: "submitting", at: new Date().toISOString(), ttl }, guard: { always: true } }]));
      await bounded((signal) => t.send(signal), cut ? room : limit);
      await io(d.repo.table.write([{ put: { PK: DELIVERY, SK: id, state: "accepted", at: new Date().toISOString(), ttl }, guard: { always: true } }]));
      sent++;
    } catch (e) {
      if (e instanceof DeadlineError) throw e;
      // Timed out only because the pass ran short: not a provider failure. Its receipt stays
      // "submitting", so the resumed pass logs the resend as a possible duplicate
      if (cut && (e as Error).name === "Timeout") {
        deferred = targets.length - i;
        break;
      }
      // A carrier opt-out is final for that person: record it instead of retrying
      if (t.channel === "sms" && isOptOut(e)) {
        await io(t.optedOut?.() ?? Promise.resolve());
        continue;
      }
      open++;
      console.error(JSON.stringify({ level: "error", message: "outbox delivery failed", channel: t.channel, outbox: row.SK, error: (e as Error).name || "Error" }));
    }
  }
  if (payload.kind === "invite" && open === 0 && deferred === 0) await settleInvite(d, row, "sent", clock);
  return { sent, open, deferred, ambiguous };
}


/** Who should hear about an event, on which channels, decided when the event is sent; every lookup
 * is bounded by the pass's deadline */
async function eventTargets(d: OutboxDeps, e: AuditEvent, clock: Clock): Promise<Target[]> {
  const { repo, cfg } = d;
  const io = <T>(p: Promise<T>) => beforeDeadline(p, clock.deadline);
  const [members, tenant, actor] = await io(Promise.all([repo.listMembers(e.tenantId), repo.getTenant(e.tenantId), repo.getUser(e.actorId)]));
  // Stripe's own events (a payment started, received, or failed) have no person behind them
  const by = e.actorId === "stripe" ? "The payment page (Stripe)" : actor?.name || actor?.email || "Someone";
  // A notice about an invoice or a payment opens that invoice, so its lines and Pay are one tap away.
  // Billing summaries begin with the project's key ("FLOW-1: ..."), and their target is the invoice
  const home = `${cfg.publicUrl}/1NEON/o/${tenant?.slug ?? ""}`;
  const key = /^([A-Z][A-Z0-9]*-\d+): /.exec(e.summary)?.[1];
  const invoiceUrl = key && (e.action.startsWith("invoice.") || e.action.startsWith("payment.")) ? `${home}/projects/${key}/invoices/${e.target}` : undefined;
  // A quick fix's notices about its proposal revisions say "Quote"; the stored summary is unchanged
  const quick = key && e.action.startsWith("proposal.") ? (await io(repo.listProjects(e.tenantId))).some((p) => p.key === key && isQuickFix(p)) : false;
  const summary = noticeSummary(e.summary, quick);
  const targets: Target[] = [];
  // The one who acted hears only of what they signed (a copy for their records), or, in neon1's own
  // organization, the billing a client would hear of
  const selfToo = actorHears(e.action, isOwnOrg(tenant?.slug ?? ""));
  for (const m of members) {
    if (m.status !== "joined" || (m.userId === e.actorId && !selfToo)) continue;
    const u = await io(repo.getUser(m.userId));
    if (!u) continue;
    // neon1's working drafts reach neon1 only
    if (neon1Only(e.action) && !cfg.operatorEmails.includes(u.email)) continue;
    if (wants(u.notify, e.action, "email")) {
      const mail = noticeEmail({ orgName: tenant?.name ?? "1NEON", by: m.userId === e.actorId ? "You" : by, summary, url: invoiceUrl ?? `${home}/workspace`, button: invoiceUrl ? "See the invoice" : undefined, important: groupOf(e.action).level === "critical" });
      targets.push({ key: u.id, channel: "email", send: (signal) => d.mailer.send(u.email, mail.subject, mail.text, mail.html, undefined, signal) });
    }
    // Texts only to a verified number the person still has, within the budgets, with no project detail
    if (d.texter && smsReady(u) && wants(u.notify, e.action, "sms")) {
      const texter = d.texter;
      targets.push({
        key: u.id,
        channel: "sms",
        send: async (signal) => {
          if (!(await smsSendAllowed(repo, u.id))) throw Object.assign(new Error("text budget reached"), { name: "TextBudget" });
          await texter.send(u.smsPhone!, textNotice(cfg.publicUrl), signal);
        },
        optedOut: () => markOptedOut(repo, u),
      });
    }
  }
  return targets;
}


/** Send one invitation email */
async function sendInvite(d: OutboxDeps, p: Extract<OutboxPayload, { kind: "invite" }>, signal?: AbortSignal) {
  const mail = inviteEmail({ orgName: p.orgName, inviter: p.inviter, url: p.url });
  await d.mailer.send(p.email, mail.subject, mail.text, mail.html, undefined, signal);
}


/** Record an invitation's outcome on the membership, if it is still the latest one queued */
async function settleInvite(d: OutboxDeps, row: Row, state: "sent" | "failed", clock: Clock) {
  const p = row.payload as OutboxPayload;
  if (p.kind !== "invite") return;
  for (let tries = 0; tries < 3; tries++) {
    const m = await beforeDeadline(d.repo.getMember(p.tenantId, p.userId), clock.deadline);
    if (!m?.invite || m.invite.queuedAt !== row.createdAt) return;
    const next: Member = { ...m, invite: { ...m.invite, state, sentAt: state === "sent" ? new Date().toISOString() : undefined }, version: m.version + 1 };
    try {
      await beforeDeadline(d.repo.saveMember(next, { version: m.version }), clock.deadline);
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


/**
 * Run a provider call with an abort signal that fires after `ms`, and reject at that point either
 * way. SDK clients that honor the signal cancel the request; one that ignores it may still be
 * accepted later, which is why delivery is at least once
 */
export function bounded<T>(call: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  // A provider that rejects because of our abort reports it as our timeout, whatever it calls it
  const p = call(ctl.signal).catch((e) => {
    throw ctl.signal.aborted ? Object.assign(new Error("send timed out"), { name: "Timeout" }) : e;
  });
  return withTimeout(p, ms).finally(() => clearTimeout(timer));
}


/** Reject with DeadlineError if `p` hasn't settled by the absolute time `deadline` (epoch ms) */
export function beforeDeadline<T>(p: Promise<T>, deadline: number): Promise<T> {
  const ms = deadline - Date.now();
  if (ms <= 0) {
    p.catch(() => undefined);
    return Promise.reject(new DeadlineError("deadline passed"));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new DeadlineError("deadline passed")), ms); })]).finally(() => clearTimeout(timer));
}


// A lost race on bookkeeping is fine; the next pass sees the newer row
function ignoreConflict(e: unknown) {
  if (!(e instanceof ConflictError)) throw e;
}
