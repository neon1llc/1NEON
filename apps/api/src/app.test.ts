// apps/api/src/app.test.ts - API behavior that matters most: identity, tenant isolation, access
// levels, and conflict handling.


import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";


// Each test gets a fresh in-memory store with the demo data, and calls the app as a given person
const OP = "pradeep@neon1.tech";
let app: ReturnType<typeof createApp>;
let mailer: MemoryMailer;
let s: Awaited<ReturnType<typeof seed>>;


// Fresh store, seed, and app for every test; dev auth stands in for Cognito
beforeEach(async () => {
  const repo = new Repo(new MemoryTable());
  mailer = new MemoryMailer();
  s = await seed(repo, OP);
  app = createApp({
    cfg: { env: "local", publicUrl: "https://neon1.tech", operatorEmails: [OP], devAuth: true },
    repo,
    directory: new MemoryDirectory(),
    mailer,
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
