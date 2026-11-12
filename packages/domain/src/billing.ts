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

/** A payment against one invoice: from Stripe (with its session) or recorded by hand */
export const PaymentFields = z.object({
  invoiceId: id,
  amountCents: z.number().int().positive().max(1_000_000_000),
  method: PaymentMethod,
  // A check number, Zelle confirmation, or the Stripe payment's ID
  ref: z.string().max(120).default(""),
  receivedAt: z.string().date(),
  recordedBy: id,
  stripe: z.object({ session: z.string().max(200), intent: z.string().max(200).optional() }).optional(),
});
export type PaymentFields = z.infer<typeof PaymentFields>;

// Any stored item: kinds are compared as strings, so plain records work too
type Rec = Pick<Item, "id" | "status" | "fields"> & { kind: string };

/** What is still owed on an issued invoice: its total, less payments, less issued credits against it */
export function balanceOf(invoice: Rec, items: Rec[]): number {
  const f = InvoiceFields.parse(invoice.fields);
  if (invoice.status === "void" || invoice.status === "draft") return 0;
  const paid = items.filter((i) => i.kind === "payment" && i.fields.invoiceId === invoice.id).reduce((s, i) => s + PaymentFields.parse(i.fields).amountCents, 0);
  const credits = items.filter((i) => i.kind === "invoice" && i.status !== "void" && i.status !== "draft" && i.fields.type === "credit" && i.fields.appliesTo === invoice.id).reduce((s, i) => s + invoiceTotal(InvoiceFields.parse(i.fields)), 0);
  return Math.max(0, invoiceTotal(f) + credits - paid);
}

/** Where an invoice stands for people: draft, open, partly paid, overdue, paid, void, or credit */
export function invoiceState(invoice: Rec, items: Rec[], today: string): "draft" | "open" | "partly_paid" | "overdue" | "paid" | "void" | "credit" {
  const f = InvoiceFields.parse(invoice.fields);
  if (invoice.status === "draft" || invoice.status === "void") return invoice.status;
  if (f.type === "credit") return "credit";
  const left = balanceOf(invoice, items);
  if (left === 0) return "paid";
  if (f.dueDate && today > f.dueDate) return "overdue";
  return left < invoiceTotal(f) ? "partly_paid" : "open";
}


// --- Suggested lines ------------------------------------------------------------------------

/** The share of a fixed price asked up front when an option is approved */
export const DEPOSIT_PERCENT = 50;

type Decision = { id: string; title: string; fields: Record<string, unknown> };

/** A deposit line for an approved option with a dollar price; none when the price has no amount */
export function depositLines(d: Decision, percent = DEPOSIT_PERCENT): InvoiceLine[] {
  const terms = (d.fields.terms ?? {}) as { title?: string; cost?: string };
  const code = typeof d.fields.code === "string" ? `${d.fields.code} ` : "";
  const total = parseMoney(terms.cost ?? "");
  if (!total) return [];
  return [{ text: `${percent}% deposit on ${code}${terms.title ?? d.title}`.slice(0, 200), qty: 1, unitCents: Math.round((total * percent) / 100), ref: d.id }];
}

/** The rest of an approved option's price, after earlier deposit and progress lines for it */
export function finalLines(d: Decision, items: Rec[]): InvoiceLine[] {
  const terms = (d.fields.terms ?? {}) as { title?: string; cost?: string };
  const total = parseMoney(terms.cost ?? "");
  if (!total) return [];
  const billed = items
    .filter((i) => i.kind === "invoice" && i.status !== "void" && i.fields.type !== "credit" && i.fields.type !== "reimbursement")
    .flatMap((i) => InvoiceFields.parse(i.fields).lines)
    .filter((l) => l.ref === d.id)
    .reduce((s, l) => s + lineCents(l), 0);
  const left = total - billed;
  const code = typeof d.fields.code === "string" ? `${d.fields.code} ` : "";
  return left > 0 ? [{ text: `Balance on ${code}${terms.title ?? d.title}`.slice(0, 200), qty: 1, unitCents: left, ref: d.id }] : [];
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
