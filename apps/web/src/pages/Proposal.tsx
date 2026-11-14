// apps/web/src/pages/Proposal.tsx - /o/:slug/projects/:key/proposal: the project's proposal as one
// document, laid out like neon1's letters and proposals (a letterhead, green section bars, arrow
// bullets, a cost table, and an agreement block), ready to read, print, save as a PDF, or download as
// Word. It shows an issued revision exactly as it was frozen (?r=2 for an earlier one), or the live
// draft (?draft=1) built from the project's records the same way Issue freezes them.


import { isQuickFix, buildSnapshot, currentDecision, DecisionFields, hoursRange, hoursText, paymentPlan, priceCheckDue, priceMeaning, priceOf, proposalRef, revisions, todayIn, type Item, type ProposalFields, type ProposalSnapshot } from "@1neon/domain";
import { FileText, Printer } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { gate } from "../components/Reads.tsx";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { Empty, useToast } from "../components/ui.tsx";
import { DEMO } from "../lib/api.ts";
import { downloadDocx, FICTIONAL, type Acceptance } from "../lib/docx.ts";
import { problem, useMembers, useProject, useProjects } from "../lib/hooks.ts";

// A long date, the way a letter writes it
const longDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: iso.length === 10 ? "UTC" : undefined });


/** An option's details as written: paragraphs, "- " lists, and short "Label:" lines as subheads */
function Body({ text }: { text: string }) {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        const head = /^[^-].{0,40}:$/.test(lines[0]!) ? lines.shift()! : undefined;
        const list = lines.length > 0 && lines.every((l) => l.startsWith("- "));
        return (
          <div key={i} className="pp-block">
            {head && <p className="pp-sub">{head.slice(0, -1)}</p>}
            {list ? <ul className="pp-list">{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul> : lines.length > 0 && <p>{lines.join(" ")}</p>}
          </div>
        );
      })}
    </>
  );
}


/** A green bar with white caps, as each section of neon1's proposals opens */
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="pp-section">
    <h2 className="pp-bar">{title}</h2>
    {children}
  </section>
);


/** The proposal for one project, from its key: an issued revision, or the draft */
export function ProposalPage() {
  const { org, summary } = useOrg();
  const { key } = useParams();
  const [params] = useSearchParams();
  const projects = useProjects(org.id);
  const pid = projects.data?.find((p) => p.key === key)?.id;
  const detail = useProject(org.id, pid);
  const members = useMembers(org.id);
  const base = `/o/${summary.slug}/projects/${key}`;
  // A quick fix's one revision is its quote: the same frozen document, named for what it is
  const quick = isQuickFix(projects.data?.find((p) => p.key === key));
  useTopBar(<span><Link to={`/o/${summary.slug}/projects`}>Projects</Link> / <Link to={base}>{key}</Link> / {quick ? "Quote" : "Proposal"}</span>, [key, summary.slug, quick]);
  const out = { to: base, label: "Back to the project" };
  const waitList = gate([projects], { out });
  if (waitList) return waitList;
  if (!pid) return <Empty text={`There's no project ${key} in ${org.name}.`} action={<Link className="btn btn-ghost" to={`/o/${summary.slug}/projects`}>All projects</Link>} />;
  const wait = gate([detail], { out });
  if (wait || !detail.data) return wait;
  const { project: p, items } = detail.data;
  const revs = revisions(items);
  const asked = Number(params.get("r")) || undefined;
  const shown = params.get("draft") === "1" ? undefined : asked ? revs.find((r) => r.p.rev === asked) : revs.at(-1);
  if (asked && !shown) return <Empty text={`${p.key} has no revision ${asked}.`} action={<Link className="btn btn-ghost" to={`${base}/proposal`}>Latest revision</Link>} />;
  // The draft: what Issue would freeze now. Its option IDs say "draft" until it's issued
  let snapshot: ProposalSnapshot;
  if (shown) snapshot = shown.p.snapshot;
  else {
    const latest = revs.at(-1);
    const people = (members.data ?? []).filter((m) => m.status !== "deactivated").map((m) => ({ userId: m.userId, name: m.name || m.email, title: m.title, email: m.email, admin: m.access === "admin" && !m.neon1 && m.status === "joined" }));
    snapshot = buildSnapshot({ project: p, items, orgName: org.name, people, number: latest?.p.number ?? 0, rev: (latest?.p.rev ?? 0) + 1 });
    for (const o of snapshot.options) o.code = latest ? o.code : `Draft ${o.letter}`;
  }
  if (!snapshot.options.length) {
    return <Empty text="There's no proposal yet. It's ready once neon1 shares options for this project." action={<Link className="btn btn-ghost" to={`${base}/needs#options`}>Options</Link>} />;
  }
  // Decisions made on the revision shown, newest last; the one in force is marked
  const inForce = currentDecision(items).decision?.id;
  const decided = shown ? items.filter((i) => i.kind === "decision" && i.fields.proposalId === shown.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
  return <Proposal snapshot={snapshot} rev={shown?.p} latestRev={revs.at(-1)?.p.rev} decided={decided} inForce={inForce} timeZone={org.timeZone} slug={summary.slug} base={base} quick={quick} />;
}


/** One acceptance as printed: who approved which option ID, when, and on what conditions */
function acceptanceOf(d: Item): Acceptance | undefined {
  const r = DecisionFields.safeParse(d.fields);
  if (!r.success) return undefined;
  const f = r.data;
  return { name: f.approverName || f.approverEmail || "A member", email: f.approverEmail, code: f.code ?? "", title: f.terms?.title ?? d.title.replace(/^Approved: /, ""), at: f.approvedAt, conditions: f.conditions || undefined, initials: f.initials, signature: f.signature };
}


/** The document itself, from a frozen snapshot (or the draft's); it reads top to bottom like the page */
function Proposal({ snapshot: s, rev, latestRev, decided, inForce, timeZone, slug, base, quick = false }: { snapshot: ProposalSnapshot; rev?: ProposalFields; latestRev?: number; decided: Item[]; inForce?: string; timeZone?: string; slug: string; base: string; quick?: boolean }) {
  const toast = useToast();
  const ref = rev ? proposalRef(rev.number, rev.rev) : undefined;
  // A quick fix says "Quote" wherever a project says "Proposal"
  const word = quick ? "Quote" : "Proposal";
  const title = ref ? `${word} ${ref}` : `${word} draft`;
  // The browser tab and a saved PDF are named for the proposal
  useEffect(() => {
    const was = document.title;
    document.title = `${title} · ${s.orgName} · 1NEON`;
    return () => { document.title = was; };
  }, [title, s.orgName]);
  // On paper, the ID (and the Demo's fictional label) prints in every page's bottom margin, with the
  // page number. A constructed sheet, since the portal's policy allows no inline style elements
  const foot = `${ref ? `${word} ${ref}` : `${word} draft, not issued`}${DEMO ? " · Fictional sample, not an offer" : ""}`;
  useEffect(() => {
    if (typeof CSSStyleSheet === "undefined" || !("adoptedStyleSheets" in document)) return;
    const sheet = new CSSStyleSheet();
    const text = JSON.stringify(foot);
    try {
      sheet.replaceSync(`@page { @bottom-left { content: ${text}; font: 9px sans-serif; color: #55655b; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9px sans-serif; color: #55655b; } }`);
    } catch {
      return;
    }
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== sheet); };
  }, [foot]);
  const stale = rev && !decided.length && priceCheckDue(rev, todayIn(timeZone));
  const older = rev && latestRev && rev.rev < latestRev;
  const accepted = decided.find((d) => d.id === inForce) ?? decided.at(-1);
  const docx = async () => {
    if (!rev) return;
    try {
      await downloadDocx(rev, s, slug, { accepted: accepted && acceptanceOf(accepted), fictional: DEMO ? FICTIONAL : undefined });
    } catch (e) {
      toast(problem(e));
    }
  };
  return (
    <>
      {/* Only on screen: the way back, print or save, and Word */}
      <div className="pp-tools">
        <Link className="btn btn-ghost btn-sm" to={`${base}/needs#options`}>{quick ? "Back to the quote" : "Back to options"}</Link>
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* A quick fix has no Word copy: the quote is read here, or printed */}
          {rev && !quick && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void docx()}><FileText size={15} aria-hidden="true" /> Download Word</button>}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}><Printer size={15} aria-hidden="true" /> Print or save as PDF</button>
        </span>
      </div>
      {/* Where this copy stands: a draft, an earlier revision, or one past its price check */}
      {!rev && <p className="pp-state" role="status">Draft, not issued. It shows the project as it is now; neon1 issues it as a numbered revision before an option can be approved.</p>}
      {older && <p className="pp-state" role="status">This is an earlier revision. <Link to={`${base}/proposal`}>Read the latest, r{latestRev}</Link>.</p>}
      {stale && <p className="pp-state warn" role="status">Prices may have changed since {longDate(rev!.issuedAt)}. Ask neon1 to refresh this proposal before choosing an option.</p>}
    <article className={`proposal${stale || older ? " pp-faded" : ""}`} aria-labelledby="pp-h1">
      {/* The fictional label, on screen and fixed to every printed page */}
      {DEMO && <p className="pp-note">{FICTIONAL}</p>}

      {/* Letterhead: the mark and wordmark left, the title block right in green */}
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
          <b>{s.orgName}</b>
          <h1 id="pp-h1">{s.project.name}</h1>
          <span>{quick ? "Quick fix (Quote)" : "Business Modernization Design (Proposal)"}</span>
          <span>{rev ? `Issued ${longDate(rev.issuedAt)}` : "Draft, not issued"}</span>
          <span>ID: {ref ?? "assigned when issued"}</span>
        </div>
      </header>

      {/* The facts, in one table; stacks on a phone */}
      <table className="pp-facts">
        <tbody>
          <tr><th>Prepared for</th><td>{s.preparedFor ? `${s.preparedFor.name}${s.preparedFor.title ? `, ${s.preparedFor.title}` : ""}` : s.orgName}</td><th>Prepared by</th><td>Pradeep Tathineni, neon1</td></tr>
          <tr><th>Organization</th><td>{s.orgName}</td><th>Prices checked</th><td>{rev ? `${longDate(rev.issuedAt)}; recheck after ${longDate(rev.checkBy)}` : "when issued"}</td></tr>
          <tr><th>Contact</th><td>{s.preparedFor?.email ?? "—"}</td><th>Wanted by</th><td>{s.project.targetDate ? longDate(s.project.targetDate) : "—"}</td></tr>
        </tbody>
      </table>
      {rev?.note && <p className="pp-small"><b>What changed in r{rev.rev}:</b> {rev.note}</p>}

      <Section title="Discovery">
        {s.project.summary && <><p className="pp-sub">How it works today</p><p>{s.project.summary}</p></>}
        {s.requests.length > 0 && (
          <>
            <p className="pp-sub">What you asked for</p>
            <ul className="pp-list">{s.requests.map((r, i) => <li key={i}>{r.title}{r.body ? `. ${r.body}` : ""}</li>)}</ul>
          </>
        )}
        {s.learned.length > 0 && (
          <>
            <p className="pp-sub">What we learned</p>
            <ul className="pp-list">{s.learned.map((q, i) => <li key={i}><b>{q.title}</b> {q.body}</li>)}</ul>
          </>
        )}
      </Section>

      <Section title="Objectives">
        {s.project.outcome && <><p className="pp-sub">The result</p><p>{s.project.outcome}</p></>}
        {s.measures.length > 0 && (
          <>
            <p className="pp-sub">How we'll know it worked</p>
            <ul className="pp-list">{s.measures.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </>
        )}
        {s.requirements.length > 0 && (
          <>
            <p className="pp-sub">Requirements</p>
            <ul className="pp-list">{s.requirements.map((r, i) => <li key={i}>{r.title} <span className="pp-muted">({r.priority === "must" ? "must have" : r.priority === "could" ? "nice to have" : "should have"})</span></li>)}</ul>
          </>
        )}
      </Section>

      {s.constraints.length > 0 && (
        <Section title="Constraints and assumptions">
          <ul className="pp-list">{s.constraints.map((c, i) => <li key={i}>{c.title}{c.body ? `. ${c.body}` : ""}</li>)}</ul>
        </Section>
      )}

      <Section title="Options">
        {s.options.map((o) => {
          const f = o.fields;
          const price = priceOf(f);
          const basis = f.basis ?? [];
          return (
            <div key={o.id} className="pp-option">
              <h3><span className="pp-code">{o.code}</span> {o.title}{f.recommended && <span className="pp-tag">recommended</span>}</h3>
              <Body text={o.body} />
              {f.result && <p><b>Target result:</b> {f.result}</p>}
              <p className="pp-terms">
                {f.hours && <span><b>neon1's time:</b> {f.hours}</span>}
                {f.timeline && <span><b>Timeline:</b> {f.timeline}</span>}
                {f.cost && <span><b>Price:</b> {f.cost}</span>}
                {f.outsideCosts && <span><b>Paid directly by you:</b> {f.outsideCosts}</span>}
              </p>
              {f.why && <p><b>{f.recommended ? "Why I recommend it" : "When to pick it"}:</b> {f.why}</p>}
              {/* The price, opened up: what kind it is, the work behind the hours, and when it's paid */}
              {price && (
                <div className="pp-basis">
                  <p className="pp-sub">How the price adds up</p>
                  <p>{priceMeaning(price)}</p>
                  {basis.length > 0 && (
                    <table className="pp-hours">
                      <thead><tr><th>Work</th><th>Expected</th></tr></thead>
                      <tbody>
                        {basis.map((b, i) => <tr key={i}><td>{b.work}</td><td>{hoursText(b.hours)}</td></tr>)}
                        <tr className="total"><td>Total{price.kind === "estimate" && price.hoursLow !== price.hoursHigh ? `, within a range of ${hoursRange(price)}` : ""}</td><td>{hoursText(basis.reduce((n, b) => n + b.hours, 0))}</td></tr>
                      </tbody>
                    </table>
                  )}
                  <p><b>When you pay:</b> {paymentPlan(price).join("; ")}.</p>
                </div>
              )}
              {f.purchases.length > 0 && (
                <>
                  <p className="pp-sub">Expected purchases</p>
                  <ul className="pp-list">{f.purchases.map((x, i) => <li key={i}>{x.name}{x.estimate ? `, ${x.estimate}` : ""}{x.example ? ` (${x.example})` : ""}. {x.buyer === "neon1" ? "neon1 buys it, paid back at cost with the receipt." : "You buy it."}{x.why ? ` ${x.why}.` : ""}</li>)}</ul>
                </>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="Costs">
        <table className="pp-costs">
          <thead><tr><th>Option</th><th>neon1's time</th><th>Timeline</th><th>Price</th><th>Paid directly by you</th></tr></thead>
          <tbody>
            {s.options.map((o) => <tr key={o.id}><td><span className="pp-code">{o.code}</span> {o.title}</td><td>{o.fields.hours || "—"}</td><td>{o.fields.timeline || "—"}</td><td>{o.fields.cost || "—"}</td><td>{o.fields.outsideCosts || "None"}</td></tr>)}
          </tbody>
        </table>
        <p className="pp-small">Prices are for the work described. A fixed price is the whole price for that work. An estimate is billed for the hours worked, at the rate shown, and never above its high end unless you approve a change first; every hour is listed in 1NEON as it's logged. Accounts and subscriptions are in your name and billed to you directly, so nothing is marked up and nothing is lost if we stop working together. Items to buy are bought by you, unless you agree with your initials that neon1 buys them; those are paid back at cost, with the receipt.</p>
      </Section>

      {/* Shared and individual responsibilities, in the "You will / I will" pairs of neon1's proposals */}
      <Section title="What each of us will do">
        <table className="pp-duties">
          <thead><tr><th>You will</th><th>I will</th></tr></thead>
          <tbody>
            <tr><td>Name one person who decides{s.deciders.length ? ` (${s.deciders.join(" or ")})` : ""}, and answer questions within two business days.</td><td>Say when I'm working, what I'll do, and answer your questions within one business day.</td></tr>
            <tr><td>Give the access listed below, in your own accounts{s.assets.length ? `: ${s.assets.join(", ")}` : ""}.</td><td>Use only the access the work needs, keep your information confidential, and hand back or remove it at handover.</td></tr>
            {s.files.length > 0 && <tr><td>Send what I asked for: {s.files.join("; ")}.</td><td>Keep what you send in this project only, and use it only for this work.</td></tr>}
            <tr><td>Make time for testing and a short training for the people who'll use it.</td><td>Test against the measures above, show you the result, and train your team.</td></tr>
            <tr><td>Buy what the chosen option lists, in your name, and keep the receipts with the project.</td><td>Leave a runbook and every login in your name, and fix defects found in the first 30 days at no charge.</td></tr>
          </tbody>
        </table>
        <p className="pp-small">If something outside either of our control holds the work up, such as a vendor, a delivery, or an approval from a landlord, I'll pause the timeline, tell you the same day, and give you a new date.</p>
      </Section>

      <Section title="Comments and agreement">
        <ul className="pp-list">
          <li>{rev ? <>Prices were checked on {longDate(rev.issuedAt)}. After {longDate(rev.checkBy)}, ask neon1 to refresh them before choosing; refreshing issues the next revision.</> : "Prices are checked when this proposal is issued, and rechecked after 30 days."}</li>
          <li>Choosing an option, by signing below or approving it in 1NEON, accepts that option's scope and price, and what each of us will do. It isn't a bill. Work begins under our service agreement, signed once before any paid work, which covers payment, ownership, confidentiality, and how either of us can end the work.</li>
          <li>Neither of us adds work or cost without a written change, which becomes the next revision of this proposal.</li>
          <li>For questions or changes, reply in 1NEON, upload a marked-up copy of this document, write to hello@neon1.tech, or call +1 424-326-3661.</li>
        </ul>
        {decided.length ? decided.map((d) => {
          const a = acceptanceOf(d);
          if (!a) return null;
          return (
            <div className="pp-accepted" key={d.id}>
              <p className="pp-sub">Accepted in 1NEON{d.id !== inForce ? " (later replaced)" : ""}</p>
              <p><b>{a.name}</b>{a.email ? ` (${a.email})` : ""} approved <b>{a.code}</b> ({a.title}) on {longDate(a.at)}.</p>
              {a.initials && <p>Initialed <b>{a.initials}</b>: neon1 buys the items marked for it, paid back at cost with the receipt.</p>}
              {a.conditions && <p><b>Conditions:</b> {a.conditions}</p>}
              {a.signature && <p>Signed electronically as <span className="sign-name">{a.signature.typedName}</span>. Fingerprint of the signed terms: <code>{a.signature.hash.slice(0, 16)}</code>.</p>}
              <p className="pp-small">1NEON keeps this revision and the approved terms exactly as shown, with who approved and when. Neither can be edited afterwards.</p>
            </div>
          );
        }) : (
          <div className="pp-sign">
            <p>I, ____________________________ (print name), choose option {s.options.map((o) => o.code).join(" / ")} for {s.orgName}.</p>
            <p>Signature ____________________________ Date ______________</p>
            <p>For neon1 LLC: Pradeep Tathineni &nbsp; Signature ____________________________ Date ______________</p>
          </div>
        )}
        <p className="pp-small">Your trust and your privacy mean everything to me.</p>
      </Section>

      <footer className="pp-foot">
        <span>1 is glad to be of service.</span>
        <span>Prepared by neon1 LLC · Your tech: Pradeep Tathineni, pradeep@neon1.tech</span>
      </footer>
    </article>

    </>
  );
}
