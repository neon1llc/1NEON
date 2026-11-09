// apps/api/src/app.test.ts - API behavior that matters most: identity, tenant isolation, access
// levels, and conflict handling.


import { beforeEach, describe, expect, it } from "vitest";
import type { CustomMessageTriggerEvent } from "aws-lambda";
import { createApp } from "./app.ts";
import { message } from "./handlers/auth-triggers.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";


// Each test gets a fresh in-memory store with the demo data, and calls the app as a given person
const OP = "pradeep@neon1.tech";
let app: ReturnType<typeof createApp>;
let repo: Repo;
let mailer: MemoryMailer;
let s: Awaited<ReturnType<typeof seed>>;


// Fresh store, seed, and app for every test; dev auth stands in for Cognito
beforeEach(async () => {
  repo = new Repo(new MemoryTable());
  mailer = new MemoryMailer();
  s = await seed(repo, OP);
  app = createApp({
    cfg: { env: "local", publicUrl: "https://neon1.tech", operatorEmails: [OP], devAuth: true },
    repo,
    directory: new MemoryDirectory(),
    mailer,
    storage: new MemoryStorage(),
  });
});


/** Call the API as `as` (an email, or undefined for anonymous) and parse the JSON reply */
async function call(as: string | undefined, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-1neon": "1" };
  if (as) headers["x-dev-user"] = as;
  const r = await app.request(`/1NEON/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}


// Who may call at all, and what the first visit records
describe("identity", () => {
  it("refuses anonymous callers", async () => {
    expect((await call(undefined, "GET", "/me")).status).toBe(401);
  });

  it("refuses writes without the CSRF header", async () => {
    const r = await app.request("/1NEON/api/me", { method: "PATCH", headers: { "x-dev-user": "dana@acmedental.example" }, body: "{}" });
    expect(r.status).toBe(403);
  });

  it("lists only my organizations, and the operator sees all", async () => {
    const dana = await call("dana@acmedental.example", "GET", "/me");
    expect(dana.json.orgs.map((o: { name: string }) => o.name)).toEqual(["Acme Dental"]);
    const op = await call(OP, "GET", "/me");
    expect(op.json.operator).toBe(true);
    expect(op.json.orgs).toHaveLength(3);
  });

  it("marks an invited member joined on first visit", async () => {
    await call("lee@harborauto.example", "GET", "/me");
    const members = await call(OP, "GET", `/t/${s.harbor.id}/members`);
    expect(members.json.find((m: { email: string }) => m.email === "lee@harborauto.example").status).toBe("joined");
  });
});


// Awake is everyone's theme until they choose otherwise
describe("theme", () => {
  it("reads a stored legacy \"system\" theme as awake", async () => {
    const uid = (await repo.userIdForEmail("dana@acmedental.example"))!;
    const stored = (await repo.getUser(uid))!;
    await repo.saveUser({ ...stored, theme: "system" as never, version: stored.version + 1 }, stored.version);
    expect((await call("dana@acmedental.example", "GET", "/me")).json.user.theme).toBe("awake");
  });

  it("keeps device matching once chosen, and refuses the old value", async () => {
    const me = await call("dana@acmedental.example", "GET", "/me");
    expect(me.json.user.theme).toBe("awake");
    const saved = await call("dana@acmedental.example", "PATCH", "/me", { version: me.json.user.version, theme: "device" });
    expect(saved.json.theme).toBe("device");
    expect((await call("dana@acmedental.example", "GET", "/me")).json.user.theme).toBe("device");
    const old = await call("dana@acmedental.example", "PATCH", "/me", { version: saved.json.version, theme: "system" });
    expect(old.status).toBe(400);
  });
});


// Branded email: the mark once, subtle links, a copyable code, and a sign-off Gmail won't collapse
describe("email", () => {
  it("sends the invite with the mark, the portal link, and a timed sign-off", async () => {
    await call("raj@acmedental.example", "POST", `/t/${s.acme.id}/members/invite`, { people: [{ email: "x@y.example" }] });
    const mail = mailer.sent.at(-1)!;
    expect(mail.html.match(/neon1-mark\.png/g)).toHaveLength(1);
    expect(mail.html).toContain('alt="neon1"');
    expect(mail.html).toContain("your invitation");
    expect(mail.html).toContain('href="https://neon1.tech/1NEON/"');
    expect(mail.html).toContain('href="https://neon1.tech/"');
    expect(mail.html).toMatch(/1 is glad to be of service\.<\/div><div style="white-space:nowrap[^"]*">Sent .+ UTC<\/div>/);
    expect(mail.text).toContain("how it becomes the normal way you work");
  });

  it("puts the sign-in code in one selectable piece under a plain subject", () => {
    const event = { triggerSource: "CustomMessage_Authentication", request: { codeParameter: "{####}", userAttributes: {} }, response: {} } as unknown as CustomMessageTriggerEvent;
    const out = message(event, new Date("2026-11-06T20:22:00Z"));
    expect(out.response.emailSubject).toBe("Your portal sign-in code");
    expect(out.response.emailMessage).toMatch(/user-select:all">\{####\}<\/span>/);
    expect(out.response.emailMessage).toContain('sign in to <a href="https://neon1.tech/1NEON/"');
    expect(out.response.emailMessage).toContain("Sent Nov 6, 2026, 8:22 PM UTC");
    expect(out.response.emailMessage).toContain("neon1 · your sign-in code");
    // The link finishes sign-in with the code in the fragment, never in a server-visible query
    expect(out.response.emailMessage).toContain('href="https://neon1.tech/1NEON/#code={####}"');
    expect(out.response.emailMessage).not.toContain("<h1");
  });

  it("leaves messages it doesn't brand to Cognito", () => {
    const event = { triggerSource: "CustomMessage_AdminCreateUser", request: { codeParameter: "{####}", userAttributes: {} }, response: {} } as unknown as CustomMessageTriggerEvent;
    expect(message(event).response.emailMessage).toBeUndefined();
  });
});


// Nothing crosses from one organization into another
describe("tenant isolation", () => {
  it("hides other organizations entirely", async () => {
    for (const path of [`/t/${s.harbor.id}`, `/t/${s.harbor.id}/projects`, `/t/${s.harbor.id}/members`, `/t/${s.harbor.id}/workspace`]) {
      expect((await call("dana@acmedental.example", "GET", path)).status).toBe(404);
    }
    expect((await call("dana@acmedental.example", "POST", `/t/${s.harbor.id}/projects`, { name: "x" })).status).toBe(404);
  });

  it("can't reach another org's project through my own org's URL", async () => {
    const harborProjects = await call(OP, "GET", `/t/${s.harbor.id}/projects`);
    const pid = harborProjects.json[0].id;
    expect((await call("dana@acmedental.example", "GET", `/t/${s.acme.id}/projects/${pid}`)).status).toBe(404);
  });
});


// The operator's cross-client view stays read only
describe("All clients view", () => {
  it("is operator only and read only", async () => {
    expect((await call("raj@acmedental.example", "GET", "/all/projects")).status).toBe(403);
    const all = await call(OP, "GET", "/all/projects");
    expect(all.status).toBe(200);
    expect(new Set(all.json.projects.map((p: { tenantId: string }) => p.tenantId)).size).toBe(3);
    const write = await call(OP, "POST", "/all/projects", { name: "nope" });
    expect(write.status).toBe(403);
    expect(write.json.error).toBe("read_only");
  });
});


// Viewer, editor, and admin limits, and the last-admin rule
describe("access levels", () => {
  it("lets viewers read and submit requests but not edit", async () => {
    await call(OP, "POST", `/t/${s.acme.id}/members/invite`, { people: [{ email: "viewer@acmedental.example", access: "viewer" }] });
    const projects = await call("viewer@acmedental.example", "GET", `/t/${s.acme.id}/projects`);
    const pid = projects.json[0].id;
    expect((await call("viewer@acmedental.example", "POST", `/t/${s.acme.id}/projects/${pid}/items`, { kind: "request", title: "Can we add text reminders?" })).status).toBe(201);
    expect((await call("viewer@acmedental.example", "POST", `/t/${s.acme.id}/projects/${pid}/items`, { kind: "task", title: "x" })).status).toBe(403);
    expect((await call("viewer@acmedental.example", "POST", `/t/${s.acme.id}/projects`, { name: "x" })).status).toBe(403);
  });

  it("requires strong sign-in for people management", async () => {
    // Raj has strong auth; Dana is an editor
    expect((await call("dana@acmedental.example", "POST", `/t/${s.acme.id}/members/invite`, { people: [{ email: "x@y.example" }] })).status).toBe(403);
    expect((await call("raj@acmedental.example", "POST", `/t/${s.acme.id}/members/invite`, { people: [{ email: "x@y.example" }] })).status).toBe(201);
    expect(mailer.sent.at(-1)?.subject).toBe("You're invited to Acme Dental on 1NEON");
  });

  it("keeps at least one admin", async () => {
    const members = (await call(OP, "GET", `/t/${s.neon1.id}/members`)).json;
    const me = members[0];
    const r = await call(OP, "PATCH", `/t/${s.neon1.id}/members/${me.userId}`, { version: me.version, access: "viewer" });
    expect(r.json.error).toBe("last_admin");
  });
});


// Project lifecycle, version conflicts, stage gates, decisions, and edit markers
describe("projects and concurrency", () => {
  it("creates a project from a template in the first stage", async () => {
    const r = await call("dana@acmedental.example", "POST", `/t/${s.acme.id}/projects`, {
      name: "Move files to the cloud",
      template: "cloud_migration",
      example: "Files live on the front desk PC.",
      metrics: [{ title: "Time to find a file", unit: "min", baseline: 6, target: 1 }],
    });
    expect(r.status).toBe(201);
    expect(r.json.key).toBe("MIG-1");
    expect(r.json.stageId).toBe("intake");
    const full = await call("dana@acmedental.example", "GET", `/t/${s.acme.id}/projects/${r.json.id}`);
    const kinds = full.json.items.map((i: { kind: string }) => i.kind);
    expect(kinds).toContain("metric");
    expect(kinds).toContain("handoff");
  });

  it("refuses a stale save with 409 and the current record", async () => {
    const list = await call("dana@acmedental.example", "GET", `/t/${s.acme.id}/projects`);
    const p = list.json[0];
    const first = await call("dana@acmedental.example", "PATCH", `/t/${s.acme.id}/projects/${p.id}`, { version: p.version, name: "Renamed by Dana" });
    expect(first.status).toBe(200);
    const stale = await call("raj@acmedental.example", "PATCH", `/t/${s.acme.id}/projects/${p.id}`, { version: p.version, name: "Renamed by Raj" });
    expect(stale.status).toBe(409);
    expect(stale.json.current.name).toBe("Renamed by Dana");
  });

  it("asks for a reason before moving past Decide without a decision", async () => {
    const list = await call(OP, "GET", `/t/${s.acme.id}/projects`);
    const p = list.json.find((x: { key: string }) => x.key === "FLOW-1");
    const blocked = await call(OP, "POST", `/t/${s.acme.id}/projects/${p.id}/move`, { version: p.version, stageId: "build" });
    expect(blocked.status).toBe(428);
    const ok = await call(OP, "POST", `/t/${s.acme.id}/projects/${p.id}/move`, { version: p.version, stageId: "build", reason: "Client approved by phone" });
    expect(ok.json.stageId).toBe("build");
  });

  it("records an immutable decision when an option is approved", async () => {
    const list = await call("raj@acmedental.example", "GET", `/t/${s.acme.id}/projects`);
    const p = list.json.find((x: { key: string }) => x.key === "FLOW-1");
    const full = await call("raj@acmedental.example", "GET", `/t/${s.acme.id}/projects/${p.id}`);
    const option = full.json.items.find((i: { kind: string; fields: { recommended?: boolean } }) => i.kind === "option" && i.fields.recommended);
    const r = await call("raj@acmedental.example", "POST", `/t/${s.acme.id}/projects/${p.id}/items/${option.id}/approve`, { version: option.version });
    expect(r.status).toBe(201);
    expect(r.json.decision.fields.optionVersion).toBe(option.version);
    const edit = await call(OP, "PATCH", `/t/${s.acme.id}/projects/${p.id}/items/${r.json.decision.id}`, { version: 1, title: "changed" });
    expect(edit.json.error).toBe("immutable");
  });

  it("shows who is editing and lets others know", async () => {
    const p = (await call("dana@acmedental.example", "GET", `/t/${s.acme.id}/projects`)).json[0];
    expect((await call("dana@acmedental.example", "POST", `/t/${s.acme.id}/projects/${p.id}/edits`, { recordId: p.id })).json.ok).toBe(true);
    const raj = await call("raj@acmedental.example", "POST", `/t/${s.acme.id}/projects/${p.id}/edits`, { recordId: p.id });
    expect(raj.json.ok).toBe(false);
    expect(raj.json.holder.name).toBe("Dana Kim");
  });
});


// Uploads: the record first, then the bytes, then "done", which also checks off a "file needed" item
describe("documents", () => {
  it("files an upload under its project and layer, and answers the file it was asked for", async () => {
    const dana = "dana@acmedental.example";
    const p = (await call(dana, "GET", `/t/${s.acme.id}/projects`)).json[0];
    const ask = await call(OP, "POST", `/t/${s.acme.id}/projects/${p.id}/items`, { kind: "file_request", title: "Last 3 months of invoices" });
    const start = await call(dana, "POST", `/t/${s.acme.id}/docs`, { name: "invoices.pdf", contentType: "application/pdf", size: 4, layer: "needs", projectId: p.id, itemId: ask.json.id });
    expect(start.status).toBe(201);
    // Not listed until the bytes arrive
    expect((await call(dana, "GET", `/t/${s.acme.id}/docs`)).json.docs).toHaveLength(0);
    const put = await app.request(start.json.upload, { method: "PUT", headers: { "content-type": "application/pdf" }, body: "%PDF" });
    expect(put.status).toBe(200);
    await call(dana, "POST", `/t/${s.acme.id}/docs/${start.json.doc.id}/done?p=${p.id}`);
    const list = await call(dana, "GET", `/t/${s.acme.id}/docs`);
    expect(list.json.docs.map((x: { name: string }) => x.name)).toEqual(["invoices.pdf"]);
    const item = (await call(dana, "GET", `/t/${s.acme.id}/projects/${p.id}`)).json.items.find((i: { id: string }) => i.id === ask.json.id);
    expect(item.status).toBe("done");
    expect((await call(dana, "GET", `/t/${s.acme.id}/docs/${start.json.doc.id}/download?p=${p.id}`)).json.url).toContain("/dev-files/");
  });

  it("refuses an answer to an item that isn't a file request", async () => {
    const p = (await call(OP, "GET", `/t/${s.acme.id}/projects`)).json[0];
    const task = await call(OP, "POST", `/t/${s.acme.id}/projects/${p.id}/items`, { kind: "task", title: "Not a file" });
    const r = await call(OP, "POST", `/t/${s.acme.id}/docs`, { name: "x.txt", size: 1, layer: "needs", projectId: p.id, itemId: task.json.id });
    expect(r.status).toBe(400);
  });
});


// The decision flow: who approves, what can be approved, and statuses only the approve route grants
describe("approvals", () => {
  const raj = "raj@acmedental.example";
  const dana = "dana@acmedental.example";

  // FLOW-1 names Raj as its decision maker and has three proposed options
  async function flow1() {
    const p = (await call(OP, "GET", `/t/${s.acme.id}/projects`)).json.find((x: { key: string }) => x.key === "FLOW-1");
    const full = await call(OP, "GET", `/t/${s.acme.id}/projects/${p.id}`);
    const options = full.json.items.filter((i: { kind: string }) => i.kind === "option");
    return { p, options, path: `/t/${s.acme.id}/projects/${p.id}` };
  }

  it("lets only the named decision maker approve", async () => {
    const { options, path } = await flow1();
    const o = options[0];
    expect((await call(dana, "POST", `${path}/items/${o.id}/approve`, { version: o.version })).json.error).toBe("not_decider");
    expect((await call(OP, "POST", `${path}/items/${o.id}/approve`, { version: o.version })).json.error).toBe("not_decider");
    expect((await call(raj, "POST", `${path}/items/${o.id}/approve`, { version: o.version })).status).toBe(201);
  });

  it("approves a proposed option once, and never a draft", async () => {
    const { options, path } = await flow1();
    const o = options[0];
    await call(raj, "POST", `${path}/items/${o.id}/approve`, { version: o.version });
    expect((await call(raj, "POST", `${path}/items/${o.id}/approve`, { version: o.version + 1 })).json.error).toBe("not_proposed");
    const draft = await call(OP, "POST", `${path}/items`, { kind: "option", title: "D. Something new" });
    expect((await call(raj, "POST", `${path}/items/${draft.json.id}/approve`, { version: 1 })).json.error).toBe("not_proposed");
  });

  it("lets a client admin approve when nobody is named, but not neon1", async () => {
    const p = (await call(OP, "POST", `/t/${s.acme.id}/projects`, { name: "No decider" })).json;
    const path = `/t/${s.acme.id}/projects/${p.id}`;
    const o = await call(OP, "POST", `${path}/items`, { kind: "option", title: "Only option", status: "proposed" });
    expect((await call(OP, "POST", `${path}/items/${o.json.id}/approve`, { version: 1 })).json.error).toBe("not_decider");
    expect((await call(dana, "POST", `${path}/items/${o.json.id}/approve`, { version: 1 })).json.error).toBe("not_decider");
    expect((await call(raj, "POST", `${path}/items/${o.json.id}/approve`, { version: 1 })).status).toBe(201);
  });

  it("refuses statuses outside each kind's list, including a hand-set approval", async () => {
    const { path } = await flow1();
    const o = await call(OP, "POST", `${path}/items`, { kind: "option", title: "E" });
    expect((await call(OP, "PATCH", `${path}/items/${o.json.id}`, { version: 1, status: "approved" })).json.error).toBe("invalid_status");
    expect((await call(OP, "PATCH", `${path}/items/${o.json.id}`, { version: 1, status: "banana" })).json.error).toBe("invalid_status");
    expect((await call(OP, "POST", `${path}/items`, { kind: "task", title: "t", status: "approved" })).json.error).toBe("invalid_status");
    expect((await call(OP, "PATCH", `${path}/items/${o.json.id}`, { version: 1, status: "proposed" })).status).toBe(200);
  });

  it("keeps an approved option approved", async () => {
    const { options, path } = await flow1();
    const o = options[0];
    const r = await call(raj, "POST", `${path}/items/${o.id}/approve`, { version: o.version });
    const back = await call(OP, "PATCH", `${path}/items/${o.id}`, { version: r.json.option.version, status: "draft" });
    expect(back.json.error).toBe("immutable");
  });
});


// Writes that must name real members, finished uploads, and live projects
describe("write guards", () => {
  it("refuses assignees and project people outside the organization", async () => {
    const p = (await call(OP, "GET", `/t/${s.acme.id}/projects`)).json[0];
    const lee = (await call("lee@harborauto.example", "GET", "/me")).json.user.id;
    expect((await call(OP, "POST", `/t/${s.acme.id}/projects/${p.id}/items`, { kind: "task", title: "x", assigneeId: lee })).json.error).toBe("not_member");
    expect((await call(OP, "POST", `/t/${s.acme.id}/projects`, { name: "x", people: [{ userId: lee, role: "decision_maker" }] })).json.error).toBe("not_member");
  });

  it("won't mark an upload done before its bytes arrive", async () => {
    const p = (await call(OP, "GET", `/t/${s.acme.id}/projects`)).json[0];
    const start = await call(OP, "POST", `/t/${s.acme.id}/docs`, { name: "a.pdf", size: 4, layer: "needs", projectId: p.id });
    expect((await call(OP, "POST", `/t/${s.acme.id}/docs/${start.json.doc.id}/done?p=${p.id}`)).json.error).toBe("not_uploaded");
  });

  it("freezes an archived project until it's unarchived", async () => {
    const p = (await call(OP, "GET", `/t/${s.acme.id}/projects`)).json[0];
    const path = `/t/${s.acme.id}/projects/${p.id}`;
    const archived = await call(OP, "PATCH", path, { version: p.version, archived: true });
    expect((await call(OP, "POST", `${path}/items`, { kind: "task", title: "late" })).json.error).toBe("archived");
    expect((await call(OP, "PATCH", path, { version: archived.json.version, name: "renamed" })).json.error).toBe("archived");
    expect((await call(OP, "PATCH", path, { version: archived.json.version, archived: false })).status).toBe(200);
  });

  it("needs a version to delete an item, and keeps phone numbers off the members list", async () => {
    const p = (await call(OP, "GET", `/t/${s.acme.id}/projects`)).json[0];
    const t = await call(OP, "POST", `/t/${s.acme.id}/projects/${p.id}/items`, { kind: "task", title: "x" });
    expect((await call(OP, "DELETE", `/t/${s.acme.id}/projects/${p.id}/items/${t.json.id}`)).status).toBe(400);
    const members = (await call(OP, "GET", `/t/${s.acme.id}/members`)).json;
    expect(members.every((m: object) => !("phone" in m))).toBe(true);
  });

  it("answers a malformed sign-in step with 400, not 500", async () => {
    const r = await app.request("/1NEON/api/auth/step", { method: "POST", headers: { "x-1neon": "1", "content-type": "application/json" }, body: "{}" });
    expect(r.status).not.toBe(500);
  });
});


// Authenticator app: setup with a QR code, the first code finishes it, then codes confirm it's you
describe("authenticator app", () => {
  const dana = "dana@acmedental.example";
  // The code an app would show now for a base32 secret
  const codeFor = async (secret: string, at = Date.now()) => {
    const { TOTP, Secret } = await import("otpauth");
    return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: at });
  };

  it("sets up with the first code, then confirms once per code", async () => {
    const start = await call(dana, "POST", "/me/totp/start", {});
    expect(start.json.qr).toMatch(/^data:image\/svg\+xml/);
    expect((await call(dana, "POST", "/me/totp/confirm", { code: "000000" })).json.error).toBe("wrong_code");
    expect((await call(dana, "POST", "/me/totp/confirm", { code: await codeFor(start.json.secret) })).status).toBe(200);
    const me = await call(dana, "GET", "/me");
    expect(me.json.factors.totp).toBe(true);
    expect(JSON.stringify(me.json)).not.toContain(start.json.secret);
    // A fresh code from the next time step confirms; the same code twice doesn't
    const next = await codeFor(start.json.secret, Date.now() + 30_000);
    expect((await call(dana, "POST", "/me/confirm", { code: next })).status).toBe(200);
    expect((await call(dana, "POST", "/me/confirm", { code: next })).json.error).toBe("wrong_code");
  });

  it("locks after five wrong codes", async () => {
    const start = await call(dana, "POST", "/me/totp/start", {});
    await call(dana, "POST", "/me/totp/confirm", { code: await codeFor(start.json.secret) });
    for (let i = 0; i < 5; i++) await call(dana, "POST", "/me/confirm", { code: "000000" });
    expect((await call(dana, "POST", "/me/confirm", { code: await codeFor(start.json.secret, Date.now() + 30_000) })).json.error).toBe("locked");
  });
});


// Comments on items: anyone who can comment adds them; only the author or an admin removes one
describe("comments", () => {
  it("adds, lists with history, and guards removal", async () => {
    const p = (await call(OP, "GET", `/t/${s.acme.id}/projects`)).json.find((x: { key: string }) => x.key === "FLOW-1");
    const path = `/t/${s.acme.id}/projects/${p.id}`;
    const item = (await call(OP, "GET", path)).json.items[0];
    const added = await call("dana@acmedental.example", "POST", `${path}/items/${item.id}/comments`, { body: "Can we start Monday?" });
    expect(added.status).toBe(201);
    const list = await call("raj@acmedental.example", "GET", `${path}/items/${item.id}/comments`);
    expect(list.json.comments.map((x: { body: string }) => x.body)).toEqual(["Can we start Monday?"]);
    expect(list.json.history.some((e: { action: string }) => e.action === "comment.created")).toBe(true);
    expect((await call("lee@harborauto.example", "GET", `${path}/items/${item.id}/comments`)).status).toBe(404);
    expect((await call("dana@acmedental.example", "DELETE", `${path}/items/${item.id}/comments/${added.json.id}`)).status).toBe(200);
  });
});


// A written status update sets the project's health and shows on Home
describe("project updates", () => {
  it("sets health and lists the latest update", async () => {
    const p = (await call(OP, "GET", `/t/${s.acme.id}/projects`)).json.find((x: { key: string }) => x.key === "FLOW-1");
    await call(OP, "POST", `/t/${s.acme.id}/projects/${p.id}/items`, { kind: "update", title: "Vendor slipped a week", fields: { health: "at_risk" } });
    expect((await call(OP, "GET", `/t/${s.acme.id}/projects/${p.id}`)).json.project.health).toBe("at_risk");
    const ws = await call(OP, "GET", `/t/${s.acme.id}/workspace`);
    expect(ws.json.updates[0].title).toBe("Vendor slipped a week");
  });
});


// Coming up and Insights: dated work in order, and charts from the organization's own data
describe("upcoming and insights", () => {
  it("lists overdue and upcoming work, and summarizes the organization", async () => {
    const p = (await call(OP, "GET", `/t/${s.acme.id}/projects`)).json.find((x: { key: string }) => x.key === "FLOW-1");
    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    await call(OP, "POST", `/t/${s.acme.id}/projects/${p.id}/items`, { kind: "task", title: "Late one", dueDate: day(-40) });
    await call(OP, "POST", `/t/${s.acme.id}/projects/${p.id}/items`, { kind: "milestone", title: "Go live", dueDate: day(10) });
    const up = await call("raj@acmedental.example", "GET", `/t/${s.acme.id}/upcoming`);
    const titles = up.json.events.map((e: { title: string }) => e.title);
    expect(titles).toContain("Late one");
    expect(titles).toContain("Go live");
    expect(up.json.events.find((e: { title: string }) => e.title === "Late one").overdue).toBe(true);
    const ins = await call("raj@acmedental.example", "GET", `/t/${s.acme.id}/insights`);
    expect(ins.json.weeks).toHaveLength(8);
    expect(ins.json.work.overdue).toBeGreaterThan(0);
    expect(Object.values(ins.json.byLayer).reduce((a: number, b) => a + (b as number), 0)).toBe(ins.json.projects);
  });
});


// Session assurance (SEC-R01): bound to one session, one person, and a limited time
describe("session step-up", () => {
  // The operator's own user record
  const operator = async () => (await repo.getUser((await repo.userIdForEmail(OP))!))!;

  it("counts a passkey or authenticator check only for this session, this person, and a while", async () => {
    const me = await operator();
    // A code-only sign-in is not strong
    await repo.saveSession("code-session", me.id, false);
    expect(await repo.sessionStrong("code-session", me.id)).toBe(false);
    // A step-up marks only its own session
    await repo.saveSession("strong-session", me.id, true);
    expect(await repo.sessionStrong("strong-session", me.id)).toBe(true);
    expect(await repo.sessionStrong("code-session", me.id)).toBe(false);
    // Someone else can't borrow it, and no session ID never counts
    expect(await repo.sessionStrong("strong-session", "someone-else")).toBe(false);
    expect(await repo.sessionStrong(undefined, me.id)).toBe(false);
  });

  it("expires the step-up and treats rows without an expiry as not strong", async () => {
    const me = await operator();
    // A row written before the time limit existed
    await repo.table.write([{ put: { PK: "SESSION#old", SK: "META", userId: me.id, strong: true }, guard: { always: true } }]);
    expect(await repo.sessionStrong("old", me.id)).toBe(false);
    // A step-up whose window has passed
    await repo.table.write([{ put: { PK: "SESSION#stale", SK: "META", userId: me.id, strong: true, strongUntil: new Date(Date.now() - 1000).toISOString() }, guard: { always: true } }]);
    expect(await repo.sessionStrong("stale", me.id)).toBe(false);
  });

  it("forgets assurance on sign-out", async () => {
    const me = await operator();
    await repo.saveSession("s1", me.id, true);
    await repo.deleteSession("s1");
    expect(await repo.sessionStrong("s1", me.id)).toBe(false);
  });
});


// Notifications: others' changes count as new until opened, and important ones email by default
describe("notifications", () => {
  it("counts others' changes, clears on open, and emails a project move", async () => {
    const list = await call("raj@acmedental.example", "GET", `/t/${s.acme.id}/projects`);
    const p = list.json.find((x: { key: string }) => x.key === "FLOW-1");
    await call("dana@acmedental.example", "POST", `/t/${s.acme.id}/notifications/seen`);
    await new Promise((r) => setTimeout(r, 5));
    await call("raj@acmedental.example", "POST", `/t/${s.acme.id}/projects/${p.id}/items`, { kind: "request", title: "Text reminders" });
    await call("raj@acmedental.example", "POST", `/t/${s.acme.id}/projects/${p.id}/move`, { version: p.version, stageId: "build", reason: "Starting early" });
    const n = await call("dana@acmedental.example", "GET", `/t/${s.acme.id}/notifications`);
    expect(n.json.unread).toBe(2);
    // Both land in the same instant on a fast machine, so check the set, not the order
    expect(n.json.events.map((e: { group: string }) => e.group)).toEqual(expect.arrayContaining(["workflow", "updates"]));
    // Moves are critical, so Dana gets an email; the new request isn't, so she doesn't
    expect(mailer.sent.filter((m) => m.to === "dana@acmedental.example").length).toBe(1);
    await call("dana@acmedental.example", "POST", `/t/${s.acme.id}/notifications/seen`);
    expect((await call("dana@acmedental.example", "GET", `/t/${s.acme.id}/notifications`)).json.unread).toBe(0);
  });
});


// Texts: only with consent, only for the kinds chosen, and only to a number that reads as real
describe("texts", () => {
  const dana = "dana@acmedental.example";
  /** Move FLOW-1 one stage as Raj, which Dana chose to hear about by text */
  const move = async (stageId: string) => {
    const p = (await call("raj@acmedental.example", "GET", `/t/${s.acme.id}/projects`)).json.find((x: { key: string }) => x.key === "FLOW-1");
    const r = await call("raj@acmedental.example", "POST", `/t/${s.acme.id}/projects/${p.id}/move`, { version: p.version, stageId, reason: "Testing" });
    expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
  };
  /** The six-digit code in the latest verification text */
  const lastCode = (texter: MemoryTexter) => /code: (\d{6})/.exec(texter.sent.at(-1)!.body)![1]!;

  it("texts only a verified number the person still has, with no project detail", async () => {
    const texter = new MemoryTexter();
    app = createApp({ cfg: { env: "local", publicUrl: "https://neon1.tech", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer, storage: new MemoryStorage(), texter });
    const me = await call(dana, "GET", "/me");
    // Without consent nothing goes out, even with texts chosen
    const u1 = await call(dana, "PATCH", "/me", { version: me.json.user.version, phone: "(555) 010-2030", notify: { workflow: { email: false, sms: true } } });
    await move("build");
    expect(texter.sent).toHaveLength(0);
    // Consent alone isn't proof of the number: still nothing
    const u2 = await call(dana, "PATCH", "/me", { version: u1.json.version, smsConsent: true });
    expect(u2.json.smsConsentAt).toBeTruthy();
    expect((await call(dana, "GET", "/me")).json.sms.state).toBe("unverified");
    await move("verify");
    expect(texter.sent).toHaveLength(0);
    // A code proves it; a wrong code doesn't
    expect((await call(dana, "POST", "/me/phone/verify", {})).status).toBe(200);
    expect(texter.sent[0]!.to).toBe("+15550102030");
    expect((await call(dana, "POST", "/me/phone/confirm", { code: lastCode(texter) === "000000" ? "111111" : "000000" })).status).toBe(400);
    expect((await call(dana, "POST", "/me/phone/confirm", { code: lastCode(texter) })).status).toBe(200);
    expect((await call(dana, "GET", "/me")).json.sms.state).toBe("ready");
    await move("build");
    expect(texter.sent).toHaveLength(2);
    expect(texter.sent[1]!.to).toBe("+15550102030");
    expect(texter.sent[1]!.body).toMatch(/Reply STOP/);
    // The notice names no organization, project, or person
    expect(texter.sent[1]!.body).not.toMatch(/Acme|FLOW|Raj/);
    // A new number clears consent and verification: zero texts until proven and agreed again
    const cur = (await call(dana, "GET", "/me")).json.user;
    const changed = await call(dana, "PATCH", "/me", { version: cur.version, phone: "(555) 010-9999" });
    expect(changed.json.smsConsentAt).toBeUndefined();
    expect(changed.json.smsVerifiedAt).toBeUndefined();
    await move("verify");
    expect(texter.sent).toHaveLength(2);
  });

  it("limits code requests and wrong guesses, and says when texts aren't available", async () => {
    // No sending number: the profile says so and codes are refused
    const none = await call(dana, "GET", "/me");
    expect(none.json.sms.state).toBe("unavailable");
    expect((await call(dana, "POST", "/me/phone/verify", {})).status).toBe(503);
    const texter = new MemoryTexter();
    app = createApp({ cfg: { env: "local", publicUrl: "https://neon1.tech", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer, storage: new MemoryStorage(), texter });
    await call(dana, "PATCH", "/me", { version: none.json.user.version, phone: "5550102030", smsConsent: true });
    for (let i = 0; i < 3; i++) expect((await call(dana, "POST", "/me/phone/verify", {})).status).toBe(200);
    expect((await call(dana, "POST", "/me/phone/verify", {})).status).toBe(429);
    const wrong = lastCode(texter) === "000000" ? "111111" : "000000";
    const tries = await Promise.all(Array.from({ length: 8 }, () => call(dana, "POST", "/me/phone/confirm", { code: wrong })));
    expect(tries.every((r) => r.status !== 200)).toBe(true);
    // Five counted tries lock the code, even for the right answer
    expect((await call(dana, "POST", "/me/phone/confirm", { code: lastCode(texter) })).status).toBe(429);
  });

  it("stops texting a number that replied STOP, and records it", async () => {
    const texter = new MemoryTexter();
    app = createApp({ cfg: { env: "local", publicUrl: "https://neon1.tech", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer, storage: new MemoryStorage(), texter });
    const me = await call(dana, "GET", "/me");
    await call(dana, "PATCH", "/me", { version: me.json.user.version, phone: "5550102030", smsConsent: true, notify: { workflow: { email: false, sms: true } } });
    await call(dana, "POST", "/me/phone/verify", {});
    await call(dana, "POST", "/me/phone/confirm", { code: lastCode(texter) });
    // The carrier now refuses: the number opted out
    texter.send = async () => { throw Object.assign(new Error("opted out"), { name: "ConflictException", Reason: "DESTINATION_PHONE_NUMBER_OPTED_OUT" }); };
    await move("build");
    const after = (await call(dana, "GET", "/me")).json;
    expect(after.user.smsOptedOutAt).toBeTruthy();
    expect(after.sms.state).toBe("opted_out");
    // Agreeing again needs a new code, and a number the carrier still blocks gets a plain answer
    const again = await call(dana, "PATCH", "/me", { version: after.user.version, smsConsent: true });
    expect(again.json.smsVerifiedAt).toBeUndefined();
    expect((await call(dana, "GET", "/me")).json.sms.state).toBe("unverified");
    const blocked = await call(dana, "POST", "/me/phone/verify", {});
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toBe("carrier_opted_out");
    // After START the code goes through and notices resume
    const ok = new MemoryTexter();
    texter.send = ok.send.bind(ok);
    expect((await call(dana, "POST", "/me/phone/verify", {})).status).toBe(200);
    expect((await call(dana, "POST", "/me/phone/confirm", { code: lastCode(ok) })).status).toBe(200);
    expect((await call(dana, "GET", "/me")).json.sms.state).toBe("ready");
  });

  it("stops at a declined consent or a removed number, and keeps to the daily budget", async () => {
    const texter = new MemoryTexter();
    app = createApp({ cfg: { env: "local", publicUrl: "https://neon1.tech", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer, storage: new MemoryStorage(), texter });
    const me = await call(dana, "GET", "/me");
    await call(dana, "PATCH", "/me", { version: me.json.user.version, phone: "5550102030", smsConsent: true, notify: { workflow: { email: false, sms: true } } });
    await call(dana, "POST", "/me/phone/verify", {});
    await call(dana, "POST", "/me/phone/confirm", { code: lastCode(texter) });
    const codes = texter.sent.length;
    // Turning texts off: not agreed, nothing sent
    let u = (await call(dana, "GET", "/me")).json.user;
    await call(dana, "PATCH", "/me", { version: u.version, smsConsent: false });
    expect((await call(dana, "GET", "/me")).json.sms.state).toBe("not_agreed");
    await move("build");
    expect(texter.sent).toHaveLength(codes);
    // Removing the number: no number, nothing sent
    u = (await call(dana, "GET", "/me")).json.user;
    await call(dana, "PATCH", "/me", { version: u.version, phone: "", smsConsent: true });
    expect((await call(dana, "GET", "/me")).json.sms.state).toBe("no_number");
    await move("verify");
    expect(texter.sent).toHaveLength(codes);
    // Back on and verified: at most ten notices a day, however much happens
    u = (await call(dana, "GET", "/me")).json.user;
    await call(dana, "PATCH", "/me", { version: u.version, phone: "5550102030", smsConsent: true });
    await call(dana, "POST", "/me/phone/verify", {});
    await call(dana, "POST", "/me/phone/confirm", { code: lastCode(texter) });
    const before = texter.sent.length;
    for (let i = 0; i < 12; i++) await move(i % 2 ? "verify" : "build");
    expect(texter.sent.length - before).toBe(10);
    expect(texter.sent.slice(before).every((t) => t.body.length <= 160)).toBe(true);
  });
});
