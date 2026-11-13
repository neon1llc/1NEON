// apps/api/src/billing.test.ts - The service agreement, signed approvals, invoices from draft to paid,
// credits and voids, Stripe Checkout and its webhook, and the locked copies kept of each record.


import { AGREEMENT_EDITION, AGREEMENT_TEXT, sha256Hex } from "@1neon/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { MemoryPayments, MemoryRecords } from "./payments.ts";
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
let payments: MemoryPayments | undefined;
let records: MemoryRecords;

/** A fresh store and app; `online` adds Stripe (in memory) */
async function start(online = true) {
  repo = new Repo(new MemoryTable());
  s = await seed(repo, OP);
  payments = online ? new MemoryPayments() : undefined;
  records = new MemoryRecords();
  app = createApp({ cfg: { env: "local", publicUrl: "https://example.invalid", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer: new MemoryMailer(), texter: new MemoryTexter(), storage: new MemoryStorage(), payments, records });
}
beforeEach(() => start());

/** Call the API as a seeded person */
async function call(as: string, method: string, path: string, body?: unknown) {
  const r = await app.request(`/1NEON/api${path}`, { method, headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}

/** FLOW-1, an option by letter, and its API path */
async function flow() {
  const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
  const items = await repo.listItems(p.tenantId, p.id);
  const opt = (letter: string) => items.find((i) => i.kind === "option" && i.title.startsWith(`${letter}.`))!;
  return { p, items, opt, path: `/t/${p.tenantId}/projects/${p.id}` };
}

/** Approve option B ($4,500 fixed) and return the deposit draft neon1 gets */
async function approveB() {
  const { opt, path } = await flow();
  const b = opt("B");
  const r = await call(s.raj.email, "POST", `${path}/items/${b.id}/approve`, { version: b.version, signature: SIGN });
  expect(r.status).toBe(201);
  const { items } = await flow();
  return { decision: r.json.decision, draft: items.find((i) => i.kind === "invoice")!, path };
}

/** Approve B and issue its deposit */
async function issuedDeposit() {
  const { draft, path } = await approveB();
  const r = await call(OP, "POST", `${path}/invoices/${draft.id}/issue`, { version: draft.version });
  expect(r.status).toBe(200);
  return { inv: r.json, path };
}


describe("the service agreement", () => {
  it("is signed once by a client admin, against the text they were shown, before any approval", async () => {
    // Start Acme unsigned
    const t = (await repo.getTenant(s.acme.id))!;
    await repo.saveTenant({ ...t, agreements: [], version: t.version + 1 }, t.version);
    const { opt, path } = await flow();
    const b = opt("B");
    expect((await call(s.raj.email, "POST", `${path}/items/${b.id}/approve`, { version: b.version, signature: SIGN })).json.error).toBe("agreement_needed");

    const got = await call(s.dana.email, "GET", `/t/${s.acme.id}/agreement`);
    expect(got.json.edition).toBe(AGREEMENT_EDITION);
    expect(got.json.hash).toBe(await sha256Hex(AGREEMENT_TEXT));
    expect(got.json.signed).toBeUndefined();
    const hash = got.json.hash as string;
    const sign = { typedName: "Raj Patel", consent: true, edition: AGREEMENT_EDITION, hash };
    // Editors and neon1 don't sign for the client; the consent box must be ticked; a changed text is refused
    expect((await call(s.dana.email, "POST", `/t/${s.acme.id}/agreement/sign`, sign)).status).toBe(403);
    expect((await call(OP, "POST", `/t/${s.acme.id}/agreement/sign`, sign)).status).toBe(403);
    expect((await call(s.raj.email, "POST", `/t/${s.acme.id}/agreement/sign`, { ...sign, consent: false })).status).toBe(400);
    expect((await call(s.raj.email, "POST", `/t/${s.acme.id}/agreement/sign`, { ...sign, hash: "0".repeat(64) })).json.error).toBe("agreement_changed");

    const ok = await call(s.raj.email, "POST", `/t/${s.acme.id}/agreement/sign`, sign);
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ doc: "agreement", ref: AGREEMENT_EDITION, hash, typedName: "Raj Patel", email: s.raj.email });
    // Signing again returns the same signature
    expect((await call(s.raj.email, "POST", `/t/${s.acme.id}/agreement/sign`, sign)).json.at).toBe(ok.json.at);
    expect([...records.saved.keys()].some((k) => k.startsWith(`t/${s.acme.id}/agreement/`))).toBe(true);
    expect((await call(s.raj.email, "POST", `${path}/items/${b.id}/approve`, { version: b.version, signature: SIGN })).status).toBe(201);
  });
});


describe("signed approvals", () => {
  it("records the signature over a hash of the terms, keeps a copy, and drafts the deposit only for neon1", async () => {
    const { decision, draft, path } = await approveB();
    expect(decision.fields.signature).toMatchObject({ doc: "approval", ref: "0039-r1-B", typedName: "Raj Patel" });
    expect(decision.fields.signature.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(records.saved.has(`t/${s.acme.id}/p/${decision.projectId}/decisions/${decision.id}.json`)).toBe(true);
    expect(draft).toMatchObject({ status: "draft", fields: { type: "deposit", lines: [{ unitCents: 225_000, ref: decision.id }] } });
    // The client doesn't see neon1's draft; neon1 does
    expect((await call(s.raj.email, "GET", path)).json.items.some((i: { kind: string }) => i.kind === "invoice")).toBe(false);
    expect((await call(OP, "GET", path)).json.items.some((i: { kind: string }) => i.kind === "invoice")).toBe(true);
  });

  it("tells the client when an invoice is issued, never about neon1's drafts", async () => {
    const { draft, path } = await approveB();
    await call(OP, "POST", `${path}/invoices`, { type: "progress", lines: [{ text: "Week one", unitCents: 50_000 }] });
    const feed = async () => (await call(s.raj.email, "GET", `/t/${s.acme.id}/notifications`)).json.events.map((e: { action: string }) => e.action);
    expect(await feed()).not.toContain("invoice.drafted");
    await call(OP, "POST", `${path}/invoices/${draft.id}/issue`, { version: draft.version });
    expect(await feed()).toContain("invoice.issued");
  });

  it("drafts no deposit when the price isn't fixed", async () => {
    const { opt, path } = await flow();
    const c = opt("C");
    await call(OP, "PATCH", `${path}/items/${c.id}`, { version: c.version, fields: { cost: "$1,000 time and materials" } });
    await call(OP, "POST", `${path}/proposals`, {});
    const fresh = (await flow()).opt("C");
    expect((await call(s.raj.email, "POST", `${path}/items/${fresh.id}/approve`, { version: fresh.version, signature: SIGN })).status).toBe(201);
    expect((await flow()).items.some((i) => i.kind === "invoice")).toBe(false);
  });
});


describe("invoices", () => {
  it("lets only neon1 issue, numbers by proposal, addresses the decision maker, and freezes it", async () => {
    const { draft, path } = await approveB();
    expect((await call(s.raj.email, "POST", `${path}/invoices/${draft.id}/issue`, { version: draft.version })).status).toBe(403);
    const edited = await call(OP, "PATCH", `${path}/invoices/${draft.id}`, { version: draft.version, termsDays: 30 });
    const r = await call(OP, "POST", `${path}/invoices/${draft.id}/issue`, { version: edited.json.version });
    expect(r.json).toMatchObject({ title: "Invoice INV-0039-01", status: "issued", fields: { number: "INV-0039-01", termsDays: 30, billTo: { org: "Acme Dental", name: "Raj Patel" } } });
    expect(r.json.fields.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(records.saved.has(`t/${s.acme.id}/p/${draft.projectId}/invoices/INV-0039-01.json`)).toBe(true);
    // Issued: no edits, no deletes, through either route; generic routes never make invoices or payments
    expect((await call(OP, "PATCH", `${path}/invoices/${draft.id}`, { version: r.json.version, termsDays: 5 })).json.error).toBe("immutable");
    expect((await call(OP, "PATCH", `${path}/items/${draft.id}`, { version: r.json.version, title: "x" })).json.error).toBe("immutable");
    expect((await call(OP, "DELETE", `${path}/items/${draft.id}?version=${r.json.version}`)).json.error).toBe("immutable");
    expect((await call(OP, "POST", `${path}/items`, { kind: "invoice", title: "x" })).status).toBe(400);
    expect((await call(OP, "POST", `${path}/items`, { kind: "payment", title: "x" })).status).toBe(400);
    // Now the client sees it
    expect((await call(s.raj.email, "GET", path)).json.items.some((i: { id: string }) => i.id === draft.id)).toBe(true);
  });

  it("takes payments by hand until paid in full, and refuses more than is owed", async () => {
    const { inv, path } = await issuedDeposit();
    const pay = (amountCents: number) => call(OP, "POST", `${path}/invoices/${inv.id}/payments`, { amountCents, method: "check", ref: "1042", receivedAt: "2026-11-12" });
    expect((await call(s.raj.email, "POST", `${path}/invoices/${inv.id}/payments`, { amountCents: 1, method: "check", receivedAt: "2026-11-12" })).status).toBe(403);
    expect((await pay(400_000)).json.error).toBe("too_much");
    expect((await pay(125_000)).json.invoice.status).toBe("issued");
    const last = await pay(100_000);
    expect(last.json.invoice.status).toBe("paid");
    expect((await pay(1)).json.error).toBe("not_open");
  });

  it("voids an unpaid invoice with a reason, and asks for a credit once money came in", async () => {
    const { inv, path } = await issuedDeposit();
    expect((await call(OP, "POST", `${path}/invoices/${inv.id}/void`, { version: inv.version, reason: "no" })).status).toBe(400);
    const v = await call(OP, "POST", `${path}/invoices/${inv.id}/void`, { version: inv.version, reason: "Wrong amount" });
    expect(v.json).toMatchObject({ status: "void", fields: { voided: { reason: "Wrong amount" } } });

    const again = await issuedDepositOnSameProject(path);
    await call(OP, "POST", `${path}/invoices/${again.id}/payments`, { amountCents: 100_000, method: "zelle", receivedAt: "2026-11-12" });
    expect((await call(OP, "POST", `${path}/invoices/${again.id}/void`, { version: again.version, reason: "Wrong amount" })).json.error).toBe("has_payments");
    const credit = await call(OP, "POST", `${path}/invoices`, { type: "credit", appliesTo: again.id, lines: [{ text: "Goodwill", unitCents: 225_000 }] });
    await call(OP, "POST", `${path}/invoices/${credit.json.id}/issue`, { version: credit.json.version });
    // Credit plus payment cover it: nothing left to pay online
    expect((await call(s.raj.email, "POST", `${path}/invoices/${again.id}/pay`)).json.error).toBe("not_open");
  });

  /** A second deposit invoice on the same project, issued */
  async function issuedDepositOnSameProject(path: string) {
    const d = await call(OP, "POST", `${path}/invoices`, { type: "deposit" });
    expect(d.status).toBe(201);
    return (await call(OP, "POST", `${path}/invoices/${d.json.id}/issue`, { version: d.json.version })).json;
  }

  it("suggests purchases neon1 bought, at the receipt's cost", async () => {
    const { path } = await approveB();
    expect((await call(OP, "POST", `${path}/invoices`, { type: "reimbursement" })).json.error).toBe("no_lines");
    const bought = (await call(OP, "POST", `${path}/items`, { kind: "purchase", title: "Label printer", fields: { buyer: "neon1", actual: "$189.99" } })).json;
    await call(s.raj.email, "POST", `${path}/items/${bought.id}/agree`, { version: bought.version, initials: "RP" });
    await call(OP, "PATCH", `${path}/items/${bought.id}`, { version: bought.version + 1, status: "bought" });
    const r = await call(OP, "POST", `${path}/invoices`, { type: "reimbursement" });
    expect(r.json.fields.lines).toEqual([{ text: "Label printer (at cost, receipt in Files)", qty: 1, unitCents: 18_999, ref: bought.id }]);
  });

  it("drafts the final invoice for the rest of the price when the last handover step is accepted", async () => {
    const { draft, path } = await approveB();
    await call(OP, "POST", `${path}/invoices/${draft.id}/issue`, { version: draft.version });
    const h = (await flow()).items.find((i) => i.kind === "handoff")!;
    expect((await call(s.raj.email, "POST", `${path}/items/${h.id}/accept`, { version: h.version })).status).toBe(400);
    const r = await call(s.raj.email, "POST", `${path}/items/${h.id}/accept`, { version: h.version, signature: SIGN });
    expect(r.json.fields.accepted.signature).toMatchObject({ doc: "acceptance", typedName: "Raj Patel" });
    const final = (await flow()).items.find((i) => i.kind === "invoice" && i.fields.type === "final")!;
    expect(final).toMatchObject({ status: "draft", fields: { lines: [{ unitCents: 225_000 }] } });
    // A signed acceptance is a record: the step stays done
    const again = (await flow()).items.find((i) => i.id === h.id)!;
    expect((await call(OP, "PATCH", `${path}/items/${h.id}`, { version: again.version, status: "open" })).json.error).toBe("immutable");
  });

  it("accepts the whole handover with one signature once every step is done, each step signed for", async () => {
    const { draft, path } = await approveB();
    await call(OP, "POST", `${path}/invoices/${draft.id}/issue`, { version: draft.version });
    const first = (await flow()).items.find((i) => i.kind === "handoff")!;
    const second = (await call(OP, "POST", `${path}/items`, { kind: "handoff", title: "Docs delivered and walked through" })).json;
    // Not while a step is still open, and only for the decision maker
    expect((await call(s.raj.email, "POST", `${path}/handover/accept`, { signature: SIGN })).json.error).toBe("not_done");
    await call(OP, "PATCH", `${path}/items/${first.id}`, { version: first.version, status: "done" });
    await call(OP, "PATCH", `${path}/items/${second.id}`, { version: second.version, status: "done" });
    expect((await call(s.dana.email, "POST", `${path}/handover/accept`, { signature: SIGN })).status).toBe(403);
    expect((await flow()).items.some((i) => i.kind === "invoice" && i.fields.type === "final")).toBe(false);
    // Home lists what waits on Raj: the deposit to pay first, then the handover to accept
    const before = (await call(s.raj.email, "GET", `/t/${s.acme.id}/workspace?waiting=all`)).json.waiting as { action: string; title: string; projectKey: string }[];
    expect(before.filter((w) => w.projectKey === "FLOW-1").map((w) => w.action).slice(0, 2)).toEqual(["pay", "accept"]);
    expect(before.find((w) => w.action === "pay" && w.projectKey === "FLOW-1")!.title).toBe("Pay INV-0039-01: $2,250");
    // neon1 is asked for nothing on a client's invoice
    expect(((await call(OP, "GET", `/t/${s.acme.id}/workspace?waiting=all`)).json.waiting as { action: string }[]).some((w) => w.action === "pay" || w.action === "accept")).toBe(false);
    const r = await call(s.raj.email, "POST", `${path}/handover/accept`, { note: "Dana ran a day on her own", signature: SIGN });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ final: true });
    const steps = (await flow()).items.filter((i) => i.kind === "handoff");
    expect(steps).toHaveLength(2);
    for (const step of steps) expect(step.fields.accepted).toMatchObject({ name: "Raj Patel", note: "Dana ran a day on her own", signature: { doc: "acceptance", ref: step.title, typedName: "Raj Patel" } });
    expect((await flow()).items.filter((i) => i.kind === "invoice" && i.fields.type === "final")).toHaveLength(1);
    // Home's "Needs you" asked Raj for it while it waited, and no longer does
    const needs = async () => ((await call(s.raj.email, "GET", `/t/${s.acme.id}/workspace?waiting=all`)).json.waiting as { action: string; title: string }[]);
    expect((await needs()).some((w) => w.action === "accept")).toBe(false);
    // Nothing left to accept, and no second final invoice
    expect((await call(s.raj.email, "POST", `${path}/handover/accept`, { signature: SIGN })).json.error).toBe("nothing_to_accept");
  });
});


describe("an hourly estimate", () => {
  /** Option C repriced as an estimate (20 to 24 hours at $175), issued in the next revision, and approved */
  async function approveEstimate() {
    const { opt, path } = await flow();
    const c = opt("C");
    const r = await call(OP, "PATCH", `${path}/items/${c.id}`, { version: c.version, fields: { pricing: "estimate", rateCents: 17_500, hoursLow: 20, hoursHigh: 24, cost: "typed by hand", basis: [{ work: "Order form", hours: 3 }, { work: "Everything else", hours: 19 }] } });
    // The written cost and hours follow the numbers
    expect(r.json.fields).toMatchObject({ cost: "$3,500 to $4,200 estimate", hours: "20 to 24 hours" });
    await call(OP, "POST", `${path}/proposals`, {});
    const fresh = (await flow()).opt("C");
    const ok = await call(s.raj.email, "POST", `${path}/items/${fresh.id}/approve`, { version: fresh.version, signature: SIGN });
    expect(ok.status).toBe(201);
    return { path, decision: ok.json.decision };
  }
  const log = (as: string, path: string, hours: number, title = "Order form and list") => call(as, "POST", `${path}/items`, { kind: "time", title, fields: { date: "2026-11-12", hours } });

  it("keeps the numbers in the signed terms, and drafts a deposit of half the low end", async () => {
    const { decision } = await approveEstimate();
    expect(decision.fields.terms).toMatchObject({ pricing: "estimate", rateCents: 17_500, hoursLow: 20, hoursHigh: 24, cost: "$3,500 to $4,200 estimate", basis: [{ work: "Order form", hours: 3 }, { work: "Everything else", hours: 19 }] });
    const draft = (await flow()).items.find((i) => i.kind === "invoice")!;
    expect(draft).toMatchObject({ status: "draft", fields: { type: "deposit", lines: [{ unitCents: 175_000 }] } });
  });

  it("lets only neon1 log hours, in quarter hours, and never counts them as open work", async () => {
    const { path } = await approveEstimate();
    expect((await log(s.raj.email, path, 2)).json.error).toBe("neon1_only");
    expect((await log(OP, path, 2.1)).status).toBe(400);
    const made = await log(OP, path, 2.5);
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ kind: "time", status: "done", fields: { hours: 2.5, date: "2026-11-12" } });
    // The client reads them, and can't change or remove them
    expect((await call(s.raj.email, "PATCH", `${path}/items/${made.json.id}`, { version: 1, fields: { hours: 1 } })).json.error).toBe("neon1_only");
    expect((await call(s.raj.email, "DELETE", `${path}/items/${made.json.id}?version=1`)).json.error).toBe("neon1_only");
  });

  it("bills the hours worked less the deposit, and locks billed hours once the invoice is issued", async () => {
    const { path } = await approveEstimate();
    const dep = (await flow()).items.find((i) => i.kind === "invoice")!;
    await call(OP, "POST", `${path}/invoices/${dep.id}/issue`, { version: dep.version });
    const a = await log(OP, path, 12.5);
    await log(OP, path, 8.5, "Runbook and walkthrough");
    // Before issue, an entry can still be corrected
    expect((await call(OP, "PATCH", `${path}/items/${a.json.id}`, { version: 1, title: "Order form, list, and email reader" })).status).toBe(200);
    // The last handover step accepted drafts the final invoice: 21 hours at $175, less the $1,750 deposit
    const h = (await flow()).items.find((i) => i.kind === "handoff")!;
    await call(s.raj.email, "POST", `${path}/items/${h.id}/accept`, { version: h.version, signature: SIGN });
    const final = (await flow()).items.find((i) => i.kind === "invoice" && i.fields.type === "final")!;
    expect(final.fields.lines).toMatchObject([{ qty: 21, unitCents: 17_500 }, { qty: 1, unitCents: -175_000 }]);
    const issued = await call(OP, "POST", `${path}/invoices/${final.id}/issue`, { version: final.version });
    expect(issued.status).toBe(200);
    const hours = (await flow()).items.filter((i) => i.kind === "time");
    expect(hours.every((x) => x.fields.invoiceId === final.id)).toBe(true);
    const locked = hours[0]!;
    expect((await call(OP, "PATCH", `${path}/items/${locked.id}`, { version: locked.version, fields: { hours: 1 } })).json.error).toBe("immutable");
    expect((await call(OP, "DELETE", `${path}/items/${locked.id}?version=${locked.version}`)).json.error).toBe("immutable");
    // Hours logged afterwards are new work: a progress invoice asks only for those
    await log(OP, path, 1);
    const more = await call(OP, "POST", `${path}/invoices`, { type: "progress" });
    expect(more.json.fields.lines).toMatchObject([{ qty: 22, unitCents: 17_500 }, { unitCents: -367_500 }]);
  });
});


describe("a deposit larger than the finished work", () => {
  it("drafts a credit for the difference when the handover is accepted, once", async () => {
    const { opt, path } = await flow();
    const c = opt("C");
    await call(OP, "PATCH", `${path}/items/${c.id}`, { version: c.version, fields: { pricing: "estimate", rateCents: 17_500, hoursLow: 20, hoursHigh: 24, cost: "", basis: [{ work: "All of it", hours: 22 }] } });
    await call(OP, "POST", `${path}/proposals`, {});
    const fresh = (await flow()).opt("C");
    await call(s.raj.email, "POST", `${path}/items/${fresh.id}/approve`, { version: fresh.version, signature: SIGN });
    const dep = (await flow()).items.find((i) => i.kind === "invoice")!;
    await call(OP, "POST", `${path}/invoices/${dep.id}/issue`, { version: dep.version });
    await call(OP, "POST", `${path}/invoices/${dep.id}/payments`, { amountCents: 175_000, method: "check", ref: "1041", receivedAt: "2026-11-12" });
    // The work turned out far smaller: 6 hours, $1,050, against a $1,750 deposit
    await call(OP, "POST", `${path}/items`, { kind: "time", title: "Order form", fields: { date: "2026-11-12", hours: 6 } });
    const h = (await flow()).items.find((i) => i.kind === "handoff")!;
    await call(s.raj.email, "POST", `${path}/items/${h.id}/accept`, { version: h.version, signature: SIGN });
    const { items } = await flow();
    expect(items.some((i) => i.kind === "invoice" && i.fields.type === "final")).toBe(false);
    const credit = items.find((i) => i.kind === "invoice" && i.fields.type === "credit")!;
    expect(credit).toMatchObject({ status: "draft", fields: { appliesTo: dep.id, lines: [{ unitCents: 70_000 }] } });
    expect(String((credit.fields.lines as { text: string }[])[0]!.text)).toContain("6 hours worked comes to $1,050.00, less than the $1,750.00 invoiced earlier");
    // Issued, the client sees it against the deposit; a second one isn't suggested
    expect((await call(OP, "POST", `${path}/invoices/${credit.id}/issue`, { version: credit.version })).status).toBe(200);
    expect((await call(OP, "POST", `${path}/invoices`, { type: "final" })).json.error).toBe("no_lines");
  });
});


describe("changing the decision", () => {
  it("asks why, replaces the decision in force, and counts what was invoiced for it", async () => {
    const { inv, path } = await issuedDeposit();
    const before = (await flow()).items.find((i) => i.kind === "decision")!;
    const c = (await flow()).opt("C");
    // A change needs a reason, kept and signed with the new decision
    expect((await call(s.raj.email, "POST", `${path}/items/${c.id}/approve`, { version: c.version, signature: SIGN })).json.error).toBe("reason_required");
    const r = await call(s.raj.email, "POST", `${path}/items/${c.id}/approve`, { version: c.version, reason: "The vendor module is enough for now", signature: SIGN });
    expect(r.status).toBe(201);
    expect(r.json.decision.fields).toMatchObject({ supersedes: [before.id], reason: "The vendor module is enough for now", code: "0039-r1-C" });
    // B's $2,250 deposit was invoiced; C's $375 deposit is covered, so no new deposit is drafted
    const { items } = await flow();
    expect(items.filter((i) => i.kind === "invoice").map((i) => i.id)).toEqual([inv.id]);
    const audit = await repo.listAudit(s.acme.id, 50);
    expect(audit.some((e) => e.action === "decision.changed" && e.summary.includes("from 0039-r1-B") && e.summary.includes("Why: The vendor module is enough for now"))).toBe(true);
    // At handover, the $1,500 invoiced past C's $750 price comes back as a credit
    const h = items.find((i) => i.kind === "handoff")!;
    await call(s.raj.email, "POST", `${path}/items/${h.id}/accept`, { version: h.version, signature: SIGN });
    const credit = (await flow()).items.find((i) => i.kind === "invoice" && i.fields.type === "credit")!;
    expect(credit).toMatchObject({ status: "draft", fields: { appliesTo: inv.id, lines: [{ unitCents: 150_000 }] } });
    expect(String((credit.fields.lines as { text: string }[])[0]!.text)).toContain("fixed price of $750.00 is less than the $2,250.00 invoiced earlier");
    // Once the handover is accepted, the decision stays
    const a = (await flow()).opt("A");
    expect((await call(s.raj.email, "POST", `${path}/items/${a.id}/approve`, { version: a.version, reason: "Too late", signature: SIGN })).json.error).toBe("handover_accepted");
  });

  it("swaps an unissued deposit draft for the new option's, and can go back after a fresh revision", async () => {
    const { draft, path } = await approveB();
    const c = (await flow()).opt("C");
    expect((await call(s.raj.email, "POST", `${path}/items/${c.id}/approve`, { version: c.version, reason: "Smaller first", signature: SIGN })).status).toBe(201);
    // Nobody was asked for B's deposit, so its draft goes and C's full $375 deposit takes its place
    const invoices = (await flow()).items.filter((i) => i.kind === "invoice");
    expect(invoices.some((i) => i.id === draft.id)).toBe(false);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: "draft", fields: { type: "deposit", lines: [{ unitCents: 37_500 }] } });
    // B, replaced, can't be approved again until neon1 confirms it in the next revision
    const b = (await flow()).opt("B");
    expect((await call(s.raj.email, "POST", `${path}/items/${b.id}/approve`, { version: b.version, reason: "Back to the portal", signature: SIGN })).json.error).toBe("changed_since_issue");
    await call(OP, "POST", `${path}/proposals`, {});
    const fresh = (await flow()).opt("B");
    const back = await call(s.raj.email, "POST", `${path}/items/${fresh.id}/approve`, { version: fresh.version, reason: "Back to the portal", signature: SIGN });
    expect(back.status).toBe(201);
    expect(back.json.decision.fields.code).toBe("0039-r2-B");
    // C, the decision in force until now, isn't approved twice; the one in force can't be either
    const now = (await flow()).items;
    const inForce = now.filter((i) => i.kind === "decision").find((d) => !now.some((x) => x.kind === "decision" && (x.fields.supersedes as string[] | undefined)?.includes(d.id)))!;
    expect(inForce.id).toBe(back.json.decision.id);
    const again = (await flow()).opt("B");
    expect((await call(s.raj.email, "POST", `${path}/items/${again.id}/approve`, { version: again.version, reason: "x y z", signature: SIGN })).json.error).toBe("not_proposed");
  });
});

describe("paying online", () => {
  it("is off without Stripe, and points people to the other ways to pay", async () => {
    await start(false);
    const { inv, path } = await issuedDeposit();
    expect((await call(s.raj.email, "POST", `${path}/invoices/${inv.id}/pay`)).json.error).toBe("payments_off");
  });

  // A Checkout session's event, signed as Stripe signs it
  const event = (session: { id: string; metadata: unknown }, type: string, payment_status: string) => ({ id: `evt_${type}`, type, data: { object: { object: "checkout.session", id: session.id, payment_status, amount_total: 225_000, payment_intent: "pi_1", payment_method_types: ["us_bank_account"], metadata: session.metadata } } });
  const hook = async (e: unknown, header?: string) => {
    const signed = await payments!.sign(e);
    return app.request("/1NEON/api/billing/stripe", { method: "POST", headers: { "stripe-signature": header ?? signed.header }, body: signed.body });
  };

  it("opens Checkout for what is owed, shows the bank payment on its way, and records it once when it clears", async () => {
    const { inv, path } = await issuedDeposit();
    // Anyone in the organization may pay
    const r = await call(s.dana.email, "POST", `${path}/invoices/${inv.id}/pay`);
    expect(r.json.url).toMatch(/^https:\/\/checkout\.example\.invalid\//);
    const session = payments!.sessions[0]!;
    expect(session).toMatchObject({ amountCents: 225_000, invoiceNumber: "INV-0039-01", metadata: { invoiceId: inv.id } });

    // A forged or stale signature is refused
    expect((await hook(event(session, "checkout.session.async_payment_succeeded", "paid"), "t=1,v1=00")).status).toBe(400);
    // Bank payments complete later: the first event records it as started, and the invoice stays open
    expect((await hook(event(session, "checkout.session.completed", "unpaid"))).status).toBe(200);
    await hook(event(session, "checkout.session.completed", "unpaid"));
    const mid = await flow();
    const started = mid.items.filter((i) => i.kind === "payment");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ status: "pending", fields: { method: "ach", amountCents: 225_000 } });
    expect(mid.items.find((i) => i.id === inv.id)!.status).toBe("issued");
    // While it clears nobody can pay again, by any route, and the invoice can't be voided
    expect((await call(s.raj.email, "POST", `${path}/invoices/${inv.id}/pay`)).json.error).toBe("clearing");
    expect((await call(OP, "POST", `${path}/invoices/${inv.id}/payments`, { amountCents: 225_000, method: "check", ref: "1041", receivedAt: "2026-11-12" })).json.error).toBe("too_much");
    expect((await call(OP, "POST", `${path}/invoices/${inv.id}/void`, { version: mid.items.find((i) => i.id === inv.id)!.version, reason: "Wrong amount" })).json.error).toBe("has_payments");
    // Home no longer asks the client to pay it
    const home = await call(s.raj.email, "GET", `/t/${s.acme.id}/workspace`);
    expect(home.json.waiting.filter((w: { itemId: string }) => w.itemId === inv.id)).toHaveLength(0);
    // Confirmed: the same payment, now received, and the invoice is paid; a repeat changes nothing
    await hook(event(session, "checkout.session.async_payment_succeeded", "paid"));
    await hook(event(session, "checkout.session.async_payment_succeeded", "paid"));
    await hook(event(session, "checkout.session.async_payment_failed", "unpaid"));
    const { items } = await flow();
    const pays = items.filter((i) => i.kind === "payment");
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ id: started[0]!.id, status: "done", fields: { method: "ach", amountCents: 225_000, ref: "pi_1", stripe: { session: session.id } } });
    expect(pays[0]!.fields.startedAt).toBeTruthy();
    expect(items.find((i) => i.id === inv.id)!.status).toBe("paid");
  });

  it("marks a bank payment the bank refused as failed, tells both sides, and lets the client pay again", async () => {
    const { inv, path } = await issuedDeposit();
    await call(s.raj.email, "POST", `${path}/invoices/${inv.id}/pay`);
    const session = payments!.sessions[0]!;
    await hook(event(session, "checkout.session.completed", "unpaid"));
    await hook(event(session, "checkout.session.async_payment_failed", "unpaid"));
    // A late or repeated event never brings a failed payment back
    await hook(event(session, "checkout.session.completed", "unpaid"));
    const { items } = await flow();
    const pays = items.filter((i) => i.kind === "payment");
    expect(pays).toHaveLength(1);
    expect(pays[0]!.status).toBe("failed");
    expect(items.find((i) => i.id === inv.id)!.status).toBe("issued");
    // It's owed again: Home asks, and Pay opens a new session for the whole amount
    const home = await call(s.raj.email, "GET", `/t/${s.acme.id}/workspace`);
    expect(home.json.waiting.find((w: { itemId: string }) => w.itemId === inv.id)).toMatchObject({ title: "Pay INV-0039-01: $2,250, the bank payment didn't go through", failed: true });
    expect((await call(s.raj.email, "POST", `${path}/invoices/${inv.id}/pay`)).json.url).toBeTruthy();
    expect(payments!.sessions.at(-1)).toMatchObject({ amountCents: 225_000 });
    // With no money tied to it, neon1 may void it
    const cur = items.find((i) => i.id === inv.id)!;
    expect((await call(OP, "POST", `${path}/invoices/${inv.id}/void`, { version: cur.version, reason: "Reissuing with a later due date" })).status).toBe(200);
  });

  it("records a card payment at once", async () => {
    const { inv, path } = await issuedDeposit();
    await call(s.raj.email, "POST", `${path}/invoices/${inv.id}/pay`);
    const session = payments!.sessions[0]!;
    const card = event(session, "checkout.session.completed", "paid");
    // Both ways were offered, as in real use: paid on the spot means the card
    card.data.object.payment_method_types = ["us_bank_account", "card"];
    await hook(card);
    const { items } = await flow();
    expect(items.filter((i) => i.kind === "payment")).toMatchObject([{ status: "done", fields: { method: "card" } }]);
    expect(items.find((i) => i.id === inv.id)!.status).toBe("paid");
  });
});
