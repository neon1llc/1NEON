// apps/web/src/pages/Invoice.tsx - /o/:slug/projects/:key/invoices/:iid: one invoice on neon1's
// letterhead, ready to read, print, or save as a PDF. An issued invoice shows exactly what was issued
// (number, lines, due date, and the hash that fixes them), what has been paid, and what is left.


import { InvoiceFields, PaymentFields, balanceOf, currentDecision, failedOn, hoursText, invoiceState, invoiceTotal, money, payableOn, priceOf, received, todayIn, type Item, type PaymentMethod, type PriceTerms } from "@1neon/domain";
import { Printer } from "lucide-react";
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { lineAmount, usePay } from "../components/Billing.tsx";
import { gate } from "../components/Reads.tsx";
import { useOrg, useSession, useTopBar } from "../components/Shell.tsx";
import { Empty } from "../components/ui.tsx";
import { DEMO } from "../lib/api.ts";
import { FICTIONAL } from "../lib/docx.ts";
import { useProject, useProjects } from "../lib/hooks.ts";


// A long date, the way a letter writes it
const longDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: iso.length === 10 ? "UTC" : undefined });
const METHOD: Record<PaymentMethod, string> = { ach: "Bank transfer (ACH)", card: "Card", check: "Check", zelle: "Zelle", wire: "Wire", other: "Other" };
const TYPE: Record<string, string> = { deposit: "Deposit", progress: "Progress", final: "Final", reimbursement: "Purchases at cost", retainer: "Care plan", credit: "Credit" };


/** One invoice of one project, by its ID */
export function InvoicePage() {
  const { org, summary } = useOrg();
  const { key, iid } = useParams();
  const projects = useProjects(org.id);
  const pid = projects.data?.find((p) => p.key === key)?.id;
  const detail = useProject(org.id, pid);
  const me = useSession();
  const [pay, payPage] = usePay(`/t/${org.id}/projects/${pid}`);
  const base = `/o/${summary.slug}/projects/${key}`;
  useTopBar(<span><Link to={`/o/${summary.slug}/projects`}>Projects</Link> / <Link to={base}>{key}</Link> / Invoice</span>, [key, summary.slug]);
  const it = detail.data?.items.find((i) => i.id === iid && i.kind === "invoice");
  const f = it && InvoiceFields.parse(it.fields);
  const title = f?.number ?? "Invoice draft";
  // The browser tab and a saved PDF are named for the invoice
  useEffect(() => {
    const was = document.title;
    document.title = `${title} · ${org.name} · 1NEON`;
    return () => { document.title = was; };
  }, [title, org.name]);
  const out = { to: `${base}/execute#billing`, label: "Back to the project" };
  const wait = gate([projects, detail], { out });
  if (wait) return wait;
  if (!it || !f) return <Empty text="That invoice isn't here." action={<Link className="btn btn-ghost" to={`${base}/execute#billing`}>Invoices</Link>} />;
  const items = detail.data!.items;
  const state = invoiceState(it, items, todayIn(org.timeZone));
  const total = invoiceTotal(f);
  const left = balanceOf(it, items);
  // Money received reduces the balance; a bank transfer still clearing is shown but not yet counted,
  // and what can be paid now leaves it out, so nobody pays twice
  const on = items.filter((i) => i.kind === "payment" && i.fields.invoiceId === it.id);
  const payments = on.filter(received).map((i) => PaymentFields.parse(i.fields));
  const clearing = on.filter((i) => i.status === "pending").map((i) => PaymentFields.parse(i.fields));
  const payable = payableOn(it, items);
  const failed = failedOn(it, items);
  const credits = items.filter((i) => i.kind === "invoice" && i.status !== "void" && i.status !== "draft" && i.fields.appliesTo === it.id).map((i) => InvoiceFields.parse(i.fields));
  const reduces = f.appliesTo ? items.find((i) => i.id === f.appliesTo) : undefined;
  // The hours this invoice bills, entry by entry: the ones stamped with it once issued; on a draft
  // for an hourly estimate, the ones not billed yet, which issuing will stamp
  const hourly = priceOf((currentDecision(items).decision?.fields.terms ?? {}) as PriceTerms)?.kind === "estimate";
  const forHours = hourly && (f.type === "final" || f.type === "progress");
  const mine = (i: Item) => (it.status === "draft" ? forHours && !i.fields.invoiceId : i.fields.invoiceId === it.id);
  // Its hours line counts every hour so far and subtracts earlier invoices, so hours those invoices
  // listed are shown again, marked with the invoice they were on, and the total matches the line
  const before = new Map(items.filter((i) => i.kind === "invoice" && i.id !== it.id && i.status !== "draft" && i.status !== "void" && (it.status === "draft" || String(i.fields.issuedAt ?? "") < String(f.issuedAt ?? ""))).map((i) => [i.id, String(i.fields.number ?? "")]));
  const hours = items
    .filter((i) => i.kind === "time" && (mine(i) || (forHours && before.has(String(i.fields.invoiceId)))))
    .sort((a, b) => String(a.fields.date).localeCompare(String(b.fields.date)) || a.createdAt.localeCompare(b.createdAt));
  const carried = hours.some((h) => !mine(h));
  return (
    <>
      <div className="pp-tools">
        <Link className="btn btn-ghost btn-sm" to={`${base}/execute#billing`}>Back to invoices</Link>
        {/* The client pays what's left right here, as from the project's Invoices */}
        {!me.operator && f.type !== "credit" && it.status === "issued" && payable > 0 && <button type="button" className="btn btn-primary btn-sm" onClick={() => void pay(it)}>{failed ? "Pay again: " : "Pay "}{money(payable)}</button>}
        <button type="button" className={`btn ${!me.operator && payable > 0 && it.status === "issued" ? "btn-ghost" : "btn-primary"} btn-sm`} onClick={() => window.print()}><Printer size={15} aria-hidden="true" /> Print or save as PDF</button>
      </div>
      {payPage}
      {/* A bank payment on its way, or one the bank refused, is said before anything else */}
      {clearing.map((x, i) => <p key={i} className="pp-state" role="status">A bank payment of {money(x.amountCents)} was started on {longDate(x.receivedAt)}. It takes a few business days to clear, and you'll be told when it does.{payable > 0 ? ` ${money(payable)} more is owed.` : " There's nothing more to pay."}</p>)}
      {failed && <p className="pp-state warn" role="status">The bank payment of {money(failed.amountCents)} started on {longDate(failed.receivedAt)} didn't go through, so no money moved and {money(payable)} is still owed. {me.operator ? "The client can pay again, by bank or card, or another way." : "You can pay again, by bank or card, or one of the other ways below."}</p>}
      {it.status === "draft" && <p className="pp-state" role="status">Draft, only neon1 sees it. Issuing numbers it and shows it to the client.</p>}
      {state === "void" && <p className="pp-state warn" role="status">Void{f.voided ? `: ${f.voided.reason}` : ""}. Nothing is owed on it.</p>}
      <article className={`proposal invoice${state === "void" ? " pp-faded" : ""}`} aria-labelledby="inv-h1">
        {DEMO && <p className="pp-note">{FICTIONAL.replace("proposal", "invoice").replace("Not an offer", "Not a bill")}</p>}
        {/* Letterhead: neon1 left, the invoice's number and dates right */}
        <header className="pp-head">
          <div className="pp-mark">
            <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6a24 24 0 0 1 24 24v30M6 12a18 18 0 0 1 18 18v30M6 18a12 12 0 0 1 12 12v30M6 24a6 6 0 0 1 6 6v30" />
              <path d="M34 6a24 24 0 0 1 24 24v30M34 12a18 18 0 0 1 18 18v30M34 18a12 12 0 0 1 12 12v30M34 24a6 6 0 0 1 6 6v30" />
            </svg>
            <div>
              <b>neon1</b>
              <span>418 Broadway, Ste R, Albany, NY 12207</span>
              <span>hello@neon1.tech · +1 424-326-3661</span>
            </div>
          </div>
          <div className="pp-title">
            <b>{f.billTo?.org ?? org.name}</b>
            <h1 id="inv-h1">{f.type === "credit" ? "Credit" : "Invoice"} {f.number ?? "(draft)"}</h1>
            <span>{TYPE[f.type]} · {detail.data!.project.key} {detail.data!.project.name}</span>
            {f.issuedAt && <span>Issued {longDate(f.issuedAt)}</span>}
            {f.dueDate && f.type !== "credit" && <span>Due {longDate(f.dueDate)}</span>}
          </div>
        </header>

        <table className="pp-facts">
          <tbody>
            <tr><th>Bill to</th><td>{f.billTo ? `${f.billTo.name ? `${f.billTo.name}, ` : ""}${f.billTo.org}` : org.name}</td><th>From</th><td>neon1 LLC</td></tr>
            <tr><th>Email</th><td>{f.billTo?.email ?? "—"}</td><th>Terms</th><td>{f.type === "credit" ? "—" : f.termsDays ? `Due in ${f.termsDays} days` : "Due on receipt"}</td></tr>
          </tbody>
        </table>
        {reduces && <p className="pp-small">This credit reduces {String(reduces.fields.number)}.</p>}

        {/* The lines, then the total, what has come in, and what is left */}
        <table className="pp-costs inv-lines">
          <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead>
          <tbody>
            {f.lines.map((l, i) => <tr key={i}><td>{l.text}</td><td>{l.qty}</td><td>{money(l.unitCents)}</td><td>{lineAmount(l)}</td></tr>)}
            {f.taxCents > 0 && <tr><td>Sales tax</td><td /><td /><td>{money(f.taxCents)}</td></tr>}
          </tbody>
          <tfoot>
            <tr><th colSpan={3}>Total</th><td><b>{money(total)}</b></td></tr>
            {credits.map((c, i) => <tr key={`c${i}`}><th colSpan={3}>Credit {c.number}</th><td>{money(invoiceTotal(c))}</td></tr>)}
            {payments.map((p, i) => <tr key={`p${i}`}><th colSpan={3}>Paid {longDate(p.receivedAt)}, {METHOD[p.method]}{p.ref ? ` (${p.ref})` : ""}</th><td>-{money(p.amountCents)}</td></tr>)}
            {f.type !== "credit" && it.status !== "draft" && <tr><th colSpan={3}>{state === "paid" ? "Paid in full" : "Balance due"}</th><td><b>{money(left)}</b></td></tr>}
            {clearing.map((p, i) => <tr key={`w${i}`} className="inv-clearing"><th colSpan={3}>Bank transfer (ACH) started {longDate(p.receivedAt)}, clearing</th><td>{money(p.amountCents)}</td></tr>)}
          </tfoot>
        </table>
        {f.note && <p>{f.note}</p>}

        {/* An invoice for hours lists each one, so the quantity above can be checked line by line */}
        {hours.length > 0 && (
          <section className="pp-section">
            <h2 className="pp-bar">{carried ? "Hours through this invoice" : "Hours on this invoice"}</h2>
            <table className="pp-hours inv-hours">
              <thead><tr><th>Date</th><th>Work done</th><th>Hours</th></tr></thead>
              <tbody>
                {hours.map((h) => <tr key={h.id}><td>{longDate(String(h.fields.date))}</td><td>{h.title}{!mine(h) && <small> (listed on {before.get(String(h.fields.invoiceId))})</small>}</td><td>{Number(Number(h.fields.hours).toFixed(2))}</td></tr>)}
                <tr className="total"><td colSpan={2}>Total</td><td>{hoursText(hours.reduce((n, h) => n + Number(h.fields.hours || 0), 0))}</td></tr>
              </tbody>
            </table>
          </section>
        )}

        {f.type !== "credit" && payable > 0 && (
          <section className="pp-section">
            <h2 className="pp-bar">How to pay</h2>
            <ul className="pp-list">
              <li>Online in 1NEON: open this invoice or the project's invoices and choose <b>Pay</b>. A bank transfer (ACH) is preferred; cards are accepted too.</li>
              <li>By check to neon1 LLC, 418 Broadway, Ste R, Albany, NY 12207, with {f.number} in the memo.</li>
              <li>By Zelle or wire: ask at hello@neon1.tech for the details, and put {f.number} in the note.</li>
            </ul>
          </section>
        )}
        <p className="pp-small">Under neon1's service agreement. Purchases are billed at cost, as the receipt shows, with no markup.{f.hash ? ` Record ${f.hash.slice(0, 16)}.` : ""}</p>
        <footer className="pp-foot">
          <span>1 is glad to be of service.</span>
          <span>neon1 LLC · Pradeep Tathineni, pradeep@neon1.tech</span>
        </footer>
      </article>
    </>
  );
}
