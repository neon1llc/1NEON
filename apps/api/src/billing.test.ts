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

/** Approve option B ($6,500 fixed) and return the deposit draft neon1 gets */
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
    expect(draft).toMatchObject({ status: "draft", fields: { type: "deposit", lines: [{ unitCents: 325_000, ref: decision.id }] } });
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
    const last = await pay(200_000);
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
    expect(final).toMatchObject({ status: "draft", fields: { lines: [{ unitCents: 325_000 }] } });
  });
});


describe("paying online", () => {
  it("is off without Stripe, and points people to the other ways to pay", async () => {
    await start(false);
    const { inv, path } = await issuedDeposit();
    expect((await call(s.raj.email, "POST", `${path}/invoices/${inv.id}/pay`)).json.error).toBe("payments_off");
  });

  it("opens Checkout for what is owed, then records the bank payment once when Stripe confirms it", async () => {
    const { inv, path } = await issuedDeposit();
    // Anyone in the organization may pay
    const r = await call(s.dana.email, "POST", `${path}/invoices/${inv.id}/pay`);
    expect(r.json.url).toMatch(/^https:\/\/checkout\.example\.invalid\//);
    const session = payments!.sessions[0]!;
    expect(session).toMatchObject({ amountCents: 325_000, invoiceNumber: "INV-0039-01", metadata: { invoiceId: inv.id } });

    const event = (type: string, payment_status: string) => ({ id: `evt_${type}`, type, data: { object: { object: "checkout.session", id: session.id, payment_status, amount_total: 325_000, payment_intent: "pi_1", payment_method_types: ["us_bank_account"], metadata: session.metadata } } });
    const hook = async (e: unknown, header?: string) => {
      const signed = await payments!.sign(e);
      return app.request("/1NEON/api/billing/stripe", { method: "POST", headers: { "stripe-signature": header ?? signed.header }, body: signed.body });
    };
    // A forged or stale signature is refused
    expect((await hook(event("checkout.session.async_payment_succeeded", "paid"), "t=1,v1=00")).status).toBe(400);
    // Bank payments complete later: the first event records nothing
    expect((await hook(event("checkout.session.completed", "unpaid"))).status).toBe(200);
    expect((await flow()).items.some((i) => i.kind === "payment")).toBe(false);
    // Confirmed: one payment, by ACH, and the invoice is paid; a repeat changes nothing
    await hook(event("checkout.session.async_payment_succeeded", "paid"));
    await hook(event("checkout.session.async_payment_succeeded", "paid"));
    const { items } = await flow();
    const pays = items.filter((i) => i.kind === "payment");
    expect(pays).toHaveLength(1);
    expect(pays[0]!.fields).toMatchObject({ method: "ach", amountCents: 325_000, ref: "pi_1", stripe: { session: session.id } });
    expect(items.find((i) => i.id === inv.id)!.status).toBe("paid");
  });
});
