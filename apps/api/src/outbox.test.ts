// apps/api/src/outbox.test.ts - Durable delivery: a failed provider leaves a retryable record, a resend
// is a second attempt rather than a second membership, a replay of an accepted delivery doesn't send
// again, a provider that hangs can't hold a request, a pass keeps to its deadline and resumes where it
// stopped, and a message that keeps failing ends visibly. Delivery is at least once: the duplicate
// cases are documented here as tests. Memory table, fake mail.


import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";
import { drainOutbox, outboxOp } from "./outbox.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";


const OP = "pradeep@neon1.tech";
const cfg: Config = { env: "local", publicUrl: "https://example.invalid", operatorEmails: [OP], devAuth: true };
const NEW = "newcomer@example.invalid";


/** A mailer whose next sends to the newcomer fail (or hang) on demand, recording only what went out */
class FlakyMailer extends MemoryMailer {
  failing = 0;
  hang = false;
  attempts = 0;
  override async send(to: string, subject: string, text: string, html: string) {
    if (to !== NEW) return super.send(to, subject, text, html);
    this.attempts++;
    if (this.hang) return new Promise<void>(() => undefined);
    if (this.failing > 0) {
      this.failing--;
      throw Object.assign(new Error("provider down"), { name: "MessageRejected" });
    }
    return super.send(to, subject, text, html);
  }
}


let repo: Repo;
let mailer: FlakyMailer;
let s: Awaited<ReturnType<typeof seed>>;


// Fresh store per test; the clock is real unless a test moves it
beforeEach(async () => {
  repo = new Repo(new MemoryTable());
  s = await seed(repo, OP);
  mailer = new FlakyMailer();
});
afterEach(() => vi.useRealTimers());


/** An app on the shared store, sending inline (as locally) or leaving it to the worker (as in production) */
function appWith(outbox: "inline" | "worker") {
  return createApp({ cfg, repo, directory: new MemoryDirectory(), mailer, texter: new MemoryTexter(), storage: new MemoryStorage(), outbox });
}

/** Call the API as a seeded person */
async function call(app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown, as = s.raj.email) {
  const r = await app.request(`/1NEON/api${path}`, { method, headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}

/** Invite the newcomer to Acme as Raj (an Acme admin) */
function invite(app: ReturnType<typeof createApp>) {
  return call(app, "POST", `/t/${s.acme.id}/members/invite`, { people: [{ email: NEW, access: "viewer" }] });
}

/** The outbox rows waiting for invitations */
async function inviteRows() {
  return (await repo.table.query("OUTBOX")).filter((r) => String(r.SK).startsWith("I#"));
}

/** Run one worker pass with the shared mailer */
function pass() {
  return drainOutbox({ repo, mailer, cfg, sendTimeoutMs: 50 });
}

/** Move the clock forward past the next retry */
function later(ms: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + ms);
}

/** What actually reached the newcomer */
function toNew() {
  return mailer.sent.filter((m) => m.to === NEW);
}

/** The newcomer's membership */
async function newcomer() {
  return (await repo.listMembers(s.acme.id)).filter((m) => m.email === NEW);
}


describe("invitation delivery", () => {
  it("keeps a failed email as a retryable record, then sends it on the next pass", async () => {
    mailer.failing = 1;
    const r = await invite(appWith("inline"));
    expect(r.status).toBe(201);
    expect(toNew()).toHaveLength(0);
    const [row] = await inviteRows();
    expect(row).toMatchObject({ state: "pending", attempts: 1 });
    expect(Date.parse(String(row!.nextAt))).toBeGreaterThan(Date.now());
    expect((await newcomer())[0]!.invite?.state).toBe("queued");
    later(2 * 60_000);
    const result = await pass();
    expect(result.sent).toBe(1);
    expect(toNew()).toHaveLength(1);
    expect(await inviteRows()).toHaveLength(0);
    expect((await newcomer())[0]!.invite?.state).toBe("sent");
  });

  it("marks an email that keeps failing as failed, and a resend is a second attempt with one membership", async () => {
    const app = appWith("inline");
    mailer.failing = 100;
    await invite(app);
    for (let i = 0; i < 6; i++) {
      later(4 * 60 * 60_000);
      await pass();
    }
    const [row] = await inviteRows();
    expect(row).toMatchObject({ state: "failed", attempts: 6 });
    expect(row!.ttl).toBeTypeOf("number");
    expect((await newcomer())[0]!.invite?.state).toBe("failed");
    // A failed invitation can be sent again at once; it goes out, and nobody is added twice
    mailer.failing = 0;
    const again = await call(app, "POST", `/t/${s.acme.id}/members/${(await newcomer())[0]!.userId}/resend`);
    expect(again.status).toBe(200);
    expect(again.json.invite.state).toBe("sent");
    expect(toNew()).toHaveLength(1);
    expect(await newcomer()).toHaveLength(1);
    // Resending a delivered invitation right away is limited
    expect((await call(app, "POST", `/t/${s.acme.id}/members/${(await newcomer())[0]!.userId}/resend`)).status).toBe(429);
  });

  it("answers the invite at once when the worker sends, and a hanging provider only fails that attempt", async () => {
    mailer.hang = true;
    const r = await invite(appWith("worker"));
    expect(r.status).toBe(201);
    expect(mailer.attempts).toBe(0);
    expect(r.json[0].invite.state).toBe("queued");
    const result = await pass();
    // The member.invited notice to the other admins goes out; only the hanging invitation waits
    expect(result).toMatchObject({ processed: 2, retrying: 1 });
    expect((await inviteRows())[0]).toMatchObject({ state: "pending", attempts: 1 });
  });
});


describe("event notices", () => {
  it("doesn't send one person an accepted notice again when a row is replayed", async () => {
    const app = appWith("worker");
    const { p } = await flow();
    const before = mailer.sent.length;
    const r = await call(app, "POST", `/t/${p.tenantId}/projects/${p.id}/items`, { kind: "option", title: "Replay check" }, OP);
    expect(r.status).toBe(201);
    const rows = (await repo.table.query("OUTBOX")).filter((x) => String(x.SK).startsWith("E#"));
    expect(rows).toHaveLength(1);
    const copy = { ...rows[0]! };
    await pass();
    const sent = mailer.sent.length - before;
    expect(sent).toBeGreaterThan(0);
    // The same row comes back (a crash after sending, or a replayed event): nothing goes out again
    await repo.table.write([{ put: copy, guard: { always: true } }]);
    await pass();
    expect(mailer.sent.length - before).toBe(sent);
    expect(new Set(mailer.sent.slice(before).map((m) => m.to)).size).toBe(sent);
  });

  it("opens the invoice itself from a billing notice, and the workspace from any other", async () => {
    const app = appWith("worker");
    const { p } = await flow();
    const made = await call(app, "POST", `/t/${p.tenantId}/projects/${p.id}/invoices`, { type: "progress", lines: [{ text: "Week one", unitCents: 50_000 }] }, OP);
    await call(app, "POST", `/t/${p.tenantId}/projects/${p.id}/invoices/${made.json.id}/issue`, { version: made.json.version }, OP);
    await call(app, "POST", `/t/${p.tenantId}/projects/${p.id}/items`, { kind: "task", title: "Something else" }, OP);
    const before = mailer.sent.length;
    await pass();
    const texts = mailer.sent.slice(before).filter((m) => m.to === s.raj.email).map((m) => m.text);
    const billing = texts.find((t) => t.includes("issued INV-"))!;
    expect(billing).toContain(`See the invoice: https://example.invalid/1NEON/o/${s.acme.slug}/projects/FLOW-1/invoices/${made.json.id}`);
    for (const t of texts.filter((x) => x !== billing)) expect(t).toContain(`Open 1NEON: https://example.invalid/1NEON/o/${s.acme.slug}/workspace`);
  });
});


/** FLOW-1, as seeded */
async function flow() {
  const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
  return { p };
}


// --- Deadline and resume (from the outbox failure review) -------------------------------------------

describe("one deadline per pass", () => {
  /** A synthetic event row whose fan-out reaches `n` joined people, with every lookup answered locally */
  async function bigEvent(n: number, opts: { slowLookups?: number } = {}) {
    const table = new MemoryTable();
    const r = new Repo(table);
    const pause = () => new Promise((ok) => setTimeout(ok, opts.slowLookups ?? 0));
    r.listMembers = async () => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, status: "joined" })) as never;
    r.getUser = async (id: string) => {
      if (opts.slowLookups) await pause();
      return { id, email: `${id}@example.invalid`, name: id } as never;
    };
    r.getTenant = async () => ({ slug: "synthetic", name: "Synthetic" }) as never;
    await table.write([outboxOp("E#big", { kind: "event", event: { id: "big", tenantId: "t", actorId: "actor", action: "option.approved", summary: "Synthetic event" } as never })]);
    return { table, repo: r };
  }

  /** A mailer that takes `ms` per message and records who got one, and how many attempts began */
  function slowMailer(ms: number) {
    const m = { attempts: 0, accepted: [] as string[], aborted: 0, async send(to: string, _s: string, _t: string, _h: string, _r?: string, signal?: AbortSignal) {
      m.attempts++;
      await new Promise<void>((ok, fail) => {
        const t = setTimeout(ok, ms);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          m.aborted++;
          fail(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
      m.accepted.push(to);
    } };
    return m;
  }

  it("stops starting recipients at its deadline, then resumes without resending", async () => {
    const { table, repo: r } = await bigEvent(30);
    const mail = slowMailer(20);
    const started = Date.now();
    const first = await drainOutbox({ repo: r, mailer: mail, cfg, sendTimeoutMs: 1_000 }, { budgetMs: 150, reserveMs: 40 });
    // Within the deadline plus a small bookkeeping allowance, with only some recipients done
    expect(Date.now() - started).toBeLessThan(150 + 100);
    expect(mail.accepted.length).toBeGreaterThan(0);
    expect(mail.accepted.length).toBeLessThan(30);
    expect(first).toMatchObject({ deferred: 1, retrying: 0, failed: 0 });
    // Not counted as a failed attempt, and due again at once
    const [row] = await table.query("OUTBOX");
    expect(row).toMatchObject({ state: "pending", attempts: 0 });
    expect(row!.leaseUntil).toBeUndefined();
    // Later passes finish the rest; every recipient gets exactly one message here
    for (let i = 0; i < 20 && (await table.query("OUTBOX")).length; i++) await drainOutbox({ repo: r, mailer: mail, cfg, sendTimeoutMs: 1_000 }, { budgetMs: 150, reserveMs: 40 });
    expect(await table.query("OUTBOX")).toHaveLength(0);
    expect(mail.accepted).toHaveLength(30);
    expect(new Set(mail.accepted).size).toBe(30);
  });

  it("cuts a provider call short at the deadline and aborts it", async () => {
    const { table, repo: r } = await bigEvent(10);
    const mail = slowMailer(10_000);
    const started = Date.now();
    const out = await drainOutbox({ repo: r, mailer: mail, cfg, sendTimeoutMs: 5_000 }, { budgetMs: 100, reserveMs: 20 });
    expect(Date.now() - started).toBeLessThan(100 + 100);
    expect(mail.attempts).toBe(1);
    expect(mail.aborted).toBe(1);
    expect(out.deferred).toBe(1);
    expect((await table.query("OUTBOX"))[0]).toMatchObject({ state: "pending", attempts: 0 });
  });

  it("stays within its deadline when storage lookups hang", async () => {
    const { repo: r } = await bigEvent(5);
    r.getUser = () => new Promise(() => undefined);
    const started = Date.now();
    const out = await drainOutbox({ repo: r, mailer: slowMailer(1), cfg }, { budgetMs: 80, reserveMs: 20 });
    expect(Date.now() - started).toBeLessThan(80 + 100);
    expect(out.processed).toBe(1);
  });

  it("stays within its deadline when receipt writes hang", async () => {
    const { table, repo: r } = await bigEvent(5);
    const write = table.write.bind(table);
    table.write = async (ops) => (ops.some((o) => "put" in o && o.put.PK === "OUTBOX#DELIVERY") ? new Promise(() => undefined) : write(ops));
    const started = Date.now();
    await drainOutbox({ repo: r, mailer: slowMailer(1), cfg }, { budgetMs: 80, reserveMs: 20 });
    expect(Date.now() - started).toBeLessThan(80 + 100);
  });

  it("documents a possible duplicate when the provider accepted but the receipt write failed", async () => {
    const table = new MemoryTable();
    const r = new Repo(table);
    const sent = new MemoryMailer();
    await table.write([outboxOp("I#synthetic", { kind: "invite", tenantId: "synthetic", userId: "synthetic", email: "nobody@example.invalid", orgName: "Synthetic", inviter: "Synthetic", url: "https://example.invalid" })]);
    const write = table.write.bind(table);
    let failAccepted = true;
    table.write = async (ops) => {
      if (failAccepted && ops.some((o) => "put" in o && o.put.PK === "OUTBOX#DELIVERY" && o.put.state === "accepted")) {
        failAccepted = false;
        throw Object.assign(new Error("synthetic receipt write failure"), { name: "SyntheticStoreFailure" });
      }
      await write(ops);
    };
    const first = await drainOutbox({ repo: r, mailer: sent, cfg });
    // The failure stays visible as a retry, and the receipt shows the send was started
    expect(first).toMatchObject({ sent: 0, retrying: 1 });
    expect((await table.query("OUTBOX#DELIVERY"))[0]).toMatchObject({ state: "submitting" });
    const [row] = await table.query("OUTBOX");
    await table.write([{ put: { ...row!, nextAt: new Date(0).toISOString() }, guard: { always: true } }]);
    const second = await drainOutbox({ repo: r, mailer: sent, cfg });
    // At least once: the retry sends again and says it may be a duplicate
    expect(second).toMatchObject({ sent: 1, possibleDuplicates: 1 });
    expect(sent.sent).toHaveLength(2);
    expect((await table.query("OUTBOX#DELIVERY"))[0]).toMatchObject({ state: "accepted" });
  });

  it("still honors receipts written before the accepted state existed", async () => {
    const table = new MemoryTable();
    const r = new Repo(table);
    const sent = new MemoryMailer();
    await table.write([outboxOp("I#legacy", { kind: "invite", tenantId: "synthetic", userId: "synthetic", email: "nobody@example.invalid", orgName: "Synthetic", inviter: "Synthetic", url: "https://example.invalid" })]);
    await table.write([{ put: { PK: "OUTBOX#DELIVERY", SK: "I#legacy#nobody@example.invalid#email", state: "sent" }, guard: { always: true } }]);
    await drainOutbox({ repo: r, mailer: sent, cfg });
    expect(sent.sent).toHaveLength(0);
    expect(await table.query("OUTBOX")).toHaveLength(0);
  });
});
