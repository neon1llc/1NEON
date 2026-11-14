// apps/web/src/pages/Example.tsx - /1NEON/example: one made-up project, start to finish, in the
// portal's own frame. Public, no sign-in; it links to the working demo and the live playback.


import { LayerBadge, LAYERS, layerHint, layerName } from "../components/ui.tsx";
import type { Layer } from "@1neon/domain";
import { CHOSEN, CONSTRAINTS, DRY_RUN, FRIDAY, HOURS, MEASURES, MONEY, PRINTER, SUMMARY, TASKS } from "../lib/bakery.ts";


// The bakery's story, one entry per layer: each card is a title, its lines, and an optional list.
// The facts and figures are the walkthrough's own (lib/bakery.ts), so the two never disagree
type Card = { title: string; lines: (string | [string, string])[]; list?: { text: string; state?: "done" | "now" | "picked" }[] };
const [quick, solid, fuller] = SUMMARY;
const STORY: Record<Layer, { lead: string; cards: Card[] }> = {
  needs: {
    lead: "What the client wants, what neon1 learned by listening, the ways to get there, and the choice.",
    cards: [
      { title: "Request", lines: [["Currently", `orders come in by email, voicemail, and Instagram. The owner and the counter lead retype about 40 a night into a spreadsheet, and the head baker tallies the bake from it by hand at 4am. It takes an hour, and about ${MEASURES[1].baseline} orders a week go wrong.`], ["Goal", "every order lands in one list on its own, the kitchen gets its bake sheet, and nobody retypes anything."], ["Due", "before the holiday rush."]] },
      { title: "What neon1 learned", lines: [`After a twenty-minute call and a week of real orders (${DRY_RUN.orders} of them), written into the project where the owner can correct it.`], list: [
        { text: `Where orders come from: on one Friday, ${FRIDAY.emails} emails, ${FRIDAY.voicemails} voicemails, and ${FRIDAY.instagram} Instagram messages` },
        { text: "What can't change: customers keep ordering the way they do now, and the staff don't learn a new app" },
        ...CONSTRAINTS.slice(0, 2).map(([title]) => ({ text: `A limit, said before any option was written: ${title.charAt(0).toLowerCase()}${title.slice(1)}` })),
      ] },
      { title: "Options", lines: [`Proposal 0039-r1 offers three choices. Each says what's in and out, the hours behind its price task by task, anything to buy, and the result to check. Each price here is an estimate at ${MONEY.rate} an hour: billed for the hours worked, and never above its high end unless the client approves a change first. The figures are illustrative.`], list: [
        { text: `${quick!.title}: an order form that feeds one order list. ${quick!.hours}, ${quick!.price}` },
        { text: `${solid!.title}: every order in one list however it arrived, each marked to check, with a 7pm summary, the kitchen's bake sheet, and a safety net. ${solid!.hours}, ${solid!.price}`, state: "picked" },
        { text: `${fuller!.title}: all of that, plus an online order page with pickup times, payment, and reminders. ${fuller!.hours}, ${fuller!.price}` },
      ] },
      { title: "Decision", lines: [`The owner read the proposal, signed neon1's service agreement once for the bakery, then approved 0039-r1-B, ${solid!.title}, on Oct 3 with a typed signature. The approval restated the terms first, including when she pays: ${MONEY.deposit} at approval (half of the estimate's low end) and the rest at handover. The decision, who made it, and those exact terms stay with the project.`, `Why this one: ${String(CHOSEN.fields.why)}`] },
    ],
  },
  execution: {
    lead: "The work, as it happens, with updates you can read in a minute and every hour listed.",
    cards: [
      { title: "Work", lines: [], list: [
        ...[TASKS.form, TASKS.reading, TASKS.summary, TASKS.safety, TASKS.dryRun].map((text) => ({ text, state: "done" as const })),
        { text: "A week running side by side with the old way", state: "now" },
      ] },
      { title: "Hours", lines: [`${MONEY.logged} logged against an estimate of ${MONEY.hours}, each with its date and what it was for. The client sees the list grow as the work is done.`], list: HOURS.slice(0, 3).map((h) => ({ text: `${h.work}: ${h.hours} ${h.hours === 1 ? "hour" : "hours"}`, state: "done" as const })).concat([{ text: `…and ${HOURS.length - 3} more entries, ${MONEY.logged} in all`, state: "done" as const }]) },
      { title: "Update · Oct 21", lines: [["Health", `on track. I replayed last week's ${DRY_RUN.orders} orders through the new list, and ${DRY_RUN.right} landed right. ${DRY_RUN.fixed} needed a fix: emails with two orders in one message, and orders sent as a photo. Both cases are handled now. No change to the estimate.`]] },
      { title: "Purchases", lines: ["From the approved option, bought by the bakery in its own name."], list: [
        { text: `${PRINTER.name}: estimate $180-$220, paid ${PRINTER.paid}, receipt attached`, state: "done" },
      ] },
      { title: "Invoices", lines: ["Each invoice says what it's for and how it was worked out, and is paid by bank transfer or card from the project."], list: [
        { text: `INV-0039-01, deposit: ${MONEY.deposit}, half of the estimate's low end (${MONEY.low}). Paid`, state: "done" },
        { text: `INV-0039-02, final: ${MONEY.logged} at ${MONEY.rate} is ${MONEY.earned}, less the deposit, ${MONEY.final}. It lists every hour it bills. Paid`, state: "done" },
        { text: `Total for the work: ${MONEY.earned}, inside the ${MONEY.range} approved` },
      ] },
    ],
  },
  observation: {
    lead: "The same measures, before and after, so the result is a number.",
    cards: [
      { title: "Measures", lines: ["Measured the same way before and after, over two weeks each. Illustrative numbers."], list: [
        { text: `Nightly retyping: ${MEASURES[0].baseline} min → 5 min`, state: "done" },
        { text: `Orders missed or wrong each week: ${MEASURES[1].baseline} → ${MEASURES[1].target}`, state: "done" },
        { text: `Target: under ${MEASURES[0].target} minutes a night, and no order missed` },
      ] },
    ],
  },
  next: {
    lead: "Making it the normal way of working, owned by the client.",
    cards: [
      { title: "Handover", lines: [], list: [
        { text: "A one-page runbook: where orders go, what to do each evening, and what to do if something looks wrong", state: "done" },
        { text: "A walkthrough with the counter lead and the head baker, recorded for new staff", state: "done" },
        { text: "Every account in the bakery's own name, a sign-in for each person in place of the shared password, and neon1's access removed", state: "done" },
        { text: "The last step checked and accepted by the owner, with a signature", state: "done" },
      ] },
      { title: "Care", lines: ["Optional and monthly: a check that the numbers still hold, and small changes as the bakery grows. The bakery can also run it without neon1."] },
    ],
  },
};


/** The example project in the portal's frame: its top bar, a contents row, then each layer */
export function Example() {
  return (
    <div className="shell example">
      {/* The signed-in portal's top bar, with the way into the demo where search would be */}
      <header className="top">
        <div className="crumb"><a href="/1NEON/">1NEON</a> / Sample project</div>
        <span className="top-acts">
          <a className="btn btn-ghost btn-sm" href="/">neon1.tech</a>
          {/* Short in the bar so it holds one line on a phone; the end card says the length */}
          <a className="btn btn-primary btn-sm" href="/1NEON/live">Watch it</a>
          <a className="btn btn-ghost btn-sm" href="/1NEON/demo/">Interactive demo</a>
        </span>
      </header>
      <main className="content example-body" id="main">
        <p className="eyebrow">Sample project · every name, number, and file is made up</p>
        <h1 className="page-title">Maple Street Bakery: orders without retyping</h1>
        <p className="lead">A neighborhood bakery with a team of eight takes orders by email, voicemail, and Instagram, then retypes them into a spreadsheet each night. Follow it through the four layers.</p>
        {/* Contents: jump to a layer */}
        <nav className="tabs" aria-label="Layers">
          {LAYERS.map((l) => <a key={l} href={`#${l}`}><LayerBadge layer={l} /><span className="tab-name">{layerName(l)}<small className="sub"><span className="sr">, </span>{layerHint(l)}</small></span></a>)}
        </nav>
        {LAYERS.map((l, i) => (
          <section key={l} id={l} className="example-layer" aria-labelledby={`${l}-h`}>
            <p className="eyebrow">Step {i + 1}</p>
            <h2 id={`${l}-h`} className="example-h"><LayerBadge layer={l} />{layerName(l)}</h2>
            <p className="muted">{STORY[l].lead}</p>
            <div className="example-cards">
              {STORY[l].cards.map((c) => (
                <article key={c.title} className="card">
                  <h3>{c.title}</h3>
                  {c.lines.map((x, j) => (typeof x === "string" ? <p key={j} className="small muted">{x}</p> : <p key={j}><b>{x[0]}:</b> {x[1]}</p>))}
                  {c.list && (
                    <ul className="example-list">
                      {c.list.map((x) => <li key={x.text} className={x.state}>{x.text}{x.state === "picked" && <span className="tag rec">chosen</span>}</li>)}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
        {/* The end: one primary way on (watch it), the demo as quiet text beneath, then a real project */}
        <section className="example-end card">
          <p>That's the whole loop. A real project follows the same steps, with its own need and numbers.</p>
          <div className="actions">
            <a className="btn btn-primary" href="/1NEON/live">Watch it (about 3 minutes)</a>
            <a className="btn btn-ghost" href="https://calendly.com/1isgladtobeofservice/neon1-consultation" target="_blank" rel="noopener">Book a free call</a>
          </div>
          <p className="small muted">Would rather click around yourself? <a href="/1NEON/demo/">Try the interactive demo</a>.</p>
        </section>
      </main>
    </div>
  );
}
