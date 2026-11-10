// apps/api/src/security.test.ts - Sign-in method lifecycle and conflict responses, run with production
// authentication (devAuth off) against synthetic sessions, the memory table, and fake providers. No
// network, real accounts, mail, or texts. Secrets are compared, never printed.


import { beforeEach, describe, expect, it } from "vitest";
import { TOTP, Secret } from "otpauth";
import { DynamoDBClient, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { createApp } from "./app.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { DynamoTable } from "./store/dynamo.ts";
import { Repo } from "./store/repo.ts";
import { ConflictError, StoreBusyError } from "./store/types.ts";
import { checkTotp } from "./totp.ts";


// A synthetic base32 seed; never a real person's
const SEED = "JBSWY3DPEHPK3PXP";
const OP = "pradeep@neon1.tech";

let repo: Repo;
let table: MemoryTable;
let directory: MemoryDirectory;
let mailer: MemoryMailer;
let texter: MemoryTexter;
let app: ReturnType<typeof createApp>;
let s: Awaited<ReturnType<typeof seed>>;


/** A code an authenticator app would show for `secret`, `offset` time steps from now */
const codeFor = (secret: string, offset = 0) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: Date.now() + offset * 30_000 });
/** A six-digit code that is wrong for `secret` right now */
const wrongFor = (secret: string) => (checkTotp(secret, "000000") === undefined ? "000000" : "999999");


// Each test: fresh store and seed, and a stand-in for Cognito that maps a session header to a token
// family (origin_jti). Sign-in by email code is weak; by passkey is strong, as in production
beforeEach(async () => {
  table = new MemoryTable();
  repo = new Repo(table);
  s = await seed(repo, OP);
  directory = new MemoryDirectory();
  mailer = new MemoryMailer();
  texter = new MemoryTexter();
  const auth = {
    identify: async (c: { req: { header(n: string): string | undefined } }) => {
      const session = c.req.header("x-test-session");
      return session ? { sub: `sub-${c.req.header("x-test-user")}`, jti: session } : undefined;
    },
    start: async (c: { req: { header(n: string): string | undefined } }, email: string) => ({
      next: { step: "done" },
      verified: { sub: `sub-${email}`, jti: c.req.header("x-test-session"), email, emailVerified: true, method: c.req.header("x-test-method") ?? "code", accessToken: "synthetic-access-token" },
    }),
    logout: async () => "/1NEON/",
    accessToken: () => "synthetic-access-token",
  };
  app = createApp({
    cfg: { env: "local", publicUrl: "https://example.invalid", operatorEmails: [OP], devAuth: false },
    repo,
    directory,
    mailer,
    texter,
    storage: new MemoryStorage(),
    auth: auth as never,
  });
});


/** Call the API in one synthetic session of one person */
async function call(session: { email: string; jti: string; method?: string }, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-1neon": "1", "x-test-session": session.jti, "x-test-user": session.email };
  if (session.method) headers["x-test-method"] = session.method;
  const r = await app.request(`/1NEON/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, text, json: text ? JSON.parse(text) : undefined };
}

/** Sign in by email code (weak) or passkey (strong) in a new session */
async function signIn(email: string, jti: string, method: "code" | "passkey" = "code") {
  const sess = { email, jti, method };
  const r = await call(sess, "POST", "/auth/step", { op: "start", email });
  expect(r.json.step).toBe("done");
  return { email, jti };
}

/** Give a seeded person a confirmed app authenticator with the synthetic seed */
async function enrollTotp(uid: string) {
  await repo.saveTotp(uid, { secret: SEED, confirmed: true, lastCounter: -1, fails: 0, version: 1 }, { create: true });
}


// PORT-01: no response ever carries an authenticator seed, link, QR, or the stored record
describe("conflict responses", () => {
  it("answers two simultaneous wrong codes without the authenticator record", async () => {
    await enrollTotp(s.raj.id);
    const raj = await signIn(s.raj.email, "j-weak");
    const replies = await Promise.all(Array.from({ length: 6 }, () => call(raj, "POST", "/me/confirm", { code: wrongFor(SEED) })));
    for (const r of replies) {
      expect(r.text).not.toContain(SEED);
      expect(r.json.current).toBeUndefined();
      expect([400, 429]).toContain(r.status);
    }
    // Every verdict was counted: six wrong tries lock the authenticator
    expect((await repo.getTotp(s.raj.id))!.lockedUntil).toBeDefined();
    expect(await repo.sessionStrong("j-weak", s.raj.id)).toBe(false);
  });

  it("answers concurrent replays and setup confirmations without secrets", async () => {
    await enrollTotp(s.raj.id);
    const raj = await signIn(s.raj.email, "j-strong", "passkey");
    const code = codeFor(SEED, 1);
    const both = await Promise.all([call(raj, "POST", "/me/confirm", { code }), call(raj, "POST", "/me/confirm", { code })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
    for (const r of both) expect(r.text).not.toContain(SEED);
    // Two confirmations of one setup: one wins, neither reply carries the new secret
    const start = await call(raj, "POST", "/me/totp/start", {});
    expect(start.status).toBe(200);
    const fresh = start.json.secret as string;
    const confirms = await Promise.all([call(raj, "POST", "/me/totp/confirm", { code: codeFor(fresh) }), call(raj, "POST", "/me/totp/confirm", { code: codeFor(fresh) })]);
    expect(confirms.map((r) => r.status).sort()).toEqual([200, 409]);
    for (const r of confirms) {
      expect(r.text).not.toContain(fresh);
      expect(r.json.current).toBeUndefined();
    }
  });

  it("still returns the newer project for the edit conflict dialog, with only its own fields", async () => {
    const raj = await signIn(s.raj.email, "j-raj");
    const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
    expect((await call(raj, "PATCH", `/t/${s.acme.id}/projects/${p.id}`, { version: p.version, summary: "First" })).status).toBe(200);
    const stale = await call(raj, "PATCH", `/t/${s.acme.id}/projects/${p.id}`, { version: p.version, summary: "Second" });
    expect(stale.status).toBe(409);
    expect(stale.json.current.summary).toBe("First");
    expect(Object.keys(stale.json.current)).not.toEqual(expect.arrayContaining(["PK", "SK", "GSI2PK", "type"]));
  });

  it("never projects a row of a kind outside the public policy", async () => {
    // A conflict raised on a security row (no public kind) answers without `current`
    const conflictApp = createApp({ cfg: { env: "local", publicUrl: "https://example.invalid", operatorEmails: [OP], devAuth: true }, repo, directory, mailer, storage: new MemoryStorage() });
    conflictApp.get("/__boom", () => {
      throw new ConflictError({ PK: "USER#u", SK: "TOTP", secret: SEED, confirmed: true, version: 3 });
    });
    const r = await conflictApp.request("/1NEON/api/__boom", { headers: { "x-dev-user": OP } });
    const text = await r.text();
    expect(r.status).toBe(409);
    expect(text).not.toContain(SEED);
    expect(JSON.parse(text).current).toBeUndefined();
  });

  it("tells a busy table apart from an edit conflict", async () => {
    // DynamoDB cancels a transaction for a collision without any guard failing
    const client = new DynamoDBClient({ region: "us-east-1", credentials: { accessKeyId: "x", secretAccessKey: "x" } });
    client.middlewareStack.add(() => async () => {
      throw new TransactionCanceledException({ $metadata: {}, message: "cancelled", CancellationReasons: [{ Code: "None" }, { Code: "TransactionConflict" }] });
    }, { step: "initialize" });
    const dynamo = new DynamoTable("synthetic", client);
    await expect(dynamo.write([{ put: { PK: "a", SK: "b" }, guard: { always: true } }, { put: { PK: "c", SK: "d" }, guard: { always: true } }])).rejects.toBeInstanceOf(StoreBusyError);
    const busyApp = createApp({ cfg: { env: "local", publicUrl: "https://example.invalid", operatorEmails: [OP], devAuth: true }, repo, directory, mailer, storage: new MemoryStorage() });
    busyApp.get("/__busy", () => {
      throw new StoreBusyError("TransactionConflict");
    });
    const r = await busyApp.request("/1NEON/api/__busy", { headers: { "x-dev-user": OP } });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("busy");
  });
});


// PORT-02: enrollment (what the account has) is kept apart from assurance (what this session proved)
describe("sign-in method lifecycle", () => {
  it("keeps a confirmed app authenticator enrolled after an email sign-in, and refuses replacing it from that session", async () => {
    await enrollTotp(s.raj.id);
    const raj = await signIn(s.raj.email, "j-email");
    const me = await call(raj, "GET", "/me");
    expect(me.json.factors.totp).toBe(true);
    expect(me.json.factors.any).toBe(true);
    expect(me.json.strongSession).toBe(false);
    expect((await call(raj, "POST", "/me/totp/start", {})).status).toBe(403);
    expect((await call(raj, "POST", "/me/passkey/start", {})).status).toBe(403);
    expect((await call(raj, "DELETE", "/me/totp")).status).toBe(403);
    expect((await repo.getTotp(s.raj.id))!.secret).toBe(SEED);
  });

  it("treats a failed passkey lookup as unknown, never as unenrolled", async () => {
    // Dana has no app authenticator; Cognito can't be asked
    directory.failLookup = true;
    const dana = await signIn(s.dana.email, "j-dana");
    expect((await call(dana, "POST", "/me/totp/start", {})).status).toBe(503);
    expect((await call(dana, "POST", "/me/passkey/start", {})).status).toBe(503);
    // A passkey the profile already knows about counts as enrolled during the outage
    const u = (await repo.getUser(s.dana.id))!;
    await repo.saveUser({ ...u, passkey: true, version: u.version + 1 }, u.version);
    expect((await call(dana, "POST", "/me/totp/start", {})).status).toBe(403);
    // And a sign-in during the outage doesn't erase the hint
    await signIn(s.dana.email, "j-dana-2");
    expect((await repo.getUser(s.dana.id))!.passkey).toBe(true);
  });

  it("lets a genuinely unenrolled invitee add a first authenticator from an email session", async () => {
    const dana = await signIn(s.dana.email, "j-first");
    const start = await call(dana, "POST", "/me/totp/start", {});
    expect(start.status).toBe(200);
    expect((await call(dana, "POST", "/me/totp/confirm", { code: codeFor(start.json.secret) })).status).toBe(200);
    expect((await call(dana, "GET", "/me")).json.strongSession).toBe(true);
    // Now enrolled: a different, weak session can't add another method
    const other = await signIn(s.dana.email, "j-other");
    expect((await call(other, "POST", "/me/totp/start", {})).status).toBe(403);
    expect((await call(other, "POST", "/me/passkey/start", {})).status).toBe(403);
  });

  it("keeps the old authenticator working through an abandoned or expired setup", async () => {
    await enrollTotp(s.raj.id);
    const raj = await signIn(s.raj.email, "j-strong", "passkey");
    const start = await call(raj, "POST", "/me/totp/start", {});
    expect(start.status).toBe(200);
    // Abandoned: the old seed still confirms
    expect((await repo.getTotp(s.raj.id))!.secret).toBe(SEED);
    expect((await call(raj, "POST", "/me/confirm", { code: codeFor(SEED) })).status).toBe(200);
    // Expired: the pending setup can't be activated
    const p = (await repo.getPendingTotp(s.raj.id))!;
    await repo.savePendingTotp(s.raj.id, { ...p, expiresAt: new Date(Date.now() - 1000).toISOString(), version: p.version + 1 }, { version: p.version });
    expect((await call(raj, "POST", "/me/totp/confirm", { code: codeFor(start.json.secret) })).status).toBe(409);
    expect((await repo.getTotp(s.raj.id))!.secret).toBe(SEED);
  });

  it("binds a setup to the session that started it and caps its tries", async () => {
    const dana = await signIn(s.dana.email, "j-a");
    const start = await call(dana, "POST", "/me/totp/start", {});
    // Another session of the same person can't finish it
    const other = await signIn(s.dana.email, "j-b");
    expect((await call(other, "POST", "/me/totp/confirm", { code: codeFor(start.json.secret) })).status).toBe(409);
    for (let i = 0; i < 5; i++) expect((await call(dana, "POST", "/me/totp/confirm", { code: wrongFor(start.json.secret) })).status).toBe(400);
    expect((await call(dana, "POST", "/me/totp/confirm", { code: codeFor(start.json.secret) })).status).toBe(429);
    expect(await repo.getTotp(s.dana.id)).toBeUndefined();
  });

  it("replaces from a confirmed session, ends other sessions' confirmation, records it, and tells the person", async () => {
    await enrollTotp(s.raj.id);
    const strong = await signIn(s.raj.email, "j-strong", "passkey");
    const elsewhere = await signIn(s.raj.email, "j-elsewhere", "passkey");
    expect(await repo.sessionStrong("j-elsewhere", s.raj.id)).toBe(true);
    const start = await call(strong, "POST", "/me/totp/start", {});
    expect((await call(strong, "POST", "/me/totp/confirm", { code: codeFor(start.json.secret) })).status).toBe(200);
    expect((await repo.getTotp(s.raj.id))!.secret).toBe(start.json.secret);
    // This session stays confirmed; the other one must confirm again
    expect(await repo.sessionStrong("j-strong", s.raj.id)).toBe(true);
    expect(await repo.sessionStrong("j-elsewhere", s.raj.id)).toBe(false);
    expect((await repo.listSecurityEvents(s.raj.id)).map((e) => e.action)).toContain("totp.replaced");
    expect(mailer.sent.at(-1)!.subject).toMatch(/replaced/);
    // Codes from the old seed no longer work
    expect((await call(strong, "POST", "/me/confirm", { code: codeFor(SEED, 1) })).status).toBe(400);
    void elsewhere;
  });

  it("removes only from a confirmed session, and other sessions lose their confirmation", async () => {
    await enrollTotp(s.raj.id);
    const strong = await signIn(s.raj.email, "j-strong", "passkey");
    await signIn(s.raj.email, "j-other", "passkey");
    expect((await call(strong, "DELETE", "/me/totp")).status).toBe(200);
    expect(await repo.getTotp(s.raj.id)).toBeUndefined();
    expect(await repo.sessionStrong("j-other", s.raj.id)).toBe(false);
    expect(await repo.sessionStrong("j-strong", s.raj.id)).toBe(true);
    expect(mailer.sent.at(-1)!.subject).toMatch(/removed/);
  });

  it("doesn't let one session's proof strengthen another, and sign-out forgets it", async () => {
    await enrollTotp(s.raj.id);
    const a = await signIn(s.raj.email, "j-a");
    const b = await signIn(s.raj.email, "j-b");
    expect((await call(a, "POST", "/me/confirm", { code: codeFor(SEED) })).status).toBe(200);
    expect((await call(a, "GET", "/me")).json.strongSession).toBe(true);
    expect((await call(b, "GET", "/me")).json.strongSession).toBe(false);
    await call(a, "POST", "/auth/logout", {});
    expect(await repo.sessionStrong("j-a", s.raj.id)).toBe(false);
  });
});


// Text-message codes as a second step, with the same standing as a passkey or authenticator app
describe("text codes to confirm it's you", () => {
  /** The six-digit code in the latest text */
  const lastCode = () => /(\d{6})/.exec(texter.sent.at(-1)!.body)![1]!;
  /** Agree to texts and prove the number, as the profile does */
  async function verifyNumber(sess: { email: string; jti: string }) {
    const me = await call(sess, "GET", "/me");
    const saved = await call(sess, "PATCH", "/me", { version: me.json.user.version, phone: "(555) 010-2030", smsConsent: true });
    expect(saved.status).toBe(200);
    expect((await call(sess, "POST", "/me/phone/verify", {})).status).toBe(200);
    expect((await call(sess, "POST", "/me/phone/confirm", { code: lastCode() })).status).toBe(200);
  }

  it("turns on for a proved number, confirms a session, and needs a confirmed session to turn off", async () => {
    const dana = await signIn(s.dana.email, "j-dana");
    // Not before the number is proved
    expect((await call(dana, "POST", "/me/text-factor", {})).status).toBe(409);
    await verifyNumber(dana);
    // A first second step may come from an email session, like a new invitee's first passkey
    expect((await call(dana, "POST", "/me/text-factor", {})).status).toBe(200);
    expect((await call(dana, "GET", "/me")).json.factors.sms).toBe(true);
    expect(mailer.sent.at(-1)!.subject).toMatch(/Text-message confirmation was added/);
    // With text codes on, an email session can't change the number or say no to texts
    const me = (await call(dana, "GET", "/me")).json.user;
    expect((await call(dana, "PATCH", "/me", { version: me.version, phone: "(555) 010-9999" })).status).toBe(403);
    expect((await call(dana, "PATCH", "/me", { version: me.version, smsConsent: false })).status).toBe(403);
    // A wrong texted code doesn't confirm; the right one does, once
    expect((await call(dana, "POST", "/me/confirm/text", {})).status).toBe(200);
    const code = lastCode();
    expect(texter.sent.at(-1)!.body).toMatch(/confirm it's you/);
    expect((await call(dana, "POST", "/me/confirm", { via: "text", code: code === "000000" ? "111111" : "000000" })).status).toBe(400);
    expect(await repo.sessionStrong("j-dana", s.dana.id)).toBe(false);
    expect((await call(dana, "POST", "/me/confirm", { via: "text", code })).status).toBe(200);
    expect(await repo.sessionStrong("j-dana", s.dana.id)).toBe(true);
    expect((await call(dana, "POST", "/me/confirm", { via: "text", code })).status).toBe(409);
    // Another, unconfirmed session can't turn them off; the confirmed one can, and mail says so
    const other = await signIn(s.dana.email, "j-dana-2");
    expect((await call(other, "DELETE", "/me/text-factor")).status).toBe(403);
    expect((await call(dana, "DELETE", "/me/text-factor")).status).toBe(200);
    expect((await call(dana, "GET", "/me")).json.factors.sms).toBe(false);
    expect(mailer.sent.at(-1)!.subject).toMatch(/Text-message confirmation was removed/);
  });

  // Invariants from the SMS atomicity review: one code confirms at most one session, the hourly limit
  // counts sends rather than unused codes, and a code is bound to its session and number
  describe("single use and send budget", () => {
    /** Dana with a proved number and text codes on, in one email session */
    async function ready(jti = "j-dana") {
      const dana = await signIn(s.dana.email, jti);
      await verifyNumber(dana);
      expect((await call(dana, "POST", "/me/text-factor", {})).status).toBe(200);
      return dana;
    }

    it("lets concurrent confirmations with one code succeed exactly once", async () => {
      const dana = await ready();
      expect((await call(dana, "POST", "/me/confirm/text", {})).status).toBe(200);
      const code = lastCode();
      const results = await Promise.all(Array.from({ length: 4 }, () => call(dana, "POST", "/me/confirm", { via: "text", code })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      // Losers get a plain refusal, never a stored row
      for (const r of results.filter((x) => x.status !== 200)) expect(r.json.current).toBeUndefined();
    });

    it("confirms only the session that asked for the code", async () => {
      const a = await ready("j-a");
      const b = await signIn(s.dana.email, "j-b");
      expect((await call(a, "POST", "/me/confirm/text", {})).status).toBe(200);
      const code = lastCode();
      const both = await Promise.all([call(a, "POST", "/me/confirm", { via: "text", code }), call(b, "POST", "/me/confirm", { via: "text", code })]);
      expect(both.map((r) => r.status)).toEqual([200, 409]);
      expect(await repo.sessionStrong("j-a", s.dana.id)).toBe(true);
      expect(await repo.sessionStrong("j-b", s.dana.id)).toBe(false);
    });

    it("refuses the fourth send in an hour even after earlier codes were used", async () => {
      const dana = await ready();
      for (let i = 0; i < 3; i++) {
        expect((await call(dana, "POST", "/me/confirm/text", {})).status).toBe(200);
        expect((await call(dana, "POST", "/me/confirm", { via: "text", code: lastCode() })).status).toBe(200);
      }
      const before = texter.sent.length;
      expect((await call(dana, "POST", "/me/confirm/text", {})).status).toBe(429);
      expect(texter.sent).toHaveLength(before);
    });

    it("caps all code texts per person across numbers", async () => {
      const dana = await signIn(s.dana.email, "j-dana");
      // Three proofs at one number, three at a second (six in all), then a third number is refused
      for (const [i, phone] of ["5550102030", "5550104040", "5550105050"].entries()) {
        const me = (await call(dana, "GET", "/me")).json.user;
        expect((await call(dana, "PATCH", "/me", { version: me.version, phone, smsConsent: true })).status).toBe(200);
        const sends = i < 2 ? 3 : 0;
        for (let n = 0; n < sends; n++) expect((await call(dana, "POST", "/me/phone/verify", {})).status).toBe(200);
      }
      expect((await call(dana, "POST", "/me/phone/verify", {})).status).toBe(429);
    });

    it("still counts the daily account budget", async () => {
      const dana = await ready();
      const day = new Date().toISOString().slice(0, 10);
      await table.write([{ put: { PK: "COUNTER", SK: `SMS#${day}`, n: 200 }, guard: { always: true } }]);
      expect((await call(dana, "POST", "/me/confirm/text", {})).status).toBe(429);
    });

    it("fails closed when the number changes after the code was sent", async () => {
      const dana = await ready();
      expect((await call(dana, "POST", "/me/confirm/text", {})).status).toBe(200);
      const code = lastCode();
      // The verified number moves underneath the pending code (as an operator fix or another save might)
      const u = (await repo.getUser(s.dana.id))!;
      await repo.saveUser({ ...u, phone: "+15550109999", smsPhone: "+15550109999", version: u.version + 1 }, u.version);
      expect((await call(dana, "POST", "/me/confirm", { via: "text", code })).status).toBe(400);
      expect(await repo.sessionStrong("j-dana", s.dana.id)).toBe(false);
    });

    it("never lets an older answer use up a newer code", async () => {
      const dana = await ready();
      expect((await call(dana, "POST", "/me/confirm/text", {})).status).toBe(200);
      const old = lastCode();
      expect((await call(dana, "POST", "/me/confirm/text", {})).status).toBe(200);
      const newer = lastCode();
      if (old !== newer) expect((await call(dana, "POST", "/me/confirm", { via: "text", code: old })).status).toBe(400);
      expect((await call(dana, "POST", "/me/confirm", { via: "text", code: newer })).status).toBe(200);
    });

    it("sends an id-bound guard to DynamoDB as a condition on both version and id", async () => {
      const client = new DynamoDBClient({ region: "us-east-1", credentials: { accessKeyId: "x", secretAccessKey: "x" } });
      let seen: { ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> } | undefined;
      client.middlewareStack.add((next) => async (args) => {
        seen = (args as { input: typeof seen }).input;
        return { output: { $metadata: {} } } as never;
      }, { step: "initialize" });
      await new DynamoTable("synthetic", client).write([{ delete: { PK: "USER#u", SK: "SMSCONFIRM" }, guard: { version: 4, id: "sms_1" } }]);
      expect(seen?.ConditionExpression).toBe("#v = :v AND #id = :id");
      expect(seen?.ExpressionAttributeValues).toEqual({ ":v": 4, ":id": "sms_1" });
    });

    it("treats a code row from before binding as no code", async () => {
      const dana = await ready();
      await table.write([{ put: { PK: `USER#${s.dana.id}`, SK: "SMSCONFIRM", hash: "x", phone: "+15550102030", expiresAt: new Date(Date.now() + 60_000).toISOString(), attempts: 0, version: 1, sentAt: [] }, guard: { always: true } }]);
      expect((await call(dana, "POST", "/me/confirm", { via: "text", code: "123456" })).status).toBe(409);
    });
  });

  it("won't add text codes from an email session when another second step exists", async () => {
    await enrollTotp(s.raj.id);
    const weak = await signIn(s.raj.email, "j-raj-weak");
    await verifyNumber(weak);
    expect((await call(weak, "POST", "/me/text-factor", {})).status).toBe(403);
    expect((await call(weak, "POST", "/me/confirm", { code: codeFor(SEED, 1) })).status).toBe(200);
    expect((await call(weak, "POST", "/me/text-factor", {})).status).toBe(200);
  });
});
