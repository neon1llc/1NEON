// apps/api/src/quickfix.test.ts - The quick fix path: a project made from the quick_fix template, quoted
// and issued by neon1 in one step, approved with one signature and nothing up front, and closed by
// accepting its one handover step, which drafts the final invoice at the quoted (or capped) amount.
// Every check of the full flow still applies, and projects of other templates behave as before.


import { AGREEMENT_EDITION, DEFAULT_STAGES, InvoiceFields, revisions, templateById, type Item } from "@1neon/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";


// Raj signs as himself; he's an admin of Acme, which has no decision maker named on new projects
const SIGN = { typedName: "Raj Patel", consent: true };
const OP = "pradeep@neon1.tech";
let repo: Repo;
let mailer: MemoryMailer;
let app: ReturnType<typeof createApp>;
let s: Awaited<ReturnType<typeof seed>>;

// Fresh store and app per test
beforeEach(async () => {
  repo = new Repo(new MemoryTable());
  s = await seed(repo, OP);
  mailer = new MemoryMailer();
  app = createApp({ cfg: { env: "local", publicUrl: "https://example.invalid", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer, texter: new MemoryTexter(), storage: new MemoryStorage() });
});

/** Call the API as a seeded person */
async function call(as: string, method: string, path: string, body?: unknown) {
  const r = await app.request(`/1NEON/api${path}`, { method, headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}

/** A new project in Acme from a template, with its path and starter items */
async function create(template: string, name = "Printer won't print from the front desk") {
  const r = await call(OP, "POST", `/t/${s.acme.id}/projects`, { name, template });
  expect(r.status).toBe(201);
  const path = `/t/${s.acme.id}/projects/${r.json.id}`;
  const items = (await call(OP, "GET", path)).json.items as Item[];
  return { p: r.json, path, items };
}

/** Everything on the project now, as neon1 sees it (drafts included) */
const itemsOf = async (path: string) => (await call(OP, "GET", path)).json.items as Item[];

// An hourly quote: $150 an hour, 2 to 5 hours
const HOURLY = { title: "Fix the front desk printer", body: "Reinstall the driver and set the printer up again on the office network.", pricing: "estimate", rateCents: 15_000, hoursLow: 2, hoursHigh: 5, timeline: "This week" };


describe("a quick fix project", () => {
  it("starts with one quote, nothing up front, and one handover step", async () => {
    const { p, items } = await create("quick_fix");
    expect(p.key).toBe("FIX-1");
    expect(p.template).toBe("quick_fix");
    // No discovery questions: only the quote and the step
    expect(items.map((i) => [i.kind, i.title, i.status])).toEqual([["option", "The fix", "draft"], ["handoff", "Fixed and shown working", "open"]]);
    expect(items[0]!.fields).toMatchObject({ pricing: "estimate", hoursLow: 2, hoursHigh: 5, depositPercent: 0 });
  });

  it("is quoted and issued by neon1 in one step, and moves to Decide", async () => {
    const { path, items } = await create("quick_fix");
    // Only neon1 writes a quote; the client and their editors can't
    expect((await call(s.raj.email, "POST", `${path}/quote`, HOURLY)).status).toBe(403);
    expect((await call(s.dana.email, "POST", `${path}/quote`, HOURLY)).status).toBe(403);
    const r = await call(OP, "POST", `${path}/quote`, { ...HOURLY, version: items[0]!.version });
    expect(r.status).toBe(201);
    expect(r.json.option).toMatchObject({ id: items[0]!.id, status: "proposed", title: HOURLY.title });
    expect(r.json.option.fields).toMatchObject({ cost: "$300 to $750 estimate", hours: "2 to 5 hours", depositPercent: 0, rateCents: 15_000 });
    expect(r.json.issued.title).toMatch(/^Proposal \d{4}-r1$/);
    expect(r.json.project.stageId).toBe("decide");
    const after = await itemsOf(path);
    const rev = revisions(after).at(-1)!;
    expect(rev.p.snapshot.options.map((o) => [o.id, o.version])).toEqual([[items[0]!.id, items[0]!.version + 1]]);
    // A quote changed before it's approved is the next revision, the earlier one kept as replaced
    const again = await call(OP, "POST", `${path}/quote`, { ...HOURLY, pricing: "fixed", priceCents: 45_000, note: "A fixed price instead" });
    expect(again.json.issued.title).toMatch(/-r2$/);
    expect(again.json.option.fields).toMatchObject({ cost: "$450 fixed", pricing: "fixed", depositPercent: 0 });
    expect(again.json.option.fields.rateCents).toBeUndefined();
    expect(revisions(await itemsOf(path)).map((x) => x.status)).toEqual(["superseded", "issued"]);
  });

  it("refuses a quote without a price, or past a quick fix's hours", async () => {
    const { path } = await create("quick_fix");
    expect((await call(OP, "POST", `${path}/quote`, { ...HOURLY, rateCents: undefined })).status).toBe(400);
    expect((await call(OP, "POST", `${path}/quote`, { pricing: "fixed" })).status).toBe(400);
    expect((await call(OP, "POST", `${path}/quote`, { ...HOURLY, hoursLow: 6, hoursHigh: 5 })).status).toBe(400);
    expect((await call(OP, "POST", `${path}/quote`, { ...HOURLY, hoursHigh: 40 })).status).toBe(400);
    // Nothing was shared or issued by the refusals
    expect(revisions(await itemsOf(path))).toHaveLength(0);
  });

  it("is approved with one signature, records the decision, and drafts no deposit", async () => {
    const { path } = await create("quick_fix");
    const { option } = (await call(OP, "POST", `${path}/quote`, HOURLY)).json;
    const r = await call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: SIGN });
    expect(r.status).toBe(201);
    expect(r.json.decision.fields.terms).toMatchObject({ pricing: "estimate", rateCents: 15_000, hoursLow: 2, hoursHigh: 5, depositPercent: 0 });
    expect(r.json.decision.fields.signature).toMatchObject({ doc: "approval", typedName: "Raj Patel" });
    expect(r.json.decision.fields.signature.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await itemsOf(path)).filter((i) => i.kind === "invoice")).toEqual([]);
    // Approved terms are a record: the quote can't be rewritten afterwards
    expect((await call(OP, "POST", `${path}/quote`, HOURLY)).json.error).toBe("decided");
    const audit = await repo.listAudit(s.acme.id);
    expect(audit.some((e) => e.action === "decision.approved")).toBe(true);
    expect(audit.some((e) => e.action === "option.quoted")).toBe(true);
  });

  it("drafts the final invoice at the capped hours once the one step is accepted", async () => {
    const { path, items } = await create("quick_fix");
    const step = items.find((i) => i.kind === "handoff")!;
    const { option } = (await call(OP, "POST", `${path}/quote`, HOURLY)).json;
    await call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: SIGN });
    // Six hours logged against a 5-hour high end: the sixth is shown, at no charge
    expect((await call(OP, "POST", `${path}/items`, { kind: "time", title: "Reinstalled the driver and tested", fields: { date: "2026-11-10", hours: 6 } })).status).toBe(201);
    const done = await call(OP, "PATCH", `${path}/items/${step.id}`, { version: step.version, status: "done" });
    expect(done.status).toBe(200);
    const accepted = await call(s.raj.email, "POST", `${path}/items/${step.id}/accept`, { version: done.json.version, note: "Printing again", signature: SIGN });
    expect(accepted.status).toBe(200);
    const invoices = (await itemsOf(path)).filter((i) => i.kind === "invoice");
    expect(invoices.map((i) => [i.fields.type, i.status])).toEqual([["final", "draft"]]);
    const f = InvoiceFields.parse(invoices[0]!.fields);
    expect(f.lines.map((l) => [l.qty, l.unitCents])).toEqual([[5, 15_000], [1, 0]]);
    expect(f.lines.reduce((n, l) => n + l.qty * l.unitCents, 0)).toBe(75_000);
    // The client sees no draft
    expect(((await call(s.raj.email, "GET", path)).json.items as Item[]).some((i) => i.kind === "invoice")).toBe(false);
  });

  it("drafts the final invoice at the fixed price", async () => {
    const { path, items } = await create("quick_fix");
    const step = items.find((i) => i.kind === "handoff")!;
    const { option } = (await call(OP, "POST", `${path}/quote`, { title: "Reset the router", pricing: "fixed", priceCents: 25_000 })).json;
    await call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: SIGN });
    const done = await call(OP, "PATCH", `${path}/items/${step.id}`, { version: step.version, status: "done" });
    // The one-signature handover accepts the one step just the same
    const r = await call(s.raj.email, "POST", `${path}/handover/accept`, { signature: SIGN });
    expect(r.json).toMatchObject({ final: true });
    expect(done.status).toBe(200);
    const inv = (await itemsOf(path)).filter((i) => i.kind === "invoice");
    expect(inv.map((i) => i.fields.type)).toEqual(["final"]);
    expect(InvoiceFields.parse(inv[0]!.fields).lines.map((l) => [l.qty, l.unitCents])).toEqual([[1, 25_000]]);
  });

  it("still waits for the service agreement, signed once", async () => {
    const t = (await repo.getTenant(s.acme.id))!;
    await repo.saveTenant({ ...t, agreements: [], version: t.version + 1 }, t.version);
    const { path } = await create("quick_fix");
    const { option } = (await call(OP, "POST", `${path}/quote`, HOURLY)).json;
    expect((await call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: SIGN })).json.error).toBe("agreement_needed");
    // Unsigned, a typed name that isn't Raj's, or an editor: still refused
    expect((await call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version })).status).toBe(400);
    expect((await call(s.dana.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: { typedName: "Dana Kim", consent: true } })).status).toBe(403);
    expect((await itemsOf(path)).some((i) => i.kind === "decision")).toBe(false);
  });
});


describe("projects of other templates", () => {
  it("can't be quoted, and start and issue exactly as before", async () => {
    const { path, items } = await create("cloud_migration", "Move the file server");
    expect((await call(OP, "POST", `${path}/quote`, HOURLY)).json.error).toBe("not_quick_fix");
    // The example question, then the template's items, all open
    const tpl = templateById("cloud_migration");
    expect(items.map((i) => i.title)).toEqual(["One real example of how it works today", ...tpl.items.map((i) => i.title)]);
    expect(items.every((i) => i.status === "open")).toBe(true);
    // A full project's options and issue are unchanged: share one, issue, approve, deposit drafted
    const opt = (await call(OP, "POST", `${path}/items`, { kind: "option", title: "Lift and shift", status: "proposed", fields: { pricing: "fixed", cost: "$2,000 fixed" } })).json;
    expect((await call(OP, "POST", `${path}/proposals`, {})).status).toBe(201);
    const r = await call(s.raj.email, "POST", `${path}/items/${opt.id}/approve`, { version: opt.version, signature: SIGN });
    expect(r.status).toBe(201);
    expect((await itemsOf(path)).filter((i) => i.kind === "invoice").map((i) => i.fields.type)).toEqual(["deposit"]);
  });

  it("leaves a blank project empty", async () => {
    const { items, p } = await create("blank", "Anything");
    expect(items).toEqual([]);
    expect(p.key).toMatch(/^PRJ-/);
  });
});


/** Acme as a client that hasn't signed neon1's service agreement yet, optionally with stages hidden */
async function firstTimeClient() {
  const t = (await repo.getTenant(s.acme.id))!;
  await repo.saveTenant({ ...t, agreements: [], version: t.version + 1 }, t.version);
}

/** Acme's board with some stages hidden (the agreement stays signed) */
async function hideStages(hide: string[]) {
  const t = (await repo.getTenant(s.acme.id))!;
  await repo.saveTenant({ ...t, stages: t.stages.map((g) => ({ ...g, hidden: hide.includes(g.id) })), version: t.version + 1 }, t.version);
}

/** The project as the board has it now */
const stageOf = async (path: string) => (await call(OP, "GET", path)).json.project.stageId as string;

/** The audit entries of one action, oldest first */
const auditOf = async (action: string) => (await repo.listAudit(s.acme.id)).filter((e) => e.action === action).sort((a, b) => a.at.localeCompare(b.at));

/** A quick fix quoted and issued, ready for the client */
async function quoted() {
  const made = await create("quick_fix");
  const { option } = (await call(OP, "POST", `${made.path}/quote`, HOURLY)).json;
  return { ...made, option, step: made.items.find((i) => i.kind === "handoff")! };
}

/** What the combined dialog does for a first-time client: sign the agreement, then approve */
async function signThenApprove(path: string, option: Item) {
  const a = (await call(s.raj.email, "GET", `/t/${s.acme.id}/agreement`)).json;
  const signed = await call(s.raj.email, "POST", `/t/${s.acme.id}/agreement/sign`, { edition: a.edition, hash: a.hash, typedName: "Raj Patel", consent: true });
  const approved = signed.status === 200 || signed.status === 201 ? await call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: SIGN }) : undefined;
  return { signed, approved };
}


describe("a first-time client approving a quick fix on one screen", () => {
  it("signs the agreement, then approves, as two separate signed records in that order", async () => {
    await firstTimeClient();
    const { path, option } = await quoted();
    const { signed, approved } = await signThenApprove(path, option);
    expect(signed.status).toBeLessThan(300);
    expect(approved!.status).toBe(201);
    const t = (await repo.getTenant(s.acme.id))!;
    expect(t.agreements).toHaveLength(1);
    const agreement = t.agreements![0]!;
    const approval = approved!.json.decision.fields.signature;
    // Two records: different documents, different hashes, each with the typed name
    expect([agreement.doc, approval.doc]).toEqual(["agreement", "approval"]);
    expect(agreement.hash).not.toBe(approval.hash);
    expect([agreement.typedName, approval.typedName]).toEqual(["Raj Patel", "Raj Patel"]);
    expect(agreement.ref).toBe(AGREEMENT_EDITION);
    // The audit trail has the agreement before the approval
    const log = (await repo.listAudit(s.acme.id)).sort((a, b) => a.at.localeCompare(b.at)).map((e) => e.action);
    expect(log.indexOf("agreement.signed")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("agreement.signed")).toBeLessThan(log.indexOf("decision.approved"));
  });

  it("approves nothing when the agreement call fails, and the reason is the API's", async () => {
    await firstTimeClient();
    const { path, option } = await quoted();
    // A stale or wrong edition hash, a name that isn't the profile's, no consent, and an editor: each refused
    const a = (await call(s.raj.email, "GET", `/t/${s.acme.id}/agreement`)).json;
    const sign = { edition: a.edition, hash: a.hash, typedName: "Raj Patel", consent: true };
    expect((await call(s.raj.email, "POST", `/t/${s.acme.id}/agreement/sign`, { ...sign, hash: "0".repeat(64) })).json.error).toBe("agreement_changed");
    expect((await call(s.raj.email, "POST", `/t/${s.acme.id}/agreement/sign`, { ...sign, typedName: "Someone Else" })).status).toBe(400);
    expect((await call(s.raj.email, "POST", `/t/${s.acme.id}/agreement/sign`, { ...sign, consent: false })).status).toBe(400);
    expect((await call(s.dana.email, "POST", `/t/${s.acme.id}/agreement/sign`, sign)).status).toBe(403);
    // With no agreement on record, an approval would be refused too, so a dialog that stops here is safe
    expect((await call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: SIGN })).json.error).toBe("agreement_needed");
    expect((await itemsOf(path)).some((i) => i.kind === "decision")).toBe(false);
    expect((await repo.getTenant(s.acme.id))!.agreements).toEqual([]);
    expect(await stageOf(path)).toBe("decide");
  });

  it("signs the agreement once: the next quick fix goes straight to approval", async () => {
    await firstTimeClient();
    const one = await quoted();
    await signThenApprove(one.path, one.option);
    const two = await quoted();
    expect((await call(s.raj.email, "POST", `${two.path}/items/${two.option.id}/approve`, { version: two.option.version, signature: SIGN })).status).toBe(201);
    expect((await repo.getTenant(s.acme.id))!.agreements).toHaveLength(1);
  });
});


describe("the card follows a quick fix on the board", () => {
  const approve = (path: string, option: Item) => call(s.raj.email, "POST", `${path}/items/${option.id}/approve`, { version: option.version, signature: SIGN });

  it("moves to Build on approval, with the board's own audit entry", async () => {
    const { path, option } = await quoted();
    expect(await stageOf(path)).toBe("decide");
    expect((await approve(path, option)).status).toBe(201);
    expect(await stageOf(path)).toBe("build");
    const moved = (await auditOf("project.moved")).at(-1)!;
    expect(moved.summary).toBe("Moved FIX-1 to Build (quote approved)");
    expect(moved.actorId).toBe(s.raj.id);
    // The project's stage clock restarts and its version moves on
    const p = (await call(OP, "GET", path)).json.project;
    expect(p.version).toBeGreaterThan(1);
  });

  it("skips a hidden Build stage and never moves backward", async () => {
    await hideStages(["build"]);
    const hiddenBuild = await quoted();
    expect((await approve(hiddenBuild.path, hiddenBuild.option)).status).toBe(201);
    // Hidden stages are never entered; the card stays for neon1's own move to the next shown stage
    expect(await stageOf(hiddenBuild.path)).toBe("decide");
    expect((await auditOf("project.moved")).filter((e) => e.summary.includes("Build"))).toHaveLength(0);
    // A card already past Build (neon1 moved it ahead) stays where it is
    await hideStages([]);
    const ahead = await quoted();
    const p = (await call(OP, "GET", ahead.path)).json.project;
    await call(OP, "POST", `${ahead.path}/move`, { version: p.version, stageId: "verify", reason: "work already under way" });
    expect((await approve(ahead.path, ahead.option)).status).toBe(201);
    expect(await stageOf(ahead.path)).toBe("verify");
  });

  it("moves to Hand over when the one step is accepted, never to Closed", async () => {
    const { path, option, step } = await quoted();
    await approve(path, option);
    const done = await call(OP, "PATCH", `${path}/items/${step.id}`, { version: step.version, status: "done" });
    // Ticking the step is neon1's; the card waits for the client's acceptance
    expect(await stageOf(path)).toBe("build");
    const r = await call(s.raj.email, "POST", `${path}/items/${step.id}/accept`, { version: done.json.version, note: "", signature: SIGN });
    expect(r.status).toBe(200);
    expect(await stageOf(path)).toBe("handover");
    expect((await auditOf("project.moved")).at(-1)!.summary).toContain("Hand over");
    expect((await call(OP, "GET", path)).json.project.stageId).not.toBe("closed");
  });

  it("moves to Hand over through the whole-handover route too, and skips it when hidden or behind", async () => {
    const one = await quoted();
    await approve(one.path, one.option);
    await call(OP, "PATCH", `${one.path}/items/${one.step.id}`, { version: one.step.version, status: "done" });
    expect((await call(s.raj.email, "POST", `${one.path}/handover/accept`, { signature: SIGN })).status).toBe(200);
    expect(await stageOf(one.path)).toBe("handover");
    // Hand over hidden: the card stays in Build
    await hideStages(["handover"]);
    const two = await quoted();
    await approve(two.path, two.option);
    await call(OP, "PATCH", `${two.path}/items/${two.step.id}`, { version: two.step.version, status: "done" });
    await call(s.raj.email, "POST", `${two.path}/handover/accept`, { signature: SIGN });
    expect(await stageOf(two.path)).toBe("build");
    // Already in Care (ahead of Hand over): never moved backward
    await hideStages([]);
    const three = await quoted();
    await approve(three.path, three.option);
    const p = (await call(OP, "GET", three.path)).json.project;
    await call(OP, "POST", `${three.path}/move`, { version: p.version, stageId: "care" });
    await call(OP, "PATCH", `${three.path}/items/${three.step.id}`, { version: three.step.version, status: "done" });
    await call(s.raj.email, "POST", `${three.path}/handover/accept`, { signature: SIGN });
    expect(await stageOf(three.path)).toBe("care");
  });

  it("leaves every other template's card exactly where it was", async () => {
    const { path } = await create("cloud_migration", "Move the file server");
    const opt = (await call(OP, "POST", `${path}/items`, { kind: "option", title: "Lift and shift", status: "proposed", fields: { pricing: "fixed", cost: "$2,000 fixed" } })).json;
    await call(OP, "POST", `${path}/proposals`, {});
    const before = await stageOf(path);
    expect((await call(s.raj.email, "POST", `${path}/items/${opt.id}/approve`, { version: opt.version, signature: SIGN })).status).toBe(201);
    expect(await stageOf(path)).toBe(before);
    // Accepting the handover doesn't move it either
    const items = await itemsOf(path);
    const step = await call(OP, "POST", `${path}/items`, { kind: "handoff", title: "Shown working" });
    const done = await call(OP, "PATCH", `${path}/items/${step.json.id}`, { version: step.json.version, status: "done" });
    for (const h of items.filter((i) => i.kind === "handoff")) await call(OP, "PATCH", `${path}/items/${h.id}`, { version: h.version, status: "done" });
    expect(done.status).toBe(200);
    await call(s.raj.email, "POST", `${path}/handover/accept`, { signature: SIGN });
    expect(await stageOf(path)).toBe(before);
    expect((await auditOf("project.moved")).filter((e) => e.summary.includes("FLOW") || e.summary.includes("Hand over") || e.summary.includes("Build"))).toHaveLength(0);
  });
});


describe("notices on a quick fix say Quote, and the record keeps Proposal", () => {
  it("rewords the bell and the email only, for the project's template", async () => {
    const quick = await quoted();
    const full = await create("cloud_migration", "Move the file server");
    await call(OP, "POST", `${full.path}/items`, { kind: "option", title: "Lift and shift", status: "proposed", fields: { pricing: "fixed", cost: "$2,000 fixed" } });
    await call(OP, "POST", `${full.path}/proposals`, {});
    // The stored audit entries, and the issued item's title, keep "Proposal NNNN-rN"
    const stored = (await auditOf("proposal.issued")).filter((e) => e.summary.startsWith("FIX-1:") || e.summary.startsWith(`${full.p.key}:`));
    expect(stored).toHaveLength(2);
    expect(stored.every((e) => /issued Proposal \d{4}-r1/.test(e.summary))).toBe(true);
    expect(revisions(await itemsOf(quick.path)).at(-1)!.title).toMatch(/^Proposal \d{4}-r1$/);
    // The bell: the quick fix's notice says Quote with the same number; the full project's is unchanged
    const bell = (await call(s.raj.email, "GET", `/t/${s.acme.id}/notifications`)).json.events as { action: string; summary: string }[];
    const issued = bell.filter((e) => e.action === "proposal.issued");
    const qn = issued.find((e) => e.summary.startsWith("FIX-1"))!;
    const fn = issued.find((e) => !e.summary.startsWith("FIX-1"))!;
    expect(qn.summary).toMatch(/^FIX-1: issued Quote \d{4}-r1$/);
    expect(fn.summary).toMatch(/issued Proposal \d{4}-r1/);
    expect(stored.find((e) => e.summary.startsWith("FIX-1"))!.summary.replace("Proposal", "Quote")).toBe(qn.summary);
    // The email: subject and body say Quote for the quick fix, Proposal for the other
    const mails = mailer.sent.filter((m) => m.to === s.raj.email);
    expect(mails.some((m) => /issued Quote \d{4}-r1/.test(m.subject) && !/Proposal/.test(m.subject + m.text))).toBe(true);
    expect(mails.some((m) => /issued Proposal \d{4}-r1/.test(m.subject))).toBe(true);
  });
});
