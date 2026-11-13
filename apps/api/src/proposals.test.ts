// apps/api/src/proposals.test.ts - Proposal revisions, approval from an issued revision, the price
// check, purchases with their agreement and receipts, and handover acceptance.


import { ProposalFields, revisions } from "@1neon/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";


// A signed approval or acceptance: the typed name and the consent box
const SIGN = { typedName: "Raj Patel", consent: true };


const OP = "pradeep@neon1.tech";
let repo: Repo;
let app: ReturnType<typeof createApp>;
let s: Awaited<ReturnType<typeof seed>>;

// Fresh store and app per test
beforeEach(async () => {
  repo = new Repo(new MemoryTable());
  s = await seed(repo, OP);
  app = createApp({ cfg: { env: "local", publicUrl: "https://example.invalid", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer: new MemoryMailer(), texter: new MemoryTexter(), storage: new MemoryStorage() });
});

/** Call the API as a seeded person */
async function call(as: string, method: string, path: string, body?: unknown) {
  const r = await app.request(`/1NEON/api${path}`, { method, headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}

/** FLOW-1, its items, and its API path */
async function flow() {
  const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
  const items = await repo.listItems(p.tenantId, p.id);
  const opt = (letter: string) => items.find((i) => i.kind === "option" && i.title.startsWith(`${letter}.`))!;
  return { p, items, opt, path: `/t/${p.tenantId}/projects/${p.id}` };
}


describe("proposal revisions", () => {
  it("numbers the first proposal 0039 and gives every option an ID in the revision", async () => {
    const { items } = await flow();
    const r1 = revisions(items).at(-1)!;
    expect(r1.title).toBe("Proposal 0039-r1");
    expect(r1.p.snapshot.options.map((o) => o.code)).toEqual(["0039-r1-A", "0039-r1-B", "0039-r1-C"]);
    expect(r1.p.snapshot.constraints[0]!.title).toMatch(/after 6pm/);
    expect(r1.p.snapshot.preparedFor?.name).toBe("Raj Patel");
  });

  it("lets only neon1 issue, keeps the number, replaces the earlier revision, and never edits or deletes one", async () => {
    const { path } = await flow();
    expect((await call(s.raj.email, "POST", `${path}/proposals`, {})).status).toBe(403);
    const r2 = await call(OP, "POST", `${path}/proposals`, { note: "Prices rechecked" });
    expect(r2.status).toBe(201);
    expect(r2.json.title).toBe("Proposal 0039-r2");
    const { items } = await flow();
    expect(revisions(items).map((r) => r.status)).toEqual(["superseded", "issued"]);
    expect((await call(OP, "PATCH", `${path}/items/${r2.json.id}`, { version: 1, title: "x" })).status).toBe(400);
    expect((await call(OP, "DELETE", `${path}/items/${r2.json.id}?version=1`)).status).toBe(400);
    expect((await call(OP, "POST", `${path}/items`, { kind: "proposal", title: "Made up" })).status).toBe(400);
  });

  it("gives the next project's proposal the next number", async () => {
    const p = (await call(OP, "POST", `/t/${s.acme.id}/projects`, { name: "Second" })).json;
    const path = `/t/${s.acme.id}/projects/${p.id}`;
    expect((await call(OP, "POST", `${path}/proposals`, {})).json.error).toBe("no_options");
    await call(OP, "POST", `${path}/items`, { kind: "option", title: "Only option", status: "proposed" });
    expect((await call(OP, "POST", `${path}/proposals`, {})).json.title).toBe("Proposal 0040-r1");
  });

  it("names the option's ID on the decision, and waits for a new revision when the option changed after issue", async () => {
    const { opt, path } = await flow();
    const a = opt("A");
    const edited = await call(OP, "PATCH", `${path}/items/${a.id}`, { version: a.version, fields: { pricing: "fixed", cost: "$950 fixed" } });
    expect((await call(s.raj.email, "POST", `${path}/items/${a.id}/approve`, { version: edited.json.version, signature: SIGN })).json.error).toBe("changed_since_issue");
    await call(OP, "POST", `${path}/proposals`, { note: "A's price changed" });
    const ok = await call(s.raj.email, "POST", `${path}/items/${a.id}/approve`, { version: edited.json.version, signature: SIGN });
    expect(ok.status).toBe(201);
    expect(ok.json.decision.fields.code).toBe("0039-r2-A");
    expect(ok.json.decision.fields.terms.cost).toBe("$950 fixed");
  });

  it("holds approval past the price check until neon1 refreshes, and records the client's ask once", async () => {
    const { p, items, opt, path } = await flow();
    const r1 = revisions(items).at(-1)!;
    const raw = items.find((i) => i.id === r1.id)!;
    await repo.saveItem({ ...raw, fields: { ...ProposalFields.parse(raw.fields), checkBy: "2020-01-01" }, version: raw.version + 1 }, { version: raw.version });
    const b = opt("B");
    expect((await call(s.raj.email, "POST", `${path}/items/${b.id}/approve`, { version: b.version, signature: SIGN })).json.error).toBe("price_check");
    expect((await call(s.dana.email, "POST", `${path}/proposals/${r1.id}/refresh`, {})).status).toBe(403);
    const asked = await call(s.raj.email, "POST", `${path}/proposals/${r1.id}/refresh`, {});
    expect(asked.json.fields.refreshAsked.name).toBe("Raj Patel");
    expect((await repo.listAudit(p.tenantId)).some((e) => e.action === "proposal.refresh_asked")).toBe(true);
    await call(OP, "POST", `${path}/proposals`, { note: "Prices rechecked; no changes" });
    expect((await call(s.raj.email, "POST", `${path}/items/${b.id}/approve`, { version: b.version, signature: SIGN })).status).toBe(201);
  });
});


describe("purchases", () => {
  it("adds the approved option's purchases to Execute, once, marked with the option's ID", async () => {
    const { opt, path } = await flow();
    const b = opt("B");
    const r = await call(s.raj.email, "POST", `${path}/items/${b.id}/approve`, { version: b.version, signature: SIGN });
    expect(r.json.purchases.map((x: { title: string; fields: { from: string; buyer: string } }) => [x.title, x.fields.from, x.fields.buyer])).toEqual([["Document scanner for the front desk", "0039-r1-B", "client"]]);
    // A receipt is a file on the purchase
    const doc = await call(s.dana.email, "POST", `/t/${s.acme.id}/docs`, { name: "receipt.pdf", contentType: "application/pdf", size: 10, layer: "execution", projectId: r.json.purchases[0].projectId, itemId: r.json.purchases[0].id });
    expect(doc.status).toBe(201);
  });

  it("needs the approver's signature when neon1 buys, takes its initials,, and blocks buying without them", async () => {
    const { opt, path } = await flow();
    const c = opt("C");
    const lines = [{ name: "Label printer", estimate: "$120", buyer: "neon1" }];
    const v = (await call(OP, "PATCH", `${path}/items/${c.id}`, { version: c.version, fields: { purchases: lines } })).json.version;
    await call(OP, "POST", `${path}/proposals`, { note: "C adds a label printer neon1 buys" });
    // Unsigned, nothing is approved; the signature's initials go on each purchase neon1 buys
    expect((await call(s.raj.email, "POST", `${path}/items/${c.id}/approve`, { version: v })).status).toBe(400);
    const r = await call(s.raj.email, "POST", `${path}/items/${c.id}/approve`, { version: v, signature: SIGN });
    expect(r.status).toBe(201);
    expect(r.json.decision.fields.initials).toBe("RP");
    expect(r.json.purchases[0].fields.agreed.initials).toBe("RP");
    // An item added later for neon1 to buy waits for the client's own initials
    const extra = (await call(OP, "POST", `${path}/items`, { kind: "purchase", title: "Spare cable", fields: { buyer: "neon1", agreed: { by: "x", name: "x", initials: "XX", at: new Date().toISOString() } } })).json;
    expect(extra.fields.agreed).toBeUndefined();
    expect((await call(OP, "PATCH", `${path}/items/${extra.id}`, { version: extra.version, status: "bought" })).json.error).toBe("needs_agreement");
    expect((await call(s.dana.email, "POST", `${path}/items/${extra.id}/agree`, { version: extra.version, initials: "DK" })).status).toBe(403);
    const agreed = await call(s.raj.email, "POST", `${path}/items/${extra.id}/agree`, { version: extra.version, initials: "RP" });
    expect(agreed.json.fields.agreed.initials).toBe("RP");
    expect((await call(OP, "PATCH", `${path}/items/${extra.id}`, { version: agreed.json.version, status: "bought", fields: { actual: "$9.99", vendor: "Micro Center" } })).status).toBe(200);
  });
});


describe("handover acceptance", () => {
  it("records the decision maker accepting a handover step, and nobody else", async () => {
    const { items, path } = await flow();
    const h = items.find((i) => i.kind === "handoff")!;
    expect((await call(s.dana.email, "POST", `${path}/items/${h.id}/accept`, { version: h.version, signature: SIGN })).status).toBe(403);
    const r = await call(s.raj.email, "POST", `${path}/items/${h.id}/accept`, { version: h.version, note: "Checked the logins", signature: SIGN });
    expect(r.json.status).toBe("done");
    expect(r.json.fields.accepted).toMatchObject({ name: "Raj Patel", note: "Checked the logins" });
    // An edit can't forge or clear an acceptance
    const e = await call(OP, "PATCH", `${path}/items/${h.id}`, { version: r.json.version, fields: { accepted: { by: "x", name: "Someone", at: new Date().toISOString(), note: "" } } });
    expect(e.json.fields.accepted.name).toBe("Raj Patel");
  });
});
