// apps/api/src/outbox.test.ts - Durable delivery: a failed provider leaves a retryable record, a resend
// is a second attempt rather than a second membership, a replay never sends twice, a provider that
// hangs can't hold a request, and a message that keeps failing ends visibly. Memory table, fake mail.


import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";
import { drainOutbox } from "./outbox.ts";
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
  it("never sends one person the same notice twice when a row is replayed", async () => {
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
});


/** FLOW-1, as seeded */
async function flow() {
  const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
  return { p };
}
