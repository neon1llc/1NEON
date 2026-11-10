// apps/web/src/pages/Example.tsx - /1NEON/example: one made-up project, start to finish, in the
// portal's own frame. Public, no sign-in; it links to the working demo and the live playback.


import { LayerBadge, LAYERS, layerHint, layerName } from "../components/ui.tsx";
import type { Layer } from "@1neon/domain";


// The bakery's story, one entry per layer: each card is a title, its lines, and an optional list
type Card = { title: string; lines: (string | [string, string])[]; list?: { text: string; state?: "done" | "now" | "picked" }[] };
const STORY: Record<Layer, { lead: string; cards: Card[] }> = {
  needs: {
    lead: "What the client wants, the ways to get there, and the choice.",
    cards: [
      { title: "Request", lines: [["Currently", "every night we copy about 40 orders from email and voicemail notes into a spreadsheet. It takes an hour, and a few orders get missed each week."], ["Goal", "orders land in one list on their own, and nobody retypes them."], ["Due", "before the holiday rush."]] },
      { title: "Options", lines: ["Every proposal offers a few choices, each with its cost, effort, and what it gets you. The figures are illustrative."], list: [
        { text: "Quick fix: an order form that writes straight into the spreadsheet, about 4 hours" },
        { text: "Solid setup: the form, plus emailed orders read into the same list, with a daily summary, about 16 hours", state: "picked" },
        { text: "Fuller build: all of that, plus a small order page with pickup times and reminders, about 40 hours" },
      ] },
      { title: "Decision", lines: ["The owner approved Solid setup in the portal on Oct 3. The decision, who made it, and the estimate stay with the project."] },
    ],
  },
  execution: {
    lead: "The work, as it happens, with updates you can read in a minute.",
    cards: [
      { title: "Work", lines: [], list: [
        { text: "Order form connected to the spreadsheet", state: "done" },
        { text: "Emailed orders read into the same list", state: "done" },
        { text: "Daily summary at 7pm", state: "done" },
        { text: "Two weeks running side by side with the old way", state: "now" },
      ] },
      { title: "Update · Oct 17", lines: [["Health", "on track. Emailed orders now arrive in the list within a minute. One order with a photo attachment needed a manual fix; that case is handled now. Waiting on you: confirm the summary should go to both owners."]] },
    ],
  },
  observation: {
    lead: "The same measures, before and after, so the result is a number.",
    cards: [
      { title: "Measures", lines: ["Measured the same way before and after, over two weeks each. Illustrative numbers."], list: [
        { text: "Nightly retyping: 60 min → 5 min", state: "done" },
        { text: "Missed orders a week: 3 → 0", state: "done" },
        { text: "Target: under 10 minutes a night, no missed orders" },
      ] },
    ],
  },
  next: {
    lead: "Making it the normal way of working, owned by the client.",
    cards: [
      { title: "Handover", lines: [], list: [
        { text: "A one-page runbook: where orders go, and what to do if one looks wrong", state: "done" },
        { text: "A 30-minute walkthrough with both owners, recorded for new staff", state: "done" },
        { text: "Every account and bill in the bakery's own name", state: "done" },
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
          <a className="btn btn-ghost btn-sm" href="/1NEON/live">Guided walkthrough</a>
          <a className="btn btn-primary btn-sm" href="/1NEON/demo/">Interactive demo</a>
        </span>
      </header>
      <main className="content example-body" id="main">
        <p className="eyebrow">Sample project · every name, number, and file is made up</p>
        <h1 className="page-title">Maple Street Bakery: orders without retyping</h1>
        <p className="lead">A two-person bakery takes orders by email and phone, then retypes them into a spreadsheet each night. Follow it through the four layers.</p>
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
        {/* The end: try the real thing, or talk about a real project */}
        <section className="example-end card">
          <p>That's the whole loop. A real project follows the same steps, with its own need and numbers.</p>
          <div className="actions">
            <a className="btn btn-primary" href="/1NEON/demo/">Interactive demo</a>
            <a className="btn btn-ghost" href="/1NEON/live">Guided walkthrough</a>
            <a className="btn btn-ghost" href="https://calendly.com/1isgladtobeofservice/neon1-consultation" target="_blank" rel="noopener">Book a free call</a>
          </div>
        </section>
      </main>
    </div>
  );
}
