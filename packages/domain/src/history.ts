// packages/domain/src/history.ts - An option's story, read from the records themselves: when it was
// added, each proposal revision it was issued in, its approval and signature, a later decision that
// replaced it, a revised copy, and the invoices billed on it. Records are permanent, so this history
// never runs out the way a feed of recent events does.


import { InvoiceFields, invoiceTotal, money } from "./billing.ts";
import { revisions } from "./proposal.ts";


/** The parts of an item this reads */
type Rec = { id: string; kind: string; title: string; status: string; fields: Record<string, unknown>; createdAt: string; updatedAt?: string; version: number };

/** One moment in an option's history: when, what happened, and what kind of moment it was */
export interface Moment { at: string; text: string; tone: "added" | "issued" | "approved" | "replaced" | "revised" | "billed" | "paid" | "void" }

// "Pradeep Tathineni" or the email, as the decision kept it
const who = (f: Record<string, unknown>) => String(f.approverName || f.approverEmail || "the client");

/** What happened to an option, oldest first */
export function optionHistory(option: Rec, items: Rec[]): Moment[] {
  const out: Moment[] = [{ at: option.createdAt, text: "Added as a draft", tone: "added" }];
  // Every revision that carried it, and the version it carried
  let carried: number | undefined;
  for (const r of revisions(items)) {
    const o = r.p.snapshot.options.find((x) => x.id === option.id);
    if (!o) {
      if (carried !== undefined) out.push({ at: r.p.issuedAt, text: `Left out of Proposal ${r.title.replace(/^Proposal /, "")}`, tone: "revised" });
      carried = undefined;
      continue;
    }
    const changed = carried !== undefined && carried !== o.version;
    out.push({ at: r.p.issuedAt, text: `${changed ? "Revised and issued" : "Issued"} as ${o.code} in Proposal ${r.title.replace(/^Proposal /, "")}`, tone: "issued" });
    carried = o.version;
  }
  // Its decisions, and any later decision that replaced one of them
  const decisions = items.filter((i) => i.kind === "decision");
  const mine = decisions.filter((d) => d.fields.optionId === option.id);
  for (const d of mine) {
    const f = d.fields;
    const sig = f.signature as { typedName?: string } | undefined;
    out.push({ at: String(f.approvedAt ?? d.createdAt), text: `Approved${f.code ? ` as ${String(f.code)}` : ""} by ${who(f)}${sig?.typedName ? `, signed "${sig.typedName}"` : ""}${f.reason ? `. Why: ${String(f.reason)}` : ""}`, tone: "approved" });
    for (const later of decisions.filter((x) => Array.isArray(x.fields.supersedes) && (x.fields.supersedes as string[]).includes(d.id) && x.fields.optionId !== option.id)) {
      const title = (later.fields.terms as { title?: string } | undefined)?.title ?? later.title.replace(/^Approved: /, "");
      out.push({ at: String(later.fields.approvedAt ?? later.createdAt), text: `Replaced by ${later.fields.code ? `${String(later.fields.code)} ` : ""}${title}${later.fields.reason ? `. Why: ${String(later.fields.reason)}` : ""}`, tone: "replaced" });
    }
  }
  // A revised copy made from it, or the option it revises
  for (const copy of items.filter((i) => i.kind === "option" && i.fields.revises === option.id)) out.push({ at: copy.createdAt, text: `Revised terms drafted as "${copy.title}"`, tone: "revised" });
  const from = typeof option.fields.revises === "string" ? items.find((i) => i.id === option.fields.revises) : undefined;
  if (from) out[0] = { at: option.createdAt, text: `Drafted as revised terms for "${from.title}"`, tone: "added" };
  // The invoices billed on its decisions: issued, paid, or voided
  const ids = new Set(mine.map((d) => d.id));
  for (const inv of items.filter((i) => i.kind === "invoice" && i.status !== "draft")) {
    const f = InvoiceFields.parse(inv.fields);
    if (!f.lines.some((l) => ids.has(l.ref ?? ""))) continue;
    if (f.issuedAt) out.push({ at: f.issuedAt, text: `${f.number ?? "Invoice"} issued for ${money(invoiceTotal(f))}`, tone: "billed" });
    // Money received on it (a bank transfer still clearing, or one the bank refused, isn't counted)
    for (const pay of items.filter((i) => i.kind === "payment" && i.fields.invoiceId === inv.id && i.status !== "pending" && i.status !== "failed")) {
      out.push({ at: String(pay.fields.receivedAt ?? pay.createdAt), text: `${money(Number(pay.fields.amountCents) || 0)} received on ${f.number ?? "the invoice"}`, tone: "paid" });
    }
    if (f.voided) out.push({ at: f.voided.at, text: `${f.number ?? "Invoice"} voided: ${f.voided.reason}`, tone: "void" });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
