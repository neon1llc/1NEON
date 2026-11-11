// apps/web/src/pages/Proposal.tsx - /o/:slug/projects/:key/proposal: the project's options as one
// complete proposal, laid out like neon1's letters and proposals (a letterhead, green section bars,
// arrow bullets, a cost table, and an agreement block), ready to read, print, or save as a PDF.
// Everything on it comes from the project's own records; nothing here is typed twice.


import { currentDecision, DecisionFields, MetricFields, OptionFields, RequirementFields, type Item, type Project } from "@1neon/domain";
import { Printer } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { gate } from "../components/Reads.tsx";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { Empty } from "../components/ui.tsx";
import { DEMO } from "../lib/api.ts";
import { useMembers, useProject, useProjects } from "../lib/hooks.ts";


// How long a proposal's price and dates hold, as in neon1's earlier proposals
const VALID_DAYS = 30;

// A long date, the way a letter writes it
const longDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: iso.length === 10 ? "UTC" : undefined });
const plusDays = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * 864e5).toISOString();


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


/** The proposal for one project, from its key */
export function ProposalPage() {
  const { org, summary } = useOrg();
  const { key } = useParams();
  const projects = useProjects(org.id);
  const pid = projects.data?.find((p) => p.key === key)?.id;
  const detail = useProject(org.id, pid);
  const members = useMembers(org.id);
  const base = `/o/${summary.slug}/projects/${key}`;
  useTopBar(<span><Link to={`/o/${summary.slug}/projects`}>Projects</Link> / <Link to={base}>{key}</Link> / Proposal</span>, [key, summary.slug]);
  const out = { to: base, label: "Back to the project" };
  const waitList = gate([projects], { out });
  if (waitList) return waitList;
  if (!pid) return <Empty text={`There's no project ${key} in ${org.name}.`} action={<Link className="btn btn-ghost" to={`/o/${summary.slug}/projects`}>All projects</Link>} />;
  const wait = gate([detail], { out });
  if (wait || !detail.data) return wait;
  const names = new Map(members.data?.map((m) => [m.userId, { name: m.name || m.email, title: m.title, email: m.email }]) ?? []);
  // With no decision maker named, the proposal is addressed to the client's own admins
  const admins = (members.data ?? []).filter((m) => m.access === "admin" && !m.neon1 && m.status === "joined").map((m) => names.get(m.userId)!);
  return <Proposal project={detail.data.project} items={detail.data.items} orgName={org.name} names={names} admins={admins} base={base} />;
}


type Person = { name: string; title?: string; email: string };

/** The document itself; kept apart from loading so it reads top to bottom like the page */
function Proposal({ project: p, items, orgName, names, admins, base }: { project: Project; items: Item[]; orgName: string; names: Map<string, Person>; admins: Person[]; base: string }) {
  const of = (kind: string) => items.filter((i) => i.kind === kind);
  const decision = currentDecision(items);
  // The options a client sees: shared or approved ones (drafts and declined ones stay off the page)
  const options = of("option").filter((o) => o.status === "proposed" || o.status === "approved");
  if (!options.length) {
    return <Empty text="There's no proposal yet. It's ready once neon1 shares options for this project." action={<Link className="btn btn-ghost" to={`${base}/needs#options`}>Options</Link>} />;
  }
  // The proposal is dated when its newest option was last shared or changed, and versioned with it
  const dated = options.map((o) => o.updatedAt).sort().at(-1)!;
  const version = Math.max(...options.map((o) => o.version));
  const letters = options.map((o) => /^([A-Z])\.\s/.exec(o.title)?.[1]);
  // Who decides for the client: the named decision makers, or the client's people on the project
  const deciders = p.people.filter((x) => x.role === "decision_maker").map((x) => names.get(x.userId)).filter((x): x is Person => Boolean(x));
  const lead = deciders[0] ?? admins[0];
  // What the client asked for, what neon1 asked, and the answers
  const requests = of("request");
  const answered = of("discovery").filter((q) => q.body.trim());
  const requirements = of("requirement");
  const measures = of("metric");
  const files = of("file_request");
  const assets = of("asset");
  // The agreed decision, if there is one
  const agreed = decision.option ? decision : undefined;
  const df = agreed?.decision ? DecisionFields.safeParse(agreed.decision.fields) : undefined;
  const d = df?.success ? df.data : undefined;
  return (
    <>
      {/* Only on screen: print or save, and the way back */}
      <div className="pp-tools">
        <Link className="btn btn-ghost btn-sm" to={`${base}/needs#options`}>Back to options</Link>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}><Printer size={15} aria-hidden="true" /> Print or save as PDF</button>
      </div>
      {DEMO && <p className="pp-note">A fictional bakery and illustrative figures, to show what a real proposal looks like.</p>}
    <article className="proposal" aria-label="Proposal">

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
          <b>{orgName}</b>
          <span>{p.name}</span>
          <span>Business Modernization Design (Proposal)</span>
          <span>{longDate(dated)}</span>
          <span>ID: {p.key}-p{version}</span>
        </div>
      </header>

      {/* The facts, in one table */}
      <table className="pp-facts">
        <tbody>
          <tr><th>Prepared for</th><td>{lead ? `${lead.name}${lead.title ? `, ${lead.title}` : ""}` : orgName}</td><th>Prepared by</th><td>Pradeep Tathineni, neon1</td></tr>
          <tr><th>Organization</th><td>{orgName}</td><th>Valid until</th><td>{longDate(plusDays(dated, VALID_DAYS))}</td></tr>
          <tr><th>Contact</th><td>{lead?.email ?? "—"}</td><th>Wanted by</th><td>{p.targetDate ? longDate(p.targetDate) : "—"}</td></tr>
        </tbody>
      </table>

      <Section title="Discovery">
        {p.summary && <><p className="pp-sub">How it works today</p><p>{p.summary}</p></>}
        {requests.length > 0 && (
          <>
            <p className="pp-sub">What you asked for</p>
            <ul className="pp-list">{requests.map((r) => <li key={r.id}>{r.title}{r.body ? `. ${r.body}` : ""}</li>)}</ul>
          </>
        )}
        {answered.length > 0 && (
          <>
            <p className="pp-sub">What we learned</p>
            <ul className="pp-list">{answered.map((q) => <li key={q.id}><b>{q.title}</b> {q.body}</li>)}</ul>
          </>
        )}
      </Section>

      <Section title="Objectives">
        {p.outcome && <><p className="pp-sub">The result</p><p>{p.outcome}</p></>}
        {measures.length > 0 && (
          <>
            <p className="pp-sub">How we'll know it worked</p>
            <ul className="pp-list">{measures.map((m) => {
              const f = MetricFields.parse(m.fields);
              const range = f.baseline !== undefined && f.target !== undefined ? `: from ${f.baseline} to ${f.target}${f.unit ? ` ${f.unit}` : ""}` : "";
              return <li key={m.id}>{m.title}{range}</li>;
            })}</ul>
          </>
        )}
        {requirements.length > 0 && (
          <>
            <p className="pp-sub">Requirements</p>
            <ul className="pp-list">{requirements.map((r) => <li key={r.id}>{r.title} <span className="pp-muted">({RequirementFields.parse(r.fields).priority === "must" ? "must have" : RequirementFields.parse(r.fields).priority === "could" ? "nice to have" : "should have"})</span></li>)}</ul>
          </>
        )}
      </Section>

      <Section title="Options">
        {options.map((o) => {
          const f = OptionFields.parse(o.fields);
          return (
            <div key={o.id} className="pp-option">
              <h3>{o.title}{f.recommended && <span className="pp-tag">recommended</span>}{o.status === "approved" && <span className="pp-tag">approved</span>}</h3>
              <Body text={o.body} />
              {f.result && <p><b>Target result:</b> {f.result}</p>}
              <p className="pp-terms">
                {f.hours && <span><b>neon1's time:</b> {f.hours}</span>}
                {f.timeline && <span><b>Timeline:</b> {f.timeline}</span>}
                {f.cost && <span><b>Price:</b> {f.cost}</span>}
                {f.outsideCosts && <span><b>Paid directly by you:</b> {f.outsideCosts}</span>}
              </p>
            </div>
          );
        })}
      </Section>

      <Section title="Cost estimates">
        <table className="pp-costs">
          <thead><tr><th>Option</th><th>neon1's time</th><th>Timeline</th><th>Price</th><th>Paid directly by you</th></tr></thead>
          <tbody>
            {options.map((o) => {
              const f = OptionFields.parse(o.fields);
              return <tr key={o.id}><td>{o.title}</td><td>{f.hours || "—"}</td><td>{f.timeline || "—"}</td><td>{f.cost || "—"}</td><td>{f.outsideCosts || "None"}</td></tr>;
            })}
          </tbody>
        </table>
        <p className="pp-small">Prices are fixed for the work described. Accounts and subscriptions are in your name and billed to you directly, so nothing is marked up and nothing is lost if we stop working together.</p>
      </Section>

      {/* Shared and individual responsibilities, in the "You will / I will" pairs of neon1's proposals */}
      <Section title="What each of us will do">
        <table className="pp-duties">
          <thead><tr><th>You will</th><th>I will</th></tr></thead>
          <tbody>
            <tr><td>Name one person who decides{deciders.length ? ` (${deciders.map((x) => x.name).join(" or ")})` : ""}, and answer questions within two business days.</td><td>Say when I'm working, what I'll do, and answer your questions within one business day.</td></tr>
            <tr><td>Give the access listed below, in your own accounts{assets.length ? `: ${assets.map((a) => a.title).join(", ")}` : ""}.</td><td>Use only the access the work needs, keep your information confidential, and hand back or remove it at handover.</td></tr>
            {files.length > 0 && <tr><td>Send what I asked for: {files.map((x) => x.title).join("; ")}.</td><td>Keep what you send in this project only, and use it only for this work.</td></tr>}
            <tr><td>Make time for testing and a short training for the people who'll use it.</td><td>Test against the measures above, show you the result, and train your team.</td></tr>
            <tr><td>Pay for any accounts or subscriptions directly, in your name.</td><td>Leave a runbook and every login in your name, and fix defects found in the first 30 days at no charge.</td></tr>
          </tbody>
        </table>
        <p className="pp-small">If something outside either of our control holds the work up, such as a vendor or a delivery, I'll pause the timeline, tell you the same day, and give you a new date.</p>
      </Section>

      <Section title="Comments and agreement">
        <ul className="pp-list">
          <li>This proposal is valid for {VALID_DAYS} days from the date at the top.</li>
          <li>It works under our services agreement, signed once before any paid work. That agreement covers payment, ownership, confidentiality, and how either of us can end the work.</li>
          <li>Choosing an option, by signing below or approving it in 1NEON, means we both agree to that option's work, price, and timeline, and to what each of us will do. Neither of us adds work or cost without a written change request the other approves.</li>
          <li>For questions or adjustments, reply in 1NEON, write to hello@neon1.tech, or call +1 424-326-3661.</li>
        </ul>
        {agreed?.option && d ? (
          <div className="pp-accepted">
            <p className="pp-sub">Accepted in 1NEON</p>
            <p><b>{d.approverName || names.get(d.approvedBy)?.name || "A member"}</b>{d.approverEmail ? ` (${d.approverEmail})` : ""} approved <b>{d.terms?.title ?? agreed.option.title}</b>, version {d.optionVersion}, on {longDate(d.approvedAt)}.</p>
            {d.conditions && <p><b>Conditions:</b> {d.conditions}</p>}
            <p className="pp-small">1NEON keeps a copy of the approved option exactly as shown, with who approved it and when. Neither can be edited afterwards.</p>
          </div>
        ) : (
          <div className="pp-sign">
            <p>I, ____________________________ (print name), choose option {letters.filter(Boolean).length ? letters.filter(Boolean).join(" / ") : "______"} for {orgName}.</p>
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
