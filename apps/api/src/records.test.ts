// apps/api/src/records.test.ts - People kept on file only (a rebuilt organization's contacts): no
// account, no access, no messages, and no way to switch them on except a deliberate invitation.


import { beforeEach, describe, expect, it } from "vitest";
import type { PreSignUpTriggerEvent } from "aws-lambda";
import { newId, type Member } from "@1neon/domain";
import { createApp } from "./app.ts";
import { preSignUp } from "./handlers/auth-triggers.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";


// A fresh store with the demo data, plus one person on file in Acme Dental
const OP = "pradeep@neon1.tech";
const PAST = "former@client.example";
let app: ReturnType<typeof createApp>;
let repo: Repo;
let mailer: MemoryMailer;
let s: Awaited<ReturnType<typeof seed>>;
let uid: string;

beforeEach(async () => {
  repo = new Repo(new MemoryTable());
  mailer = new MemoryMailer();
  s = await seed(repo, OP);
  app = createApp({ cfg: { env: "local", publicUrl: "https://neon1.tech", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer, storage: new MemoryStorage() });
  const at = new Date().toISOString();
  uid = newId("u");
  await repo.createUser({ id: uid, email: PAST, name: "Former Client", title: "", phone: "", operator: false, strongAuth: false, theme: "awake", menu: "default", recordOnly: true, version: 1, createdAt: at, updatedAt: at, updatedBy: "script" });
  const m: Member = { tenantId: s.acme.id, userId: uid, email: PAST, name: "Former Client", title: "Owner", access: "admin", status: "on_file", invitedBy: "script", invitedAt: at, version: 1, createdAt: at, updatedAt: at, updatedBy: "script" };
  await repo.saveMember(m, { create: true });
});

/** Call the API as `as` and parse the JSON reply */
async function call(as: string, method: string, path: string, body?: unknown) {
  const r = await app.request(`/1NEON/api${path}`, { method, headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}

const signUp = (email: string) => preSignUp({ triggerSource: "PreSignUp_SignUp", request: { userAttributes: { email } }, response: {} } as unknown as PreSignUpTriggerEvent, repo);


describe("people on file", () => {
  it("can't make an account", async () => {
    await expect(signUp(PAST)).rejects.toThrow(/hasn't been invited/);
    await expect(signUp("dana@acmedental.example")).resolves.toBeTruthy();
  });

  it("get no access and stay on file even if they reach the API", async () => {
    const me = await call(PAST, "GET", "/me");
    expect(me.json.orgs ?? []).toEqual([]);
    expect((await call(PAST, "GET", `/t/${s.acme.id}`)).status).toBe(404);
    expect((await repo.getMember(s.acme.id, uid))?.status).toBe("on_file");
  });

  it("can't be switched on from the people list", async () => {
    const m = (await repo.getMember(s.acme.id, uid))!;
    const r = await call(OP, "PATCH", `/t/${s.acme.id}/members/${uid}`, { version: m.version, status: "joined" });
    expect(r.status).toBe(400);
    expect(r.json.error ?? r.json.code ?? JSON.stringify(r.json)).toMatch(/on_file/);
  });

  it("become invited, and may make an account, only when invited on purpose", async () => {
    expect(mailer.sent.length).toBe(0);
    const r = await call(OP, "POST", `/t/${s.acme.id}/members/invite`, { people: [{ email: PAST, access: "viewer" }] });
    expect(r.status).toBe(201);
    expect((await repo.getMember(s.acme.id, uid))?.status).toBe("invited");
    expect((await repo.getUser(uid))?.recordOnly).toBeUndefined();
    await expect(signUp(PAST)).resolves.toBeTruthy();
  });
});
