// apps/api/src/integrity.test.ts - Business records that must survive races and failures: approved
// terms, the last-admin rule, and project creation. Memory table, synthetic data, dev identities.


import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";
import type { WriteOp } from "./store/types.ts";


// A signed approval or acceptance: the typed name and the consent box
const SIGN = { typedName: "Raj Patel", consent: true };


const OP = "pradeep@neon1.tech";
let table: MemoryTable;
let repo: Repo;
let app: ReturnType<typeof createApp>;
let s: Awaited<ReturnType<typeof seed>>;


// Fresh store and app per test
beforeEach(async () => {
  table = new MemoryTable();
  repo = new Repo(table);
  s = await seed(repo, OP);
  app = createApp({ cfg: { env: "local", publicUrl: "https://example.invalid", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer: new MemoryMailer(), texter: new MemoryTexter(), storage: new MemoryStorage() });
});


/** Call the API as a seeded person */
async function call(as: string, method: string, path: string, body?: unknown) {
  const r = await app.request(`/1NEON/api${path}`, { method, headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}

/** FLOW-1 and its first option, as seeded */
async function flowOption() {
  const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
  const option = (await repo.listItems(p.tenantId, p.id)).find((i) => i.kind === "option")!;
  return { p, option, path: `/t/${p.tenantId}/projects/${p.id}` };
}


// PORT-03: what was approved stays exactly as approved
describe("approved terms", () => {
  it("lets only neon1 add, change, share, withdraw, or remove an option; the client approves", async () => {
    const { option, path } = await flowOption();
    expect((await call(s.dana.email, "POST", `${path}/items`, { kind: "option", title: "Our own plan" })).status).toBe(403);
    expect((await call(s.raj.email, "PATCH", `${path}/items/${option.id}`, { version: option.version, status: "draft" })).status).toBe(403);
    expect((await call(s.raj.email, "PATCH", `${path}/items/${option.id}`, { version: option.version, fields: { cost: "$1" } })).status).toBe(403);
    expect((await call(s.raj.email, "DELETE", `${path}/items/${option.id}?version=${option.version}`)).status).toBe(403);
    expect((await call(OP, "PATCH", `${path}/items/${option.id}`, { version: option.version, status: "draft" })).status).toBe(200);
  });

  it("lets a client admin manage their people, but only neon1 changes neon1's own membership", async () => {
    await call(OP, "POST", `/t/${s.acme.id}/members/invite`, { people: [{ email: OP, access: "admin" }] });
    const lead = (await call(s.raj.email, "GET", `/t/${s.acme.id}/members`)).json.find((m: { email: string }) => m.email === OP);
    expect(lead.neon1).toBe(true);
    const tried = await call(s.raj.email, "PATCH", `/t/${s.acme.id}/members/${lead.userId}`, { version: lead.version, status: "deactivated" });
    expect([tried.status, tried.json.error]).toEqual([403, "neon1_only"]);
    expect((await call(OP, "PATCH", `/t/${s.acme.id}/members/${lead.userId}`, { version: lead.version, access: "editor" })).status).toBe(200);
  });

  it("copies the terms into the decision and keeps the approved option from changing or disappearing", async () => {
    const { option, path, p } = await flowOption();
    const approved = await call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: SIGN });
    expect(approved.status).toBe(201);
    const terms = approved.json.decision.fields.terms;
    expect(terms.title).toBe(option.title);
    expect(terms.cost).toBe(String(option.fields.cost ?? ""));
    expect(approved.json.decision.fields.approverEmail).toBe(s.raj.email);
    const v = approved.json.option.version;
    expect((await call(OP, "PATCH", `${path}/items/${option.id}`, { version: v, body: "Different scope", fields: { cost: "$999999" } })).status).toBe(400);
    expect((await call(OP, "PATCH", `${path}/items/${option.id}`, { version: v, title: "Renamed" })).status).toBe(400);
    expect((await call(OP, "DELETE", `${path}/items/${option.id}?version=${v}`)).status).toBe(400);
    expect(await repo.getItem(p.tenantId, p.id, option.id)).toBeDefined();
    const decision = await repo.getItem(p.tenantId, p.id, approved.json.decision.id);
    expect(decision!.fields.terms).toEqual(terms);
  });

  it("approves a new option as a new decision that marks the earlier one replaced, which keeps its terms", async () => {
    const { option, path, p } = await flowOption();
    const first = await call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: SIGN });
    const next = await call(OP, "POST", `${path}/items`, { kind: "option", title: "Revised plan", status: "proposed", fields: { cost: "$2,000" } });
    expect(next.status).toBe(201);
    // A new option is approved from the next revision, which neon1 issues
    expect((await call(OP, "POST", `${path}/proposals`, { note: "Adds a revised plan" })).status).toBe(201);
    const second = await call(s.raj.email, "POST", `${path}/items/${next.json.id}/approve`, { version: next.json.version, signature: SIGN });
    expect(second.status).toBe(201);
    expect(second.json.decision.fields.supersedes).toEqual([first.json.decision.id]);
    expect((await repo.getItem(p.tenantId, p.id, first.json.decision.id))!.fields.terms).toEqual(first.json.decision.fields.terms);
  });

  it("gives one consistent result when an edit and an approval race", async () => {
    const { option, path, p } = await flowOption();
    const [edit, approve] = await Promise.all([
      call(OP, "PATCH", `${path}/items/${option.id}`, { version: option.version, fields: { cost: "$1" } }),
      call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: SIGN }),
    ]);
    const stored = (await repo.getItem(p.tenantId, p.id, option.id))!;
    const decisions = (await repo.listItems(p.tenantId, p.id)).filter((i) => i.kind === "decision");
    if (approve.status === 201) {
      expect(edit.status).toBe(409);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.fields.terms).toMatchObject({ cost: String(option.fields.cost ?? "") });
    } else {
      expect(edit.status).toBe(200);
      expect(decisions).toHaveLength(0);
      expect(stored.fields.cost).toBe("$1");
    }
  });
});


/** Leave exactly two active admins in Acme (Dana promoted, any others demoted one at a time) */
async function twoAdmins() {
  const dana = (await repo.getMember(s.acme.id, s.dana.id))!;
  if (dana.access !== "admin") expect((await call(OP, "PATCH", `/t/${s.acme.id}/members/${s.dana.id}`, { version: dana.version, access: "admin" })).status).toBe(200);
  let admins = (await repo.listMembers(s.acme.id)).filter((m) => m.access === "admin" && m.status !== "deactivated");
  for (const extra of admins.filter((m) => m.userId !== s.dana.id).slice(1)) {
    expect((await call(OP, "PATCH", `/t/${s.acme.id}/members/${extra.userId}`, { version: extra.version, access: "editor" })).status).toBe(200);
  }
  admins = (await repo.listMembers(s.acme.id)).filter((m) => m.access === "admin" && m.status !== "deactivated");
  expect(admins).toHaveLength(2);
  return admins;
}


// PORT-07: an organization never ends up without an admin
describe("last admin", () => {
  it("refuses one of two simultaneous demotions of the last two admins", async () => {
    // Exactly two admins, both demoted at once
    const admins = await twoAdmins();
    const replies = await Promise.all(admins.map((m) => call(OP, "PATCH", `/t/${s.acme.id}/members/${m.userId}`, { version: m.version, access: "editor" })));
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await repo.listMembers(s.acme.id)).filter((m) => m.access === "admin" && m.status !== "deactivated")).toHaveLength(1);
    // And the survivor can't be demoted or deactivated
    const last = (await repo.listMembers(s.acme.id)).find((m) => m.access === "admin")!;
    expect((await call(OP, "PATCH", `/t/${s.acme.id}/members/${last.userId}`, { version: last.version, status: "deactivated" })).json.error).toBe("last_admin");
  });

  it("refuses a demotion that races a deactivation of the other admin", async () => {
    const [a, b] = await twoAdmins();
    const replies = await Promise.all([
      call(OP, "PATCH", `/t/${s.acme.id}/members/${a!.userId}`, { version: a!.version, status: "deactivated" }),
      call(OP, "PATCH", `/t/${s.acme.id}/members/${b!.userId}`, { version: b!.version, access: "viewer" }),
    ]);
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await repo.listMembers(s.acme.id)).filter((m) => m.access === "admin" && m.status !== "deactivated")).toHaveLength(1);
  });
});


// PORT-08: a project and its starter items exist together or not at all, once per request
describe("project creation", () => {
  const largest = { name: "Synthetic migration", template: "cloud_migration", example: "Today we copy files by hand.", metrics: Array.from({ length: 10 }, (_, i) => ({ title: `Measure ${i + 1}` })) };

  it("fits the largest template, an example, and ten measures in one write", async () => {
    const writes: WriteOp[][] = [];
    const real = table.write.bind(table);
    table.write = async (ops) => { writes.push(ops); return real(ops); };
    const r = await call(s.raj.email, "POST", `/t/${s.acme.id}/projects`, largest);
    expect(r.status).toBe(201);
    const created = writes.find((ops) => ops.some((o) => "put" in o && o.put.type === "project"))!;
    expect(created.length).toBeLessThanOrEqual(100);
    expect(created.filter((o) => "put" in o && o.put.type === "item")).toHaveLength(14 + 1 + 10);
    expect(await repo.listItems(s.acme.id, r.json.id)).toHaveLength(25);
  });

  it("leaves no project when any part of the write fails", async () => {
    const real = table.write.bind(table);
    table.write = async (ops) => {
      if (ops.some((o) => "put" in o && o.put.type === "item")) throw new Error("synthetic write failure");
      return real(ops);
    };
    const r = await call(s.raj.email, "POST", `/t/${s.acme.id}/projects`, largest);
    expect(r.status).toBe(500);
    expect((await repo.listProjects(s.acme.id)).some((p) => p.name === largest.name)).toBe(false);
  });

  it("returns the same project for a retried request key, sequentially and concurrently", async () => {
    const body = { ...largest, idempotencyKey: "synthetic-key-0001" };
    const first = await call(s.raj.email, "POST", `/t/${s.acme.id}/projects`, body);
    const again = await call(s.raj.email, "POST", `/t/${s.acme.id}/projects`, body);
    expect(again.json.id).toBe(first.json.id);
    const both = await Promise.all([1, 2].map(() => call(s.raj.email, "POST", `/t/${s.acme.id}/projects`, { ...body, idempotencyKey: "synthetic-key-0002" })));
    expect(both[0]!.json.id).toBe(both[1]!.json.id);
    const made = (await repo.listProjects(s.acme.id)).filter((p) => p.name === largest.name);
    expect(made).toHaveLength(2);
    for (const p of made) expect(await repo.listItems(s.acme.id, p.id)).toHaveLength(25);
    // Another person can't reuse someone's key to read their project
    expect((await call(s.dana.email, "POST", `/t/${s.acme.id}/projects`, body)).status).toBe(409);
  });
});
