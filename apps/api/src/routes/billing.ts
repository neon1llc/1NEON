// apps/api/src/routes/billing.ts - The service agreement, invoices, and payments. neon1 drafts, issues,
// and voids invoices and records payments it receives by hand; a client signs the agreement and pays
// an issued invoice through Stripe Checkout. Issued invoices, payments, and signatures are records:
// they are never edited or deleted, and each gets a locked copy.


import {
  AGREEMENT_EDITION, AGREEMENT_TEXT, CreateInvoiceInput, IssueInvoiceInput, Item, InvoiceFields, PaymentFields, RecordPaymentInput, SignAgreementInput, UpdateInvoiceInput, VoidInvoiceInput,
  balanceOf, canonical, clearingOn, depositLines, finalLines, priceOf, type PriceTerms, invoiceNumber, invoiceTotal, isOwnOrg, money, newId, payableOn, plusDays, proposalNumber, reimbursementLines, revisions, sha256Hex, signature, todayIn,
  type Project, type Tenant,
} from "@1neon/domain";
import type { Context } from "hono";
import { actorId, body, fail, need, now, who, type Env } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import type { PaymentEvent } from "../payments.ts";
import { currentDecision, draftInvoice, from, replayKey } from "./items.ts";


// The agreement's hash is worked out once; the text only changes with a new edition (a new deploy)
let agreementHash: Promise<string> | undefined;
const currentHash = () => (agreementHash ??= sha256Hex(AGREEMENT_TEXT));

// Stripe's payment method types, in the words 1NEON stores
const METHOD: Record<string, PaymentFields["method"]> = { us_bank_account: "ach", card: "card" };


/** Public: Stripe's webhook. Registered before the CSRF check and sign-in, because Stripe signs it instead */
export function stripeWebhook(app: App, k: Kit) {
  const { repo } = k;

  app.post("/billing/stripe", async (c) => {
    const pay = k.d.payments;
    if (!pay) fail(404, "not_found", "Not found.");
    const raw = await c.req.text();
    const event = await pay.verify(raw, c.req.header("stripe-signature"));
    if (!event) fail(400, "bad_signature", "Signature check failed.");
    await settle(event);
    // Stripe only needs to hear that it arrived; anything not acted on is acknowledged too
    return c.json({ received: true });
  });

  /**
   * Record what Stripe says about a Checkout session, once, however many times it sends the event.
   * A card is paid at once. A bank (ACH) transfer is recorded as started when the client finishes
   * Stripe's page, then marked received when the bank clears it days later, or failed if it refuses
   */
  async function settle(e: PaymentEvent) {
    const s = e.session;
    if (!s) return;
    const { tenantId, projectId, invoiceId } = s.metadata;
    if (!tenantId || !projectId || !invoiceId) return;
    const invoice = await repo.getItem(tenantId, projectId, invoiceId);
    if (!invoice || invoice.kind !== "invoice") return;
    const p = await repo.getProject(tenantId, projectId);
    if (!p || s.amountTotal <= 0) return;
    // The payment's ID comes from the session, so each event finds what the earlier ones recorded
    const pid = `i_s${replayKey(`${tenantId}|${s.id}`)}`;
    const had = await repo.getItem(tenantId, projectId, pid);
    const done = e.type === "checkout.session.async_payment_succeeded" || (e.type === "checkout.session.completed" && s.paymentStatus === "paid");
    const status = done ? "done" : e.type === "checkout.session.async_payment_failed" ? "failed" : e.type === "checkout.session.completed" && s.paymentStatus === "unpaid" ? "pending" : undefined;
    // Only a transfer still on its way moves on; a received or failed payment is a record and stays
    if (!status || (had && (had.status !== "pending" || status === "pending"))) return;
    const today = now().slice(0, 10);
    // Checkout offers bank and card together, so the session doesn't say which was used. A bank
    // transfer never completes at once, so one paid on the spot was a card; one that waits is the bank
    const startedAt = had ? String(had.fields.startedAt ?? had.fields.receivedAt) : status === "done" ? undefined : today;
    await writePayment(p, invoice, { id: pid, status, was: had, amountCents: s.amountTotal, method: METHOD[s.method ?? ""] ?? (status !== "done" || had ? "ach" : s.methods?.includes("card") ? "card" : "other"), ref: s.paymentIntent ?? s.id, receivedAt: status === "failed" && had ? String(had.fields.receivedAt) : today, startedAt, by: "stripe", stripe: { session: s.id, intent: s.paymentIntent } });
  }

  /**
   * Save a payment (or move a bank transfer from started to received or failed) and, when nothing is
   * left owing, mark the invoice paid, in one write. Received and failed payments get a locked copy
   */
  async function writePayment(p: Project, invoice: Item, x: { id: string; status?: "done" | "pending" | "failed"; was?: Item; amountCents: number; method: PaymentFields["method"]; ref: string; receivedAt: string; startedAt?: string; by: string; stripe?: PaymentFields["stripe"] }) {
    const ts = now();
    const status = x.status ?? "done";
    const number = String(invoice.fields.number);
    const items = (await repo.listItems(p.tenantId, p.id)).filter((i) => i.id !== x.id);
    const payment = Item.parse({
      tenantId: p.tenantId, projectId: p.id, id: x.id, kind: "payment", title: `Payment on ${number}`, body: "", status, rank: x.was?.rank ?? ts,
      fields: PaymentFields.parse({ invoiceId: invoice.id, amountCents: x.amountCents, method: x.method, ref: x.ref, receivedAt: x.receivedAt, startedAt: x.startedAt, recordedBy: x.by, stripe: x.stripe }),
      completedAt: status === "done" ? ts : undefined, version: (x.was?.version ?? 0) + 1, createdAt: x.was?.createdAt ?? ts, updatedAt: ts, updatedBy: x.by,
    });
    const left = balanceOf(invoice, [...items, payment]);
    const next: Item | undefined = status === "done" && left === 0 && invoice.status === "issued" ? { ...invoice, status: "paid", completedAt: ts, version: invoice.version + 1, updatedAt: ts, updatedBy: x.by } : undefined;
    const said = status === "pending" ? { action: "payment.started", summary: `${p.key}: a bank payment of ${money(x.amountCents)} was started on ${number}. It takes a few business days to clear` }
      : status === "failed" ? { action: "payment.failed", summary: `${p.key}: the bank payment of ${money(x.amountCents)} on ${number} didn't go through. ${money(payableOn(invoice, [...items, payment]))} is still owed` }
      : { action: "payment.received", summary: `${p.key}: ${money(x.amountCents)} received on ${number}${left === 0 ? ", paid in full" : `, ${money(left)} left`}` };
    await repo.table.write([
      repo.itemOp(payment, x.was ? { version: x.was.version } : { create: true }),
      ...(next ? [repo.itemOp(next, { version: invoice.version })] : []),
      repo.auditOp({ tenantId: p.tenantId, actorId: x.by, target: invoice.id, ...said }),
    ]);
    if (status !== "pending") await keep(k, `t/${p.tenantId}/p/${p.id}/payments/${payment.id}${status === "failed" ? "-failed" : ""}.json`, payment);
    return { payment, invoice: next ?? invoice };
  }

  return { writePayment };
}


/** Keep a locked copy; the table is the source, so a failed copy is logged rather than undoing the change */
async function keep(k: Kit, key: string, record: unknown) {
  try { await k.d.records?.put(key, record); } catch (e) { console.error(JSON.stringify({ level: "error", message: "record copy failed", key, error: String(e) })); }
}


/** Tenant routes: the agreement, and a project's invoices and payments */
export function billingRoutes(app: App, k: Kit, pay: ReturnType<typeof stripeWebhook>) {
  const { repo, project, cfg } = k;

  // --- The service agreement --------------------------------------------------------------

  /** The current edition, its text and hash, and whether this organization has signed it */
  app.get("/t/:tid/agreement", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const signed = (t.agreements ?? []).filter((a) => a.ref === AGREEMENT_EDITION).at(-1);
    return c.json({ edition: AGREEMENT_EDITION, text: AGREEMENT_TEXT, hash: await currentHash(), signed, history: t.agreements ?? [], required: !isOwnOrg(t.slug) });
  });

  /** A client admin signs the current edition for the organization, once */
  app.post("/t/:tid/agreement/sign", async (c) => {
    const t = c.get("tenant");
    const { actor } = who(c);
    if (actor.operator || c.get("access") !== "admin") fail(403, "admin_only", "An admin of your organization signs the service agreement for it.");
    const input = await body(c, SignAgreementInput);
    if (input.edition !== AGREEMENT_EDITION || input.hash !== (await currentHash())) fail(409, "agreement_changed", "The agreement changed since you opened it. Read the current edition, then sign.");
    const had = (t.agreements ?? []).find((a) => a.ref === AGREEMENT_EDITION);
    if (had) return c.json(had);
    const u = who(c).user;
    const ts = now();
    const signed = signature("agreement", AGREEMENT_EDITION, input.hash, input, { id: u.id, name: u.name || u.email, email: u.email }, ts, from(c));
    const next: Tenant = { ...t, agreements: [...(t.agreements ?? []), signed], version: t.version + 1, updatedAt: ts, updatedBy: u.id };
    await repo.table.write([
      repo.tenantOp(next, { version: t.version }),
      repo.auditOp({ tenantId: t.id, actorId: u.id, action: "agreement.signed", target: t.id, summary: `${input.typedName} signed neon1's service agreement, edition ${AGREEMENT_EDITION}` }),
    ]);
    await keep(k, `t/${t.id}/agreement/${AGREEMENT_EDITION}-${ts}.json`, { ...signed, text: AGREEMENT_TEXT });
    return c.json(signed, 201);
  });


  // --- Invoices ---------------------------------------------------------------------------

  /** neon1 only: invoices are drafted, issued, and voided by neon1 */
  const neon1 = (c: Context<Env>) => {
    need(c, "write");
    if (!who(c).actor.operator) fail(403, "neon1_only", "Invoices are made by neon1.");
  };

  /** One invoice in this project */
  async function invoiceOf(c: Context<Env>, p: Project) {
    const it = await repo.getItem(p.tenantId, p.id, c.req.param("iid")!);
    if (!it || it.kind !== "invoice") fail(404, "not_found", "That invoice doesn't exist.");
    return it;
  }

  /** Draft an invoice; without lines, 1NEON suggests them from the decision or what neon1 bought */
  app.post("/t/:tid/projects/:pid/invoices", async (c) => {
    neon1(c);
    const p = await project(c);
    const input = await body(c, CreateInvoiceInput);
    const items = await repo.listItems(p.tenantId, p.id);
    const decision = input.decisionId ? items.find((i) => i.id === input.decisionId && i.kind === "decision") : currentDecision(items);
    if (input.decisionId && !decision) fail(400, "invalid", "That decision isn't in this project.");
    if (input.type === "credit") {
      const target = items.find((i) => i.id === input.appliesTo && i.kind === "invoice");
      if (!target || target.status === "draft" || target.status === "void" || target.fields.type === "credit") fail(400, "invalid", "A credit reduces one issued invoice. Choose which.");
    }
    const suggested = input.type === "deposit" ? (decision ? depositLines(decision) : []) : input.type === "final" || input.type === "progress" ? (decision ? finalLines(decision, items) : []) : input.type === "reimbursement" ? reimbursementLines(items) : [];
    const lines = input.lines ?? suggested;
    if (!lines.length) fail(400, "no_lines", "There's nothing to bill yet. Add a line with what it's for and the amount.");
    const ts = now();
    const draft = draftInvoice(p, input.type, lines, ts, actorId(c), { termsDays: input.termsDays ?? 15, note: input.note, appliesTo: input.type === "credit" ? input.appliesTo : undefined })!;
    await repo.table.write([repo.itemOp(draft, { create: true }), repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: "invoice.drafted", target: draft.id, summary: `${p.key}: drafted ${draft.title.toLowerCase()} for ${money(invoiceTotal(InvoiceFields.parse(draft.fields)))}` })]);
    return c.json(draft, 201);
  });

  /** Change a draft's lines, tax, terms, or note. Issued invoices never change */
  app.patch("/t/:tid/projects/:pid/invoices/:iid", async (c) => {
    neon1(c);
    const p = await project(c);
    const it = await invoiceOf(c, p);
    if (it.status !== "draft") fail(400, "immutable", "An issued invoice stays as issued. Void it with a reason, or issue a credit.");
    const input = await body(c, UpdateInvoiceInput);
    if (input.version !== it.version) fail(409, "conflict", "This draft changed since you opened it.", it);
    const f = InvoiceFields.parse(it.fields);
    const fields = InvoiceFields.parse({ ...f, lines: input.lines ?? f.lines, taxCents: input.taxCents ?? f.taxCents, termsDays: input.termsDays ?? f.termsDays, note: input.note ?? f.note });
    const next: Item = { ...it, fields, version: it.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    await repo.table.write([repo.itemOp(next, { version: it.version })]);
    return c.json(next);
  });

  /**
   * Issue a draft: number it (INV-0039-01), address it, set the due date in the organization's time
   * zone, and hash what it says. From here it is a record; the client sees it and is told
   */
  app.post("/t/:tid/projects/:pid/invoices/:iid/issue", async (c) => {
    neon1(c);
    const p = await project(c);
    const it = await invoiceOf(c, p);
    if (it.status !== "draft") fail(409, "already_issued", "This invoice is already issued.");
    const input = await body(c, IssueInvoiceInput);
    if (input.version !== it.version) fail(409, "conflict", "This draft changed since you opened it.", it);
    const t = c.get("tenant");
    const items = await repo.listItems(p.tenantId, p.id);
    const f = InvoiceFields.parse(it.fields);
    // Numbered under the project's proposal number, or its key when it has no proposal yet
    const first = revisions(items)[0];
    const base = first ? proposalNumber(first.p.number) : p.key;
    const seq = items.filter((i) => i.kind === "invoice" && i.fields.number).length + 1;
    // Addressed to the project's decision maker, else a client admin
    const members = (await repo.listMembers(p.tenantId)).filter((m) => m.status === "joined");
    const dm = p.people.find((x) => x.role === "decision_maker");
    const to = members.find((m) => m.userId === dm?.userId) ?? members.find((m) => m.access === "admin" && !cfg.operatorEmails.includes(m.email));
    const ts = now();
    const issued = InvoiceFields.parse({
      ...f, number: invoiceNumber(base, seq), issuedAt: ts, issuedBy: actorId(c), dueDate: plusDays(todayIn(t.timeZone), f.termsDays),
      billTo: { org: t.name, name: to?.name || undefined, email: to?.email },
    });
    issued.hash = await sha256Hex(canonical({ ...issued, hash: undefined, total: invoiceTotal(issued) }));
    const next: Item = { ...it, title: `${issued.type === "credit" ? "Credit" : "Invoice"} ${issued.number}`, status: "issued", fields: issued, version: it.version + 1, updatedAt: ts, updatedBy: actorId(c) };
    // Hours this invoice bills are a record from here on: each is marked with the invoice, and stays
    // as logged (an invoice for the work bills every hour logged so far, less what was asked before)
    const agreed = currentDecision(items);
    const billsHours = (issued.type === "final" || issued.type === "progress") && Boolean(agreed) && priceOf((agreed!.fields.terms ?? {}) as PriceTerms)?.kind === "estimate";
    const hours = billsHours ? items.filter((i) => i.kind === "time" && !i.fields.invoiceId).slice(0, 90) : [];
    const stamped = hours.map((h) => repo.itemOp({ ...h, fields: { ...h.fields, invoiceId: it.id }, version: h.version + 1, updatedAt: ts, updatedBy: actorId(c) }, { version: h.version }));
    await repo.table.write([repo.itemOp(next, { version: it.version }), ...stamped, repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: "invoice.issued", target: it.id, summary: `${p.key}: issued ${issued.number} for ${money(invoiceTotal(issued))}, due ${new Date(`${issued.dueDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}` })]);
    await keep(k, `t/${p.tenantId}/p/${p.id}/invoices/${issued.number}.json`, next);
    return c.json(next);
  });

  /** Void an issued invoice nobody has paid on, with a reason. It stays on record, marked void */
  app.post("/t/:tid/projects/:pid/invoices/:iid/void", async (c) => {
    neon1(c);
    const p = await project(c);
    const it = await invoiceOf(c, p);
    if (it.status !== "issued") fail(409, "not_issued", it.status === "draft" ? "A draft isn't issued yet; delete it instead." : "Only an open invoice can be voided.");
    const input = await body(c, VoidInvoiceInput);
    if (input.version !== it.version) fail(409, "conflict", "This invoice changed since you opened it.", it);
    const items = await repo.listItems(p.tenantId, p.id);
    // A payment received, or a bank transfer on its way, ties money to it; one the bank refused doesn't
    const tied = items.filter((i) => i.kind === "payment" && i.fields.invoiceId === it.id && i.status !== "failed");
    if (tied.some((i) => i.status === "pending")) fail(409, "has_payments", "A bank payment is on its way for this invoice. Once it clears, issue a credit instead, so the record stays whole.");
    if (tied.length) fail(409, "has_payments", "Payments were made on this invoice. Issue a credit instead, so the record stays whole.");
    const u = who(c).user;
    const ts = now();
    const next: Item = { ...it, status: "void", fields: { ...it.fields, voided: { by: u.id, name: u.name || u.email, at: ts, reason: input.reason } }, version: it.version + 1, updatedAt: ts, updatedBy: u.id };
    await repo.table.write([repo.itemOp(next, { version: it.version }), repo.auditOp({ tenantId: p.tenantId, actorId: u.id, action: "invoice.voided", target: it.id, summary: `${p.key}: voided ${String(it.fields.number)}: ${input.reason}` })]);
    await keep(k, `t/${p.tenantId}/p/${p.id}/invoices/${String(it.fields.number)}-void.json`, next);
    return c.json(next);
  });


  // --- Payments -----------------------------------------------------------------------------

  /** neon1 records a payment received outside Stripe: a check, Zelle, or wire */
  app.post("/t/:tid/projects/:pid/invoices/:iid/payments", async (c) => {
    neon1(c);
    const p = await project(c);
    const it = await invoiceOf(c, p);
    if (it.status !== "issued" || it.fields.type === "credit") fail(409, "not_open", "Payments go on an open invoice.");
    const input = await body(c, RecordPaymentInput);
    // What a bank transfer on its way already covers isn't taken twice
    const all = await repo.listItems(p.tenantId, p.id);
    const left = payableOn(it, all);
    const onWay = clearingOn(it, all);
    if (input.amountCents > left) fail(400, "too_much", onWay ? `${money(left)} can be recorded: a bank payment of ${money(onWay)} is on its way for this invoice.` : `Only ${money(left)} is owed on this invoice.`);
    const r = await pay.writePayment(p, it, { id: newId("i"), amountCents: input.amountCents, method: input.method, ref: input.ref, receivedAt: input.receivedAt, by: actorId(c) });
    return c.json(r, 201);
  });

  /** Anyone in the organization opens Stripe's payment page for what is owed on an issued invoice */
  app.post("/t/:tid/projects/:pid/invoices/:iid/pay", async (c) => {
    need(c, "read");
    const p = await project(c);
    const it = await invoiceOf(c, p);
    if (!k.d.payments) fail(503, "payments_off", "Online payment isn't set up yet. Pay by check, Zelle, or bank transfer, as the invoice says.");
    if (it.status !== "issued" || it.fields.type === "credit") fail(409, "not_open", "This invoice isn't open for payment.");
    const all = await repo.listItems(p.tenantId, p.id);
    if (balanceOf(it, all) <= 0) fail(409, "not_open", "Nothing is owed on this invoice.");
    // A bank transfer already started covers it: paying again would take the money twice
    const left = payableOn(it, all);
    if (left <= 0) fail(409, "clearing", "A bank payment for this invoice is on its way. It takes a few business days to clear, and you'll be told when it does. There's nothing more to pay.");
    const t = c.get("tenant");
    const f = InvoiceFields.parse(it.fields);
    const back = `${cfg.publicUrl}/1NEON/o/${t.slug}/projects/${p.key}/execute`;
    const s = await k.d.payments.checkout({
      amountCents: left, invoiceNumber: f.number!, description: `${t.name}, ${p.key} ${p.name}`, email: who(c).user.email,
      successUrl: `${back}?paid=${it.id}`, cancelUrl: `${back}?invoice=${it.id}`,
      metadata: { tenantId: p.tenantId, projectId: p.id, invoiceId: it.id },
    });
    return c.json({ url: s.url });
  });
}
