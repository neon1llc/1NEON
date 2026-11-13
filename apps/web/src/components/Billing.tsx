// apps/web/src/components/Billing.tsx - Signing and paying in 1NEON: the signature box used by the
// agreement, approvals, and handover acceptance; the note that asks for the service agreement; how a
// price adds up and the hours logged against an estimate; and a project's invoices with Pay for the
// client and draft, issue, void, credit, and record payment for neon1.


import { AGREEMENT_EDITION, InvoiceFields, PaymentFields, SIGN_CONSENT, balanceOf, currentDecision, depositLines, dollars, failedOn, finalLines, reimbursementLines, hoursRange, hoursStanding, hoursText, invoiceState, invoiceTotal, isOwnOrg, lineCents, money, payableOn, paymentPlan, priceMeaning, priceOf, received, signedNameProblem, todayIn, type BasisLine, type InvoiceLine, type InvoiceType, type Item, type PaymentMethod, type PriceTerms, type Project } from "@1neon/domain";
import { Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useHref, useLocation, useSearchParams } from "react-router";
import { api, DEMO, HttpError, NEW_TAB, send } from "../lib/api.ts";
import { problem, useRefresh } from "../lib/hooks.ts";
import { useDeleteItem } from "./ItemPanel.tsx";
import { useOrg, useSession } from "./Shell.tsx";
import { Dialog, Money, dateLabel, useToast } from "./ui.tsx";


// --- Paying ---------------------------------------------------------------------------------

/**
 * Pay opens Stripe's page in this tab; without online payment, the invoice's other ways to pay stand.
 * Shared by the project's Invoices and the invoice page, so both say the same thing. Returns the Pay
 * action and, for the demo, the stand-in payment page to render beside it
 */
export function usePay(path: string): [(inv: Pick<Item, "id">) => Promise<void>, ReactNode] {
  const { org } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [demo, setDemo] = useState<DemoSession>();
  const pay = async (inv: Pick<Item, "id">) => {
    try {
      const r = await api<{ url: string }>(`${path}/invoices/${inv.id}/pay`, { method: "POST" });
      // The demo answers with its own address: no money moves, so a stand-in page opens right here
      if (r.url.startsWith("demo:")) setDemo(demoSession(r.url));
      else window.location.assign(r.url);
    } catch (e) {
      toast(e instanceof HttpError && (e.body.error === "payments_off" || e.body.error === "clearing") ? String(e.body.message) : problem(e));
      refresh();
    }
  };
  const page = DEMO ? <DemoCheckout session={demo} onClose={() => setDemo(undefined)} onPaid={() => { setDemo(undefined); toast(PAID_NOTE); refresh(); }} /> : null;
  return [pay, page];
}

// Said once a payment page hands the person back, real or stand-in
const PAID_NOTE = "Thank you. A card payment shows as paid in a moment. A bank payment shows as started, then as paid once it clears in a few business days.";


// --- The demo's stand-in for the payment page ---------------------------------------------------

/** What the demo's Checkout address carries: the session, the amount, and the invoice it pays */
type DemoSession = { id: string; amountCents: number; invoiceNumber: string; metadata: { tenantId: string; projectId: string; invoiceId: string } };

const demoSession = (url: string): DemoSession => {
  const q = new URLSearchParams(url.slice(url.indexOf("?") + 1));
  return { id: q.get("session")!, amountCents: Number(q.get("amount")), invoiceNumber: q.get("invoice")!, metadata: { tenantId: q.get("tenantId")!, projectId: q.get("projectId")!, invoiceId: q.get("invoiceId")! } };
};

/** Tell the in-browser API what a payment page would: paid, started (a bank transfer), cleared, or refused */
export async function demoPaymentEvent(s: DemoSession, what: "card" | "bank_started" | "bank_cleared" | "bank_refused") {
  const type = what === "bank_cleared" ? "checkout.session.async_payment_succeeded" : what === "bank_refused" ? "checkout.session.async_payment_failed" : "checkout.session.completed";
  const event = { id: `evt_demo_${s.id}_${what}`, type, data: { object: { object: "checkout.session", id: s.id, payment_status: what === "card" || what === "bank_cleared" ? "paid" : "unpaid", amount_total: s.amountCents, payment_method_types: [what === "card" ? "card" : "us_bank_account"], metadata: s.metadata } } };
  await send("/1NEON/api/billing/stripe", { method: "POST", headers: { "stripe-signature": "demo" }, body: JSON.stringify(event) });
}

/** The stand-in page: it says plainly what it is, and lets the visitor choose how the payment goes */
function DemoCheckout({ session, onClose, onPaid }: { session?: DemoSession; onClose: () => void; onPaid: () => void }) {
  const go = async (what: "card" | "bank_started") => {
    await demoPaymentEvent(session!, what);
    onPaid();
  };
  return (
    <Dialog open={Boolean(session)} onClose={onClose} label="A stand-in for the payment page">
      <div className="demo-pay">
        <h2>A stand-in for the payment page</h2>
        <p className="small muted">This is a demo, so no money moves. In 1NEON, Pay opens Stripe's secure page, and 1NEON never sees bank or card details.</p>
        <p>{session ? <>Pay <b>{money(session.amountCents)}</b> on {session.invoiceNumber}:</> : null}</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => void go("bank_started")}>Pay from a bank account</button>
          <button type="button" className="btn btn-ghost" onClick={() => void go("card")}>Pay by card</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
        <p className="small muted">A bank payment (ACH) shows as started, then as paid once the bank clears it in a few business days. A card shows as paid at once.</p>
      </div>
    </Dialog>
  );
}

/** The demo has no bank, so the visitor plays it for a transfer on its way: it clears, or is refused */
export function DemoBank({ payment, onDone }: { payment: Item; onDone: () => void }) {
  const session = { id: String((payment.fields.stripe as { session?: string } | undefined)?.session ?? ""), amountCents: Number(payment.fields.amountCents), invoiceNumber: "", metadata: { tenantId: payment.tenantId, projectId: payment.projectId, invoiceId: String(payment.fields.invoiceId) } };
  if (!session.id) return null;
  const say = async (what: "bank_cleared" | "bank_refused") => {
    await demoPaymentEvent(session, what);
    onDone();
  };
  return (
    <span className="demo-bank">
      <span className="small muted">In this demo, you play the bank:</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void say("bank_cleared")}>Clear the payment</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void say("bank_refused")}>Refuse it</button>
    </span>
  );
}


// --- Signing ---------------------------------------------------------------------------------

/** A signature as the API takes it */
export type SignValue = { typedName: string; consent: boolean };
// The signed-in person's profile name, kept where signReady can read it without a hook; SignBox sets it
let signerName: string | undefined;
/** Ready to send: the consent box ticked and a name that reads as the signer's (see signedNameProblem) */
export const signReady = (v: SignValue) => v.typedName.trim().length >= 2 && v.consent && !signedNameProblem(v.typedName, signerName);

/** Type your full name and tick the consent box; the name, as typed, is the signature */
export function SignBox({ value, onChange, id = "sign" }: { value: SignValue; onChange: (v: SignValue) => void; id?: string }) {
  const me = useSession();
  signerName = me.user.name || undefined;
  const wrong = value.typedName.trim().length >= 2 ? signedNameProblem(value.typedName, signerName) : undefined;
  return (
    <div className="sign-box">
      <label htmlFor={`${id}-name`}>Type your full name to sign</label>
      <input id={`${id}-name`} className="sign-name" value={value.typedName} onChange={(e) => onChange({ ...value, typedName: e.target.value })} maxLength={120} autoComplete="name" required placeholder={signerName} aria-invalid={wrong ? true : undefined} aria-describedby={wrong ? `${id}-wrong` : undefined} />
      {wrong && <span id={`${id}-wrong`} className="small warn-text">{wrong}</span>}
      <label className="sign-consent">
        <input type="checkbox" checked={value.consent} onChange={(e) => onChange({ ...value, consent: e.target.checked })} /> {SIGN_CONSENT}
      </label>
    </div>
  );
}

/** Has this organization signed the current edition of the service agreement? neon1's own never needs to */
export function useAgreementSigned() {
  const { org } = useOrg();
  return isOwnOrg(org.slug) || (org.agreements ?? []).some((a) => a.ref === AGREEMENT_EDITION);
}

/** Before an approval: the agreement still needs signing, by an admin of the organization. The link
 * carries the page it was on, so the agreement can lead straight back once it's signed */
export function AgreementNeeded() {
  const { org, access } = useOrg();
  const me = useSession();
  const loc = useLocation();
  const to = `/o/${org.slug}/agreement?back=${encodeURIComponent(loc.pathname + "#options")}`;
  return (
    <p className="notice small agreement-needed">
      {access === "admin" && !me.operator
        ? <>Before approving, sign neon1's service agreement (edition {AGREEMENT_EDITION}). You sign it once, and it covers every project. <Link to={to}>Read and sign it</Link></>
        : <>Approving waits until an admin of {org.name} signs neon1's service agreement. <Link to={to}>Read it</Link></>}
    </p>
  );
}


// --- Prices and hours ------------------------------------------------------------------------

/** A price's terms with the hours behind it, as an option or a decision's copied terms carry them */
export type Priced = PriceTerms & { basis?: BasisLine[] };

/**
 * How a price adds up, shown wherever a price is: what kind it is and what that means for the person
 * paying, the work behind the hours, and when the money is due. Nothing shows for a price in words only
 */
export function PriceBasis({ terms, open = false }: { terms: Priced; open?: boolean }) {
  const p = priceOf(terms);
  if (!p) return null;
  const basis = terms.basis ?? [];
  const sum = basis.reduce((n, b) => n + b.hours, 0);
  return (
    <details className="basis" open={open}>
      <summary>How this adds up</summary>
      <p className="small">{priceMeaning(p)}</p>
      {basis.length > 0 && (
        <table className="basis-table small">
          <caption className="sr">The work behind the hours</caption>
          <tbody>
            {basis.map((b, i) => <tr key={i}><th scope="row">{b.work}</th><td>{hoursText(b.hours)}</td></tr>)}
            <tr className="total"><th scope="row">Expected</th><td>{hoursText(sum)}</td></tr>
          </tbody>
        </table>
      )}
      {/* The range is the honest part of an estimate: say why there is one */}
      {p.kind === "estimate" && p.hoursLow !== p.hoursHigh && <p className="small muted">The range, {hoursRange(p)}, allows for what can't be known until the work starts. If it looks like going past the high end, neon1 says so before it happens, and you decide.</p>}
      <p className="basis-h">When you pay</p>
      <ul className="basis-pay small">{paymentPlan(p).map((l) => <li key={l}>{l}</li>)}</ul>
    </details>
  );
}

/**
 * Hours on an hourly estimate, under Execute: every entry neon1 logs, the running total against the
 * approved range, and what it comes to so far. The client reads it; neon1 adds entries, and an entry
 * locks once an invoice has billed it. Hidden on a fixed price, which doesn't depend on hours
 */
export function Hours({ items, path }: { items: Item[]; path: string }) {
  const { org } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const terms = (currentDecision(items).decision?.fields.terms ?? {}) as Priced;
  const at = hoursStanding(terms, items);
  const entries = items.filter((i) => i.kind === "time").sort((a, b) => String(a.fields.date).localeCompare(String(b.fields.date)) || a.createdAt.localeCompare(b.createdAt));
  const [date, setDate] = useState(todayIn(org.timeZone));
  const [hours, setHours] = useState("");
  const [what, setWhat] = useState("");
  const [busy, setBusy] = useState(false);
  const remove = useDeleteItem(path);
  if (!at && !entries.length) return null;
  const n = Number(hours);
  // Quarter hours, as the API takes them
  const ready = what.trim().length >= 3 && n > 0 && n <= 24 && Number.isInteger(n * 4);
  const add = async () => {
    setBusy(true);
    try {
      await api(`${path}/items`, { method: "POST", body: { kind: "time", title: what.trim(), fields: { date, hours: n } } });
      setHours("");
      setWhat("");
    } catch (e) {
      toast(problem(e));
    }
    setBusy(false);
    refresh();
  };
  const number = (id: unknown) => String(items.find((i) => i.id === id)?.fields.number ?? "an invoice");
  return (
    <section className="kind-group" id="hours">
      <h2 className="section-h">Hours <small>{at ? `${Number(at.logged.toFixed(2))} of ${hoursRange(at.price)}` : hoursText(entries.reduce((s, i) => s + Number(i.fields.hours || 0), 0))}</small></h2>
      {at ? (
        <div className="hours-at">
          <p className="small" style={{ margin: 0 }}>
            <b>{hoursText(at.logged)} logged</b>{at.logged > 0 && <> at {dollars(at.price.rateCents)} an hour: <b>{dollars(at.earnedCents)}</b> so far</>}. The estimate is {hoursRange(at.price)} ({dollars(at.price.lowCents)} to {dollars(at.price.highCents)}), and the total can't pass {dollars(at.price.highCents)} unless you approve a change first.
            {at.over > 0 && <> {hoursText(at.over)} past the high end {at.over === 1 ? "is" : "are"} listed here and not billed.</>}
          </p>
          {/* The bar runs to the high end; the mark is the low end */}
          <div className="hours-bar" role="img" aria-label={`${hoursText(at.logged)} of ${hoursRange(at.price)}`}>
            <i style={{ width: `${Math.min(100, (at.logged / at.price.hoursHigh) * 100)}%` }} />
            <b style={{ left: `${(at.price.hoursLow / at.price.hoursHigh) * 100}%` }} />
          </div>
        </div>
      ) : <p className="small muted">This project has a fixed price, so these hours are a record of the work, not a bill.</p>}
      {entries.length > 0 && (
        <table className="hours-table small">
          <thead><tr><th scope="col">Date</th><th scope="col">Work done</th><th scope="col" className="num">Hours</th><th scope="col"><span className="sr">Billing</span></th></tr></thead>
          <tbody>
            {entries.map((i) => (
              <tr key={i.id} id={`item-${i.id}`}>
                <td className="nowrap">{dateLabel(String(i.fields.date))}</td>
                <td>{i.title}</td>
                <td className="num">{Number(Number(i.fields.hours).toFixed(2))}</td>
                <td className="nowrap">
                  {i.fields.invoiceId ? <span className="tag">billed on {number(i.fields.invoiceId)}</span>
                    : me.operator ? <button type="button" className="icon-act del" onClick={() => void remove(i, "Hours entry")} aria-label={`Delete the entry: ${i.title}`} title="Delete"><Trash2 size={15} aria-hidden="true" /></button>
                    : <span className="muted">not billed yet</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!entries.length && <p className="small muted">No hours logged yet. Each entry appears here as the work is done.</p>}
      {/* neon1 logs its own hours; the client only reads them */}
      {me.operator && at && (
        <form className="hours-add" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void add(); }}>
          <div><label htmlFor="hours-date">Date</label><input id="hours-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
          <div><label htmlFor="hours-n">Hours</label><input id="hours-n" type="number" min={0.25} max={24} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} required /></div>
          <div className="grow"><label htmlFor="hours-what">Work done</label><input id="hours-what" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={200} placeholder="e.g. Built the order form and pickup rules" required /></div>
          <button className="btn btn-ghost btn-sm" disabled={!ready || busy}>Log hours</button>
        </form>
      )}
    </section>
  );
}


// --- Invoices ----------------------------------------------------------------------------------

const TYPE_WORDS: Record<InvoiceType, string> = { deposit: "Deposit", progress: "Progress", final: "Final", reimbursement: "Purchases at cost", retainer: "Care plan", credit: "Credit" };
const STATE_WORDS = { draft: "draft, only neon1 sees it", open: "open", partly_paid: "partly paid", clearing: "bank payment clearing", overdue: "overdue", paid: "paid", void: "void", credit: "credit" } as const;
const METHOD_WORDS: Record<PaymentMethod, string> = { ach: "bank transfer (ACH)", card: "card", check: "check", zelle: "Zelle", wire: "wire", other: "other" };

/** Dollars typed by a person ("1,250.50") as cents, or undefined when it isn't an amount */
const centsOf = (s: string, signed = false) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() && Number.isFinite(n) && (n > 0 || (signed && n < 0)) ? Math.round(n * 100) : undefined;
};

/**
 * A project's invoices in Execute: every issued invoice with what's left to pay and Pay for the client;
 * for neon1, the drafts too, with issue, void, credit, and payments received by hand
 */
export function Invoices({ items, path, project }: { items: Item[]; path: string; project: Project }) {
  const { org } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Item>();
  const [voiding, setVoiding] = useState<Item>();
  const invoices = items.filter((i) => i.kind === "invoice").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const today = todayIn(org.timeZone);

  // Back from Stripe: say what happens next, once
  useEffect(() => {
    if (!params.get("paid")) return;
    toast(PAID_NOTE);
    params.delete("paid");
    setParams(params, { replace: true });
  }, [params, setParams, toast]);

  const act = async (url: string, body: unknown, done: string) => {
    try {
      await api(url, { method: "POST", body });
      toast(done);
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };
  const [pay, payPage] = usePay(path);
  // neon1's own organization is its own client: there neon1 pays like any client would
  const own = isOwnOrg(org.slug);
  // The invoice's page, where the client reads it and pays: a link neon1 can send by text or email
  const root = useHref("/").replace(/\/$/, "");
  const copyLink = async (inv: Item) => {
    const url = `${location.origin}${root}/o/${org.slug}/projects/${project.key}/invoices/${inv.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Copied. The client opens it, signed in, and pays with Pay.");
    } catch {
      toast(url);
    }
  };
  if (!invoices.length && !me.operator) return null;
  return (
    <section className="kind-group" id="billing">
      <h2 className="section-h">Invoices <small>{invoices.filter((i) => i.status !== "draft").length}</small></h2>
      {invoices.map((inv) => {
        const f = InvoiceFields.parse(inv.fields);
        const state = invoiceState(inv, items, today);
        const left = balanceOf(inv, items);
        // Money received, bank transfers still clearing, and what's left to pay once those are counted
        const on = items.filter((i) => i.kind === "payment" && i.fields.invoiceId === inv.id);
        const paidOn = on.filter(received).map((i) => PaymentFields.parse(i.fields));
        const clearing = on.filter((i) => i.status === "pending");
        const payable = payableOn(inv, items);
        const failed = failedOn(inv, items);
        return (
          <div key={inv.id} className={`item invoice-row is-${state}`} id={`item-${inv.id}`}>
            <span style={{ width: 18 }} />
            <div>
              <div className="invoice-head">
                <Link className="title" to={`/o/${org.slug}/projects/${project.key}/invoices/${inv.id}`} {...NEW_TAB}>{f.number ?? `${TYPE_WORDS[f.type]} draft`}</Link>
                <span className="tag">{TYPE_WORDS[f.type]}</span>
                <span className={`tag${state === "overdue" ? " warn" : state === "paid" ? " client" : ""}`}>{STATE_WORDS[state]}</span>
              </div>
              <div className="purchase-meta">
                <span>{money(invoiceTotal(f))}</span>
                {f.dueDate && state !== "paid" && state !== "void" && state !== "credit" && <span className="muted">due {dateLabel(f.dueDate)}</span>}
                {left > 0 && left < invoiceTotal(f) && <span>{money(left)} left</span>}
                {paidOn.map((x, i) => <span key={i} className="muted">{money(x.amountCents)} by {METHOD_WORDS[x.method]}, {dateLabel(x.receivedAt)}</span>)}
                {clearing.map((x) => <span key={x.id} className="muted">{money(Number(x.fields.amountCents))} bank payment started {dateLabel(String(x.fields.receivedAt))}; it clears in a few business days</span>)}
                {failed && <span className="warn-text">the bank payment of {money(failed.amountCents)} started {dateLabel(failed.receivedAt)} didn't go through</span>}
                {f.voided && <span className="muted">voided: {f.voided.reason}</span>}
              </div>
              <div className="line" style={{ marginTop: 6 }}>
                {/* The client pays what's left; neon1 manages its drafts and records what arrives */}
                {payable > 0 && (!me.operator || own) && <button className="btn btn-primary btn-sm" onClick={() => void pay(inv)}>{failed ? "Pay again: " : "Pay "}{money(payable)}</button>}
                {/* neon1 in a client's organization: the client pays from here; neon1 can send them the page */}
                {payable > 0 && me.operator && !own && <button className="btn btn-ghost btn-sm" onClick={() => void copyLink(inv)}>Copy the pay link</button>}
                {/* The demo has no bank, so the visitor plays it: the transfer clears, or is refused */}
                {DEMO && clearing.map((x) => <DemoBank key={x.id} payment={x} onDone={refresh} />)}
                {me.operator && inv.status === "draft" && <button className="btn btn-primary btn-sm" onClick={() => void act(`${path}/invoices/${inv.id}/issue`, { version: inv.version }, own ? "Issued. It's open to pay now." : "Issued. The client is told and can pay it now.")}>Issue</button>}
                {me.operator && payable > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setPaying(inv)}>Record a payment</button>}
                {me.operator && inv.status === "issued" && !paidOn.length && !clearing.length && f.type !== "credit" && <button className="btn btn-ghost btn-sm" onClick={() => setVoiding(inv)}>Void</button>}
              </div>
            </div>
          </div>
        );
      })}
      {me.operator && <div className="actions" style={{ marginTop: 10 }}><button className="btn btn-ghost btn-sm" onClick={() => setCreating(true)}>New invoice</button></div>}
      <NewInvoice open={creating} onClose={() => setCreating(false)} path={path} items={items} issued={invoices.filter((i) => i.status === "issued" || i.status === "paid")} />
      <RecordPayment invoice={paying} items={items} onClose={() => setPaying(undefined)} onSave={(body) => { const inv = paying!; setPaying(undefined); void act(`${path}/invoices/${inv.id}/payments`, body, "Payment recorded."); }} />
      {payPage}
      <Dialog open={Boolean(voiding)} onClose={() => setVoiding(undefined)} label="Void invoice">
        <VoidForm onCancel={() => setVoiding(undefined)} onVoid={(reason) => { const inv = voiding!; setVoiding(undefined); void act(`${path}/invoices/${inv.id}/void`, { version: inv.version, reason }, "Voided. It stays on record, marked void."); }} />
      </Dialog>
    </section>
  );
}

/** Why an invoice is void, in a sentence the client will read */
function VoidForm({ onVoid, onCancel }: { onVoid: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <form className="stack-form" onSubmit={(e) => { e.preventDefault(); onVoid(reason.trim()); }}>
      <h2>Void this invoice?</h2>
      <p className="small muted">It stays on record, marked void, with your reason. Nobody can pay it afterwards.</p>
      <label htmlFor="void-reason">Reason</label>
      <input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} required />
      <div className="actions"><button className="btn btn-primary" disabled={reason.trim().length < 3}>Void it</button><button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

/** A payment that arrived by check, Zelle, or wire (or one Stripe didn't report) */
function RecordPayment({ invoice, items, onClose, onSave }: { invoice?: Item; items: Item[]; onClose: () => void; onSave: (body: unknown) => void }) {
  const { org } = useOrg();
  // What can still be recorded: the balance, less a bank payment on its way
  const left = invoice ? payableOn(invoice, items) : 0;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [ref, setRef] = useState("");
  const [on, setOn] = useState(todayIn(org.timeZone));
  // Each invoice starts from what's owed on it
  useEffect(() => { if (invoice) setAmount((left / 100).toFixed(2)); }, [invoice, left]);
  const cents = centsOf(amount);
  return (
    <Dialog open={Boolean(invoice)} onClose={onClose} label="Record a payment">
      <form className="stack-form" onSubmit={(e) => { e.preventDefault(); if (cents) onSave({ amountCents: cents, method, ref: ref.trim(), receivedAt: on }); }}>
        <h2>Record a payment on {String(invoice?.fields.number ?? "")}</h2>
        <p className="small muted">{money(left)} is owed.</p>
        <label htmlFor="pay-amount">Amount</label>
        <Money id="pay-amount" value={amount} onChange={setAmount} required style={{ maxWidth: 220 }} />
        <label htmlFor="pay-method">How it arrived</label>
        <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {(Object.keys(METHOD_WORDS) as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_WORDS[m]}</option>)}
        </select>
        <label htmlFor="pay-ref">Check number or confirmation (optional)</label>
        <input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} />
        <label htmlFor="pay-on">Received on</label>
        <input id="pay-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} required style={{ maxWidth: 220 }} />
        <div className="actions"><button className="btn btn-primary" disabled={!cents || cents > left}>Record {cents ? money(cents) : ""}</button>{cents !== undefined && cents > left && <span className="small warn-text">That's more than the {money(left)} owed.</span>}<button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

/** neon1 drafts an invoice: 1NEON fills in the lines it would suggest for a deposit, the final balance,
 * or purchases at cost, and every line stays editable: change an amount, reword it, or add your own */
function NewInvoice({ open, onClose, path, items, issued }: { open: boolean; onClose: () => void; path: string; items: Item[]; issued: Item[] }) {
  const { org } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [type, setType] = useState<InvoiceType>("deposit");
  const [lines, setLines] = useState<{ text: string; amount: string; ref?: string }[]>([]);
  const [appliesTo, setAppliesTo] = useState("");
  const [terms, setTerms] = useState("15");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // What 1NEON suggests for this kind of invoice, from the decision in force or neon1's receipts
  const suggest = (t: InvoiceType) => {
    const d = currentDecision(items).decision;
    const out = t === "deposit" ? (d ? depositLines(d, undefined, items) : []) : t === "final" || t === "progress" ? (d ? finalLines(d, items) : []) : t === "reimbursement" ? reimbursementLines(items) : [];
    return out.map((l) => ({ text: l.text, amount: (lineCents(l) / 100).toFixed(2), ref: l.ref }));
  };
  // Each time the form opens, or the kind changes, it starts from the suggestion (or one empty line)
  useEffect(() => {
    if (!open) return;
    const s = suggest(type);
    setLines(s.length ? s : [{ text: "", amount: "" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type]);
  // A line with an amount but no words is named for the kind of invoice, so it's never dropped
  const typed: InvoiceLine[] = lines.flatMap((l) => {
    const cents = centsOf(l.amount, true);
    if (cents === undefined) return [];
    return [{ text: (l.text.trim() || TYPE_WORDS[type]).slice(0, 200), qty: 1, unitCents: cents, ref: l.ref }];
  });
  const total = typed.reduce((n, l) => n + l.unitCents, 0);
  const unread = lines.filter((l) => l.amount.trim() && centsOf(l.amount, true) === undefined).length;
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`${path}/invoices`, { method: "POST", body: { type, lines: typed.length ? typed : undefined, appliesTo: type === "credit" ? appliesTo : undefined, termsDays: Number(terms), note: note.trim() } });
      toast("Draft saved. Check it, then Issue.");
      setNote("");
      onClose();
    } catch (e) {
      toast(problem(e));
    }
    setBusy(false);
    refresh();
  };
  const ready = typed.length > 0 && total > 0 && !unread && (type !== "credit" || Boolean(appliesTo));
  return (
    <Dialog open={open} onClose={onClose} label="New invoice">
      <form className="stack-form" onSubmit={(e) => { e.preventDefault(); if (ready) void save(); }}>
        <h2>New invoice</h2>
        <label htmlFor="inv-type">What it's for</label>
        <select id="inv-type" value={type} onChange={(e) => setType(e.target.value as InvoiceType)}>
          {(Object.keys(TYPE_WORDS) as InvoiceType[]).map((t) => <option key={t} value={t}>{TYPE_WORDS[t]}</option>)}
        </select>
        {type === "credit" && (
          <>
            <label htmlFor="inv-applies">Reduces</label>
            <select id="inv-applies" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} required>
              <option value="">Choose an invoice</option>
              {issued.filter((i) => i.fields.type !== "credit").map((i) => <option key={i.id} value={i.id}>{String(i.fields.number)}</option>)}
            </select>
          </>
        )}
        <p className="small muted">{suggest(type).length ? "Filled in from the approved option or the receipts. Change any amount or wording, or add a line." : "Add each line with what it's for and the amount."}</p>
        <fieldset className="inv-lines">
          <legend>Lines</legend>
          {lines.map((l, i) => (
            <div className="inv-line" key={i}>
              <input aria-label={`Line ${i + 1}: what it's for`} placeholder={`What it's for (e.g. ${TYPE_WORDS[type]})`} value={l.text} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} maxLength={200} />
              <Money label={`Line ${i + 1}: amount in dollars`} placeholder="0.00" value={l.amount} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: v } : x)))} invalid={Boolean(l.amount.trim()) && centsOf(l.amount, true) === undefined} />
              {lines.length > 1 && <button type="button" className="icon-act del" aria-label={`Remove line ${i + 1}`} title="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={15} aria-hidden="true" /></button>}
            </div>
          ))}
          <div className="inv-lines-foot">
            <button type="button" className="chip" onClick={() => setLines([...lines, { text: "", amount: "" }])}>Add a line</button>
            <span className="small">{unread ? <span className="warn-text">Type each amount as a number, like 200 or 1,250.50.</span> : <>Total <b>{money(total)}</b></>}</span>
          </div>
        </fieldset>
        <label htmlFor="inv-terms">Due in (days)</label>
        <input id="inv-terms" type="number" inputMode="numeric" min={0} max={90} value={terms} onChange={(e) => setTerms(e.target.value)} style={{ maxWidth: 120 }} />
        <label htmlFor="inv-note">Note on the invoice (optional)</label>
        <textarea id="inv-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Deposit of 20% of the low end, as agreed" />
        <div className="actions"><button className="btn btn-primary" disabled={!ready || busy}>{busy ? "Saving…" : `Save draft${total > 0 ? ` for ${money(total)}` : ""}`}</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}


/** One invoice line's amount, for the printed invoice */
export const lineAmount = (l: InvoiceLine) => money(lineCents(l));
