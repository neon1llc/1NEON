// apps/web/src/components/Billing.tsx - Signing and paying in 1NEON: the signature box used by the
// agreement, approvals, and handover acceptance; the note that asks for the service agreement; how a
// price adds up and the hours logged against an estimate; and a project's invoices with Pay for the
// client and draft, issue, void, credit, and record payment for neon1.


import { AGREEMENT_EDITION, InvoiceFields, PaymentFields, SIGN_CONSENT, balanceOf, currentDecision, dollars, hoursRange, hoursStanding, hoursText, invoiceState, invoiceTotal, isOwnOrg, lineCents, money, paymentPlan, priceMeaning, priceOf, todayIn, type BasisLine, type InvoiceLine, type InvoiceType, type Item, type PaymentMethod, type PriceTerms, type Project } from "@1neon/domain";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { api, DEMO, HttpError } from "../lib/api.ts";
import { problem, useRefresh } from "../lib/hooks.ts";
import { useDeleteItem } from "./ItemPanel.tsx";
import { useOrg, useSession } from "./Shell.tsx";
import { Dialog, dateLabel, useToast } from "./ui.tsx";


// --- Paying ---------------------------------------------------------------------------------

/** Pay opens Stripe's page in this tab; without online payment, the invoice's other ways to pay stand.
 * Shared by the project's Invoices and the invoice page, so both say the same thing */
export function usePay(path: string) {
  const toast = useToast();
  return async (inv: Pick<Item, "id">) => {
    try {
      const r = await api<{ url: string }>(`${path}/invoices/${inv.id}/pay`, { method: "POST" });
      window.location.assign(r.url);
    } catch (e) {
      toast(e instanceof HttpError && e.body.error === "payments_off" ? (DEMO ? "This is a demo, so no money moves. In 1NEON, Pay opens Stripe's secure page." : String(e.body.message)) : problem(e));
    }
  };
}


// --- Signing ---------------------------------------------------------------------------------

/** A signature as the API takes it */
export type SignValue = { typedName: string; consent: boolean };
/** Ready to send: a name of two or more letters and the consent box ticked */
export const signReady = (v: SignValue) => v.typedName.trim().length >= 2 && v.consent;

/** Type your full name and tick the consent box; the name, as typed, is the signature */
export function SignBox({ value, onChange, id = "sign" }: { value: SignValue; onChange: (v: SignValue) => void; id?: string }) {
  return (
    <div className="sign-box">
      <label htmlFor={`${id}-name`}>Type your full name to sign</label>
      <input id={`${id}-name`} className="sign-name" value={value.typedName} onChange={(e) => onChange({ ...value, typedName: e.target.value })} maxLength={120} autoComplete="name" required />
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
const STATE_WORDS = { draft: "draft, only neon1 sees it", open: "open", partly_paid: "partly paid", overdue: "overdue", paid: "paid", void: "void", credit: "credit" } as const;
const METHOD_WORDS: Record<PaymentMethod, string> = { ach: "bank transfer (ACH)", card: "card", check: "check", zelle: "Zelle", wire: "wire", other: "other" };

/** Dollars typed by a person ("1,250.50") as cents, or undefined when it isn't an amount */
const centsOf = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
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
    toast("Thank you. A card payment shows as paid in a moment; a bank payment takes a few business days to clear.");
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
  const pay = usePay(path);
  if (!invoices.length && !me.operator) return null;
  return (
    <section className="kind-group" id="billing">
      <h2 className="section-h">Invoices <small>{invoices.filter((i) => i.status !== "draft").length}</small></h2>
      {invoices.map((inv) => {
        const f = InvoiceFields.parse(inv.fields);
        const state = invoiceState(inv, items, today);
        const left = balanceOf(inv, items);
        const paidOn = items.filter((i) => i.kind === "payment" && i.fields.invoiceId === inv.id).map((i) => PaymentFields.parse(i.fields));
        return (
          <div key={inv.id} className={`item invoice-row is-${state}`} id={`item-${inv.id}`}>
            <span style={{ width: 18 }} />
            <div>
              <div className="invoice-head">
                <Link className="title" to={`/o/${org.slug}/projects/${project.key}/invoices/${inv.id}`}>{f.number ?? `${TYPE_WORDS[f.type]} draft`}</Link>
                <span className="tag">{TYPE_WORDS[f.type]}</span>
                <span className={`tag${state === "overdue" ? " warn" : state === "paid" ? " client" : ""}`}>{STATE_WORDS[state]}</span>
              </div>
              <div className="purchase-meta">
                <span>{money(invoiceTotal(f))}</span>
                {f.dueDate && state !== "paid" && state !== "void" && state !== "credit" && <span className="muted">due {dateLabel(f.dueDate)}</span>}
                {left > 0 && left < invoiceTotal(f) && <span>{money(left)} left</span>}
                {paidOn.map((x, i) => <span key={i} className="muted">{money(x.amountCents)} by {METHOD_WORDS[x.method]}, {dateLabel(x.receivedAt)}</span>)}
                {f.voided && <span className="muted">voided: {f.voided.reason}</span>}
              </div>
              <div className="line" style={{ marginTop: 6 }}>
                {/* The client pays what's left; neon1 manages its drafts and records what arrives */}
                {left > 0 && !me.operator && <button className="btn btn-primary btn-sm" onClick={() => void pay(inv)}>Pay {money(left)}</button>}
                {me.operator && inv.status === "draft" && <button className="btn btn-primary btn-sm" onClick={() => void act(`${path}/invoices/${inv.id}/issue`, { version: inv.version }, "Issued. The client can see and pay it now.")}>Issue</button>}
                {me.operator && left > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setPaying(inv)}>Record a payment</button>}
                {me.operator && inv.status === "issued" && !paidOn.length && f.type !== "credit" && <button className="btn btn-ghost btn-sm" onClick={() => setVoiding(inv)}>Void</button>}
              </div>
            </div>
          </div>
        );
      })}
      {me.operator && <div className="actions" style={{ marginTop: 10 }}><button className="btn btn-ghost btn-sm" onClick={() => setCreating(true)}>New invoice</button></div>}
      <NewInvoice open={creating} onClose={() => setCreating(false)} path={path} issued={invoices.filter((i) => i.status === "issued" || i.status === "paid")} />
      <RecordPayment invoice={paying} items={items} onClose={() => setPaying(undefined)} onSave={(body) => { const inv = paying!; setPaying(undefined); void act(`${path}/invoices/${inv.id}/payments`, body, "Payment recorded."); }} />
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
    <form onSubmit={(e) => { e.preventDefault(); onVoid(reason.trim()); }}>
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
  const left = invoice ? balanceOf(invoice, items) : 0;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [ref, setRef] = useState("");
  const [on, setOn] = useState(todayIn(org.timeZone));
  // Each invoice starts from what's owed on it
  useEffect(() => { if (invoice) setAmount((left / 100).toFixed(2)); }, [invoice, left]);
  const cents = centsOf(amount);
  return (
    <Dialog open={Boolean(invoice)} onClose={onClose} label="Record a payment">
      <form onSubmit={(e) => { e.preventDefault(); if (cents) onSave({ amountCents: cents, method, ref: ref.trim(), receivedAt: on }); }}>
        <h2>Record a payment on {String(invoice?.fields.number ?? "")}</h2>
        <p className="small muted">{money(left)} is owed.</p>
        <label htmlFor="pay-amount">Amount ($)</label>
        <input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <label htmlFor="pay-method">How it arrived</label>
        <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {(Object.keys(METHOD_WORDS) as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_WORDS[m]}</option>)}
        </select>
        <label htmlFor="pay-ref">Check number or confirmation (optional)</label>
        <input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} />
        <label htmlFor="pay-on">Received on</label>
        <input id="pay-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} required />
        <div className="actions"><button className="btn btn-primary" disabled={!cents || cents > left}>Record {cents ? money(cents) : ""}</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

/** neon1 drafts an invoice: 1NEON suggests lines for a deposit, the final balance, or purchases at cost */
function NewInvoice({ open, onClose, path, issued }: { open: boolean; onClose: () => void; path: string; issued: Item[] }) {
  const { org } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [type, setType] = useState<InvoiceType>("deposit");
  const [lines, setLines] = useState<{ text: string; amount: string }[]>([]);
  const [appliesTo, setAppliesTo] = useState("");
  const [terms, setTerms] = useState("15");
  const [note, setNote] = useState("");
  const typed: InvoiceLine[] = lines.flatMap((l) => (l.text.trim() && centsOf(l.amount) ? [{ text: l.text.trim(), qty: 1, unitCents: centsOf(l.amount)! }] : []));
  const save = async () => {
    try {
      await api(`${path}/invoices`, { method: "POST", body: { type, lines: typed.length ? typed : undefined, appliesTo: type === "credit" ? appliesTo : undefined, termsDays: Number(terms), note } });
      toast("Draft saved. Check it, then Issue.");
      setLines([]);
      onClose();
    } catch (e) {
      // Nothing to suggest: ask for a line instead
      if (e instanceof HttpError && e.body.error === "no_lines") { setLines([{ text: "", amount: "" }]); toast(String(e.body.message)); }
      else toast(problem(e));
    }
    refresh();
  };
  return (
    <Dialog open={open} onClose={onClose} label="New invoice">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
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
        <p className="small muted">{type === "deposit" || type === "final" || type === "reimbursement" ? "Leave the lines empty and 1NEON fills them from the approved option or the receipts. Or add your own." : "Add each line with what it's for and the amount."}</p>
        {lines.map((l, i) => (
          <div className="line" key={i}>
            <input aria-label="What it's for" placeholder="What it's for" value={l.text} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} maxLength={200} />
            <input aria-label="Amount ($)" placeholder="$" inputMode="decimal" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} style={{ maxWidth: 120 }} />
          </div>
        ))}
        <button type="button" className="chip" onClick={() => setLines([...lines, { text: "", amount: "" }])}>Add a line</button>
        <label htmlFor="inv-terms">Due in (days)</label>
        <input id="inv-terms" type="number" min={0} max={90} value={terms} onChange={(e) => setTerms(e.target.value)} style={{ maxWidth: 100 }} />
        <label htmlFor="inv-note">Note on the invoice (optional)</label>
        <input id="inv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        <div className="actions"><button className="btn btn-primary" disabled={type === "credit" && !appliesTo}>Save draft</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

/** One invoice line's amount, for the printed invoice */
export const lineAmount = (l: InvoiceLine) => money(lineCents(l));
