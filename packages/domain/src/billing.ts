// packages/domain/src/billing.ts - Signatures, invoices, and payments. Money is whole cents. An issued
// invoice is a frozen record: it is never edited or deleted, only voided with a reason or reduced by a
// credit note. A signature ties a typed name and consent to a SHA-256 hash of exactly what was signed.


import { z } from "zod";
import { id, isoDate, Signature, type Item } from "./model.ts";
import { SIGN_CONSENT } from "./agreement.ts";


// --- Signatures ----------------------------------------------------------------------

/** What a signer sends: their typed name and the consent box, which must be ticked */
export const SignInput = z.object({ typedName: z.string().trim().min(2).max(120), consent: z.literal(true) });
export type SignInput = z.infer<typeof SignInput>;

/** Build a signature record from a signer's input and the request around it */
export function signature(doc: Signature["doc"], ref: string, hash: string, input: SignInput, who: { id: string; name: string; email: string }, at: string, from: { ip?: string; ua?: string } = {}): Signature {
  return Signature.parse({ doc, ref, hash, typedName: input.typedName, consent: SIGN_CONSENT, by: who.id, name: who.name, email: who.email, at, ip: from.ip?.slice(0, 64), ua: from.ua?.slice(0, 300) });
}

/**
 * Why a typed signature doesn't read as the signer's name, or undefined when it does. A name has no
 * digits, and when the profile has a name, the signature carries at least one word of it (first or
 * last name, any case), so "Raj Patel" signs for Raj Patel and "anything123" signs for no one
 */
export function signedNameProblem(typed: string, profileName: string | undefined): string | undefined {
  const t = typed.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\d/.test(t) || !/\p{L}.*\p{L}/u.test(t)) return "Type your name as you'd sign it, in letters.";
  const name = (profileName ?? "").includes("@") ? "" : (profileName ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const parts = name.split(/[^\p{L}]+/u).filter((w) => w.length >= 2);
  if (!parts.length) return undefined;
  const typedParts = new Set(t.split(/[^\p{L}]+/u).filter(Boolean));
  return parts.some((w) => typedParts.has(w)) ? undefined : `Type your name as it is on your profile (${profileName}). To sign under another name, change it in your profile first.`;
}

/** Initials from a typed name: "Raj Patel" → "RP" (kept for purchases neon1 buys) */
export const initialsOf = (name: string) => name.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 8) || "?";

/** JSON with keys in a fixed order, so the same content always hashes the same */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** SHA-256 of text as lowercase hex (Web Crypto, so the API, the browser, and the demo agree) */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}


// --- Money ----------------------------------------------------------------------------

/** The first dollar amount in text, in cents: "$6,500 fixed" → 650000, "about $1,200.50" → 120050 */
export function parseMoney(text: string): number | undefined {
  const m = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(text);
  if (!m) return undefined;
  return Number(m[1]!.replace(/,/g, "")) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** 650000 → "$6,500.00"; negative amounts read "-$12.00" */
export function money(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const s = `$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${s}` : s;
}


// --- Invoices ---------------------------------------------------------------------------

/** What an invoice is for; a credit reduces an issued invoice it names */
export const InvoiceType = z.enum(["deposit", "progress", "final", "reimbursement", "retainer", "credit"]);
export type InvoiceType = z.infer<typeof InvoiceType>;

// Cents per line stay within ten million dollars either way
const Cents = z.number().int().min(-1_000_000_000).max(1_000_000_000);

/** One line: what, how many, the unit price, and the record it comes from (a decision or purchase) */
export const InvoiceLine = z.object({
  text: z.string().trim().min(1).max(200),
  qty: z.number().positive().max(10_000).default(1),
  unitCents: Cents,
  ref: id.optional(),
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

/** Who the invoice is addressed to, as it stood when issued */
const BillTo = z.object({ org: z.string().max(120), name: z.string().max(120).optional(), email: z.string().max(254).optional() });

/** An invoice's fields. Number, dates, bill-to, and hash are set only when it is issued */
export const InvoiceFields = z.object({
  type: InvoiceType,
  lines: z.array(InvoiceLine).min(1).max(100),
  taxCents: Cents.default(0),
  termsDays: z.number().int().min(0).max(90).default(15),
  note: z.string().max(1000).default(""),
  // A credit names the issued invoice it reduces
  appliesTo: id.optional(),
  number: z.string().max(32).optional(),
  issuedAt: isoDate.optional(),
  issuedBy: id.optional(),
  dueDate: z.string().date().optional(),
  billTo: BillTo.optional(),
  hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  voided: z.object({ by: id, name: z.string().max(80), at: isoDate, reason: z.string().max(500) }).optional(),
});
export type InvoiceFields = z.infer<typeof InvoiceFields>;

/** Draft, issued (open), paid in full, or void. Partly paid and overdue are worked out, not stored */
export const INVOICE_STATUSES = ["draft", "issued", "paid", "void"] as const;

/** A line's amount: quantity times unit price, rounded to the cent */
export const lineCents = (l: Pick<InvoiceLine, "qty" | "unitCents">) => Math.round(l.qty * l.unitCents);

/** The invoice's total: its lines plus tax. A credit's total is negative */
export function invoiceTotal(f: Pick<InvoiceFields, "lines" | "taxCents" | "type">): number {
  const sum = f.lines.reduce((s, l) => s + lineCents(l), 0) + f.taxCents;
  return f.type === "credit" ? -Math.abs(sum) : sum;
}

/** "INV-0039-01": the project's proposal number (or project key) and the invoice's place in it */
export const invoiceNumber = (base: string, seq: number) => `INV-${base}-${String(seq).padStart(2, "0")}`;

/** How a payment arrived */
export const PaymentMethod = z.enum(["ach", "card", "check", "zelle", "wire", "other"]);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

/**
 * A payment against one invoice: from Stripe (with its session) or recorded by hand. Its item's status
 * says where the money is: "done" once received; "pending" while a bank (ACH) transfer the client
 * started is still clearing; "failed" when the bank refused it. Only received money reduces a balance
 */
export const PaymentFields = z.object({
  invoiceId: id,
  amountCents: z.number().int().positive().max(1_000_000_000),
  method: PaymentMethod,
  // A check number, Zelle confirmation, or the Stripe payment's ID
  ref: z.string().max(120).default(""),
  // The day the money arrived; for a bank transfer still clearing or refused, the day it was started
  receivedAt: z.string().date(),
  // A bank transfer's start day, kept once it clears so the invoice can show both
  startedAt: z.string().date().optional(),
  recordedBy: id,
  stripe: z.object({ session: z.string().max(200), intent: z.string().max(200).optional() }).optional(),
});
export type PaymentFields = z.infer<typeof PaymentFields>;

/** Where a payment's money is */
export const PAYMENT_STATUSES = ["pending", "failed", "done"] as const;

// Any stored item: kinds are compared as strings, so plain records work too
type Rec = Pick<Item, "id" | "status" | "fields"> & { kind: string };

// The payments on one invoice, whatever their standing
const paymentsOn = (invoice: Rec, items: Rec[]) => items.filter((i) => i.kind === "payment" && i.fields.invoiceId === invoice.id);
/** Has this payment's money arrived? One still clearing, or refused by the bank, hasn't */
export const received = (payment: Pick<Rec, "status">) => payment.status !== "pending" && payment.status !== "failed";

/** What is still owed on an issued invoice: its total, less payments received, less issued credits against it */
export function balanceOf(invoice: Rec, items: Rec[]): number {
  const f = InvoiceFields.parse(invoice.fields);
  if (invoice.status === "void" || invoice.status === "draft") return 0;
  const paid = paymentsOn(invoice, items).filter(received).reduce((s, i) => s + PaymentFields.parse(i.fields).amountCents, 0);
  const credits = items.filter((i) => i.kind === "invoice" && i.status !== "void" && i.status !== "draft" && i.fields.type === "credit" && i.fields.appliesTo === invoice.id).reduce((s, i) => s + invoiceTotal(InvoiceFields.parse(i.fields)), 0);
  return Math.max(0, invoiceTotal(f) + credits - paid);
}

/** Bank payments started on an invoice and still clearing, in cents, up to what is owed */
export function clearingOn(invoice: Rec, items: Rec[]): number {
  const started = paymentsOn(invoice, items).filter((i) => i.status === "pending").reduce((s, i) => s + PaymentFields.parse(i.fields).amountCents, 0);
  return Math.min(balanceOf(invoice, items), started);
}

/** What can be paid right now: the balance, less bank payments on their way, so nobody pays twice */
export const payableOn = (invoice: Rec, items: Rec[]) => balanceOf(invoice, items) - clearingOn(invoice, items);

/** The latest bank payment that didn't go through, while the invoice still waits to be paid again */
export function failedOn(invoice: Rec, items: Rec[]): PaymentFields | undefined {
  if (payableOn(invoice, items) <= 0) return undefined;
  const failed = paymentsOn(invoice, items).filter((i) => i.status === "failed").map((i) => PaymentFields.parse(i.fields)).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const last = failed.at(-1);
  // A payment received since then means the client already answered the failure
  const since = last && paymentsOn(invoice, items).some((i) => received(i) && String(i.fields.receivedAt) > last.receivedAt);
  return since ? undefined : last;
}

/**
 * Where an invoice stands for people: draft, open, partly paid, clearing (a bank payment for all that
 * is owed is on its way, so it is neither open to pay nor overdue), overdue, paid, void, or credit
 */
export function invoiceState(invoice: Rec, items: Rec[], today: string): "draft" | "open" | "partly_paid" | "clearing" | "overdue" | "paid" | "void" | "credit" {
  const f = InvoiceFields.parse(invoice.fields);
  if (invoice.status === "draft" || invoice.status === "void") return invoice.status;
  if (f.type === "credit") return "credit";
  const left = balanceOf(invoice, items);
  if (left === 0) return "paid";
  if (clearingOn(invoice, items) >= left) return "clearing";
  if (f.dueDate && today > f.dueDate) return "overdue";
  return left < invoiceTotal(f) ? "partly_paid" : "open";
}


// --- Prices ----------------------------------------------------------------------------------
// An option's price is one of two kinds, and every invoice suggestion follows from which. A fixed
// price is one amount. An estimate is hours at a rate, with a low and a high end: the client pays for
// the hours worked, and never above the high end unless a change is approved first.

/** What a price is read from: an option's fields, or the terms copied into a decision */
export type PriceTerms = { cost?: string; pricing?: "fixed" | "estimate"; rateCents?: number; hoursLow?: number; hoursHigh?: number; depositPercent?: number };

/** A price invoices can be worked out from */
export type Price =
  | { kind: "fixed"; totalCents: number; depositPercent: number }
  | { kind: "estimate"; rateCents: number; hoursLow: number; hoursHigh: number; lowCents: number; highCents: number; depositPercent: number };

/** The share asked up front, in percent: what the terms agree, else the usual 50 */
export const depositPercentOf = (t: PriceTerms) => (typeof t.depositPercent === "number" && t.depositPercent >= 0 && t.depositPercent <= 100 ? Math.round(t.depositPercent) : DEPOSIT_PERCENT);

/** The price in numbers, or undefined when it's only words ("depends on seats") */
export function priceOf(t: PriceTerms): Price | undefined {
  if (t.pricing === "estimate") {
    if (!t.rateCents || !t.hoursHigh) return undefined;
    const low = Math.min(t.hoursLow ?? t.hoursHigh, t.hoursHigh);
    return { kind: "estimate", rateCents: t.rateCents, hoursLow: low, hoursHigh: t.hoursHigh, lowCents: Math.round(low * t.rateCents), highCents: Math.round(t.hoursHigh * t.rateCents), depositPercent: depositPercentOf(t) };
  }
  // Options written before prices had a kind say it in words: "$6,500 fixed"
  if (t.pricing === "fixed" || /fixed/i.test(t.cost ?? "")) {
    const total = parseMoney(t.cost ?? "");
    return total ? { kind: "fixed", totalCents: total, depositPercent: depositPercentOf(t) } : undefined;
  }
  return undefined;
}

/** 350000 → "$3,500"; cents show only when there are some ("$3,762.50") */
export const dollars = (cents: number) => (cents % 100 === 0 ? money(cents).slice(0, -3) : money(cents));
/** 21 → "21 hours", 1 → "1 hour", 2.5 → "2.5 hours" */
export const hoursText = (h: number) => `${Number(h.toFixed(2))} ${h === 1 ? "hour" : "hours"}`;
/** "20 to 24 hours", or "7 hours" when the two ends are the same */
export const hoursRange = (p: Extract<Price, { kind: "estimate" }>) => (p.hoursLow === p.hoursHigh ? hoursText(p.hoursHigh) : `${Number(p.hoursLow.toFixed(2))} to ${hoursText(p.hoursHigh)}`);

/** The price as one line: "$3,500 to $4,200 estimate" or "$1,700 fixed". Written into an option's
 * cost, so every place that prints the cost says the same thing */
export function priceLine(p: Price): string {
  if (p.kind === "fixed") return `${dollars(p.totalCents)} fixed`;
  return p.lowCents === p.highCents ? `${dollars(p.highCents)} estimate` : `${dollars(p.lowCents)} to ${dollars(p.highCents)} estimate`;
}

/** An option's fields with its written cost and hours brought in line with its numbers, so an
 * estimate's range is never typed one way and calculated another */
export function alignPrice<T extends PriceTerms & { hours?: string }>(f: T): T {
  const p = f.pricing === "estimate" ? priceOf(f) : undefined;
  return p?.kind === "estimate" ? { ...f, cost: priceLine(p), hours: hoursRange(p) } : f;
}

/** What the kind of price means for the person paying, in a sentence or two */
export function priceMeaning(p: Price): string {
  if (p.kind === "fixed") return "A fixed price. It changes only if you approve a change to the work.";
  return `An estimate. You pay for the hours worked at ${dollars(p.rateCents)} an hour, and each hour is listed in the project as it's logged. The total can't pass ${dollars(p.highCents)} unless you approve a change first.`;
}

/** When the money is due, as short lines: the deposit at approval, and the rest at handover */
export function paymentPlan(p: Price, percent = p.depositPercent ?? DEPOSIT_PERCENT): string[] {
  // Nothing up front: the whole of it is billed at handover
  if (percent <= 0) return p.kind === "fixed" ? [`Nothing up front; ${money(p.totalCents)} when you accept the handover`] : ["Nothing up front; the hours worked when you accept the handover"];
  if (p.kind === "fixed") {
    const first = Math.round((p.totalCents * percent) / 100);
    return [`${money(first)} when you approve (${percent}% deposit)`, `${money(p.totalCents - first)} when you accept the handover`];
  }
  const first = Math.round((p.lowCents * percent) / 100);
  return [`${money(first)} when you approve (${percent}% of the low end, as a deposit)`, "The rest when you accept the handover: the hours worked, less the deposit"];
}

/** Every hour logged on the project */
export const hoursLogged = (items: Rec[]) => items.filter((i) => i.kind === "time").reduce((s, i) => s + (Number(i.fields.hours) || 0), 0);

/**
 * Where an hourly estimate stands: hours logged, the hours that can be billed (never past the high
 * end), and what they come to. Undefined for a fixed price, which doesn't depend on hours
 */
export function hoursStanding(terms: PriceTerms, items: Rec[]) {
  const price = priceOf(terms);
  if (price?.kind !== "estimate") return undefined;
  const logged = hoursLogged(items);
  const billable = Math.min(logged, price.hoursHigh);
  return { price, logged, billable, over: logged - billable, earnedCents: Math.round(billable * price.rateCents) };
}


// --- Suggested lines ------------------------------------------------------------------------

/** The share asked up front when an option is approved: of a fixed price, or of an estimate's low end */
export const DEPOSIT_PERCENT = 50;

type Decision = { id: string; title: string; fields: Record<string, unknown> };
type Terms = PriceTerms & { title?: string };

// "0039-r1-B Solid setup": the option's ID in the proposal, then its name
const named = (d: Decision) => `${typeof d.fields.code === "string" ? `${d.fields.code} ` : ""}${((d.fields.terms ?? {}) as Terms).title ?? d.title}`;
/**
 * A decision and every earlier one it replaced, directly or through another. Money invoiced on any of
 * them counts toward it, so changing to a different option never asks for the same money twice
 */
export function lineage(d: Decision, items: Rec[]): Set<string> {
  const byId = new Map(items.filter((i) => i.kind === "decision").map((i) => [i.id, i]));
  const ids = new Set<string>();
  const todo = [d.id];
  while (todo.length) {
    const id = todo.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    const replaced = (id === d.id ? d : byId.get(id))?.fields.supersedes;
    if (Array.isArray(replaced)) todo.push(...(replaced as string[]));
  }
  return ids;
}
// The earlier invoices for this decision's work, or an earlier decision's it replaced (deposit and
// progress lines name it), oldest first
const earlier = (d: Decision, items: Rec[]) => {
  const ids = lineage(d, items);
  return items
    // Issued ones only: a draft asks for nothing until it's issued, and a void one never did
    .filter((i) => i.kind === "invoice" && i.status !== "void" && i.status !== "draft" && i.fields.type !== "credit" && i.fields.type !== "reimbursement")
    .map((i) => InvoiceFields.parse(i.fields))
    .filter((f) => f.lines.some((l) => ids.has(l.ref ?? "")))
    .sort((a, b) => String(a.issuedAt ?? "~").localeCompare(String(b.issuedAt ?? "~")));
};
/** What invoices already asked for on this decision's work, including any decision it replaced */
export const billedOn = (d: Decision, items: Rec[]) => {
  const ids = lineage(d, items);
  return earlier(d, items).flatMap((f) => f.lines).filter((l) => ids.has(l.ref ?? "")).reduce((s, l) => s + lineCents(l), 0);
};
// "INV-0039-01 and INV-0039-02": the earlier invoices by number, so the subtraction can be checked
const listed = (names: string[]) => (names.length > 2 ? `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}` : names.join(" and "));

/**
 * The deposit lines for an approved option with a price in numbers; none when the price is only words.
 * When it replaces an earlier decision, what was already invoiced for that one counts toward the
 * deposit, and no deposit is asked when it already covers it
 */
export function depositLines(d: Decision, percent?: number, items: Rec[] = []): InvoiceLine[] {
  const price = priceOf((d.fields.terms ?? {}) as Terms);
  if (!price) return [];
  // The share the decision agreed, unless the caller names another; none agreed asks for nothing
  percent ??= price.depositPercent;
  if (percent <= 0) return [];
  const ask: InvoiceLine = price.kind === "fixed"
    ? { text: `${percent}% deposit on ${named(d)}`.slice(0, 200), qty: 1, unitCents: Math.round((price.totalCents * percent) / 100), ref: d.id }
    : { text: `Deposit on ${named(d)}: ${percent}% of the estimate's low end (${dollars(price.lowCents)})`.slice(0, 200), qty: 1, unitCents: Math.round((price.lowCents * percent) / 100), ref: d.id };
  const billed = items.length ? billedOn(d, items) : 0;
  if (billed <= 0) return [ask];
  if (ask.unitCents - billed <= 0) return [];
  const numbers = earlier(d, items).flatMap((f) => (f.number ? [f.number] : []));
  return [ask, { text: `Less ${numbers.length ? listed(numbers) : "what was invoiced"} for the option this one replaces`.slice(0, 200), qty: 1, unitCents: -billed, ref: d.id }];
}

/**
 * What is owed on an approved option now, after earlier deposit and progress lines for it. A fixed
 * price: the rest of the price. An estimate: the hours logged at the rate (never past the high end),
 * less what was already invoiced; hours past the high end are shown, at no charge
 */
export function finalLines(d: Decision, items: Rec[]): InvoiceLine[] {
  const terms = (d.fields.terms ?? {}) as Terms;
  const price = priceOf(terms);
  if (!price) return [];
  const billed = billedOn(d, items);
  if (price.kind === "fixed") {
    const left = price.totalCents - billed;
    return left > 0 ? [{ text: `Balance on ${named(d)}`.slice(0, 200), qty: 1, unitCents: left, ref: d.id }] : [];
  }
  const at = hoursStanding(terms, items)!;
  if (at.earnedCents - billed <= 0) return [];
  const lines: InvoiceLine[] = [{ text: `${hoursText(at.billable)} on ${named(d)} at ${dollars(price.rateCents)} an hour`.slice(0, 200), qty: at.billable, unitCents: price.rateCents, ref: d.id }];
  if (at.over > 0) lines.push({ text: `${hoursText(at.over)} past the estimate's high end, not billed`, qty: at.over, unitCents: 0, ref: d.id });
  const numbers = earlier(d, items).flatMap((f) => (f.number ? [f.number] : []));
  if (billed > 0) lines.push({ text: (numbers.length ? `Less ${listed(numbers)}, invoiced earlier for this work` : "Less what was invoiced earlier for this work").slice(0, 200), qty: 1, unitCents: -billed, ref: d.id });
  return lines;
}

/**
 * The refund the service agreement promises: when the work comes to less than what issued invoices
 * already asked for, a credit for the difference against the largest of them. On an estimate the work
 * is the hours worked (a deposit larger than the finished work); on a fixed price it's the price, which
 * can be less than what was paid after changing to a smaller option. Invoices on a decision this one
 * replaced count. Credits already made for it count too, so it is suggested once
 */
export function refundCredit(d: Decision, items: Rec[]): { appliesTo: string; lines: InvoiceLine[]; note: string } | undefined {
  const terms = (d.fields.terms ?? {}) as Terms;
  const price = priceOf(terms);
  if (!price) return undefined;
  const at = hoursStanding(terms, items);
  const earned = price.kind === "fixed" ? price.totalCents : at!.earnedCents;
  const ids = lineage(d, items);
  const sums = (i: Rec) => InvoiceFields.parse(i.fields).lines.filter((l) => ids.has(l.ref ?? "")).reduce((n, l) => n + lineCents(l), 0);
  const before = items.filter((i) => i.kind === "invoice" && (i.status === "issued" || i.status === "paid") && i.fields.type !== "credit" && i.fields.type !== "reimbursement" && sums(i) > 0);
  const billed = before.reduce((n, i) => n + sums(i), 0);
  const credited = items.filter((i) => i.kind === "invoice" && i.status !== "void" && i.fields.type === "credit" && before.some((b) => b.id === i.fields.appliesTo)).reduce((n, i) => n - invoiceTotal(InvoiceFields.parse(i.fields)), 0);
  const due = billed - earned - credited;
  if (due <= 0) return undefined;
  const target = [...before].sort((a, b) => sums(b) - sums(a))[0]!;
  const text = price.kind === "fixed"
    ? `Refund on ${named(d)}: its fixed price of ${money(earned)} is less than the ${money(billed)} invoiced earlier`
    : `Refund on ${named(d)}: ${hoursText(at!.billable)} worked comes to ${money(earned)}, less than the ${money(billed)} invoiced earlier`;
  const note = price.kind === "fixed"
    ? "The option you changed to costs less than what was already invoiced, so the difference is refunded, as the service agreement says."
    : "The work took fewer hours than the deposit covered, so the difference is refunded, as the service agreement says.";
  return { appliesTo: target.id, lines: [{ text: text.slice(0, 200), qty: 1, unitCents: due, ref: d.id }], note };
}

/** Items neon1 bought for the client, at the receipt's cost, not yet on any invoice */
export function reimbursementLines(items: (Rec & { title: string })[]): InvoiceLine[] {
  const billed = new Set(items.filter((i) => i.kind === "invoice" && i.status !== "void").flatMap((i) => InvoiceFields.parse(i.fields).lines.map((l) => l.ref)));
  return items
    .filter((i) => i.kind === "purchase" && i.fields.buyer === "neon1" && (i.status === "bought" || i.status === "done") && !billed.has(i.id))
    .flatMap((i) => {
      const cents = parseMoney(String(i.fields.actual ?? ""));
      return cents ? [{ text: `${i.title} (at cost, receipt in Files)`.slice(0, 200), qty: 1, unitCents: cents, ref: i.id }] : [];
    });
}
