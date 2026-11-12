// apps/web/src/components/Guide.tsx - Guided input. Each kind of item says what belongs in it, shows
// a real example, and offers one-tap starters, so nobody faces an empty box. Requests are built as
// sentences of taps, the way issue forms and sentence-style forms ask for structure.


import { resolveTiming, type ItemKind } from "@1neon/domain";
import { useId, useState } from "react";


/** What to write for one kind: a one-line hint, example title and details, and starters */
export interface KindGuide {
  hint: string;
  title: string;
  body: string;
  starters: string[];
}


// One entry per kind people add by hand; starters already on the project are hidden
export const GUIDE: Partial<Record<ItemKind, KindGuide>> = {
  discovery: {
    hint: "A question for the people who do the work. One question, answered in their words.",
    title: "Where does the work get stuck or wait?",
    body: "Why it matters, or what a good answer looks like",
    starters: [
      "Where does the work get stuck or wait?",
      "What gets typed in more than once?",
      "Who has to approve it, and how?",
      "What happens when someone is out sick?",
      "What tools or files does it touch?",
      "What must never go wrong?",
    ],
  },
  asset: {
    hint: "A system, account, vendor, or data source the work touches. Never put passwords here.",
    title: "Practice-management system",
    body: "Who owns it, and who has admin access",
    starters: ["Email and shared inbox", "Shared drive or file server", "Accounting software", "Website and domain", "Cloud account (AWS, Azure, Google)", "Phone system"],
  },
  requirement: {
    hint: "Something the result must do, written as who can do what.",
    title: "Front desk can see which intakes are missing documents",
    body: "How we'll check it's met",
    starters: ["Nothing is typed in twice", "Works on a phone", "Data stays in our own account", "Staff can use it after a short walkthrough", "Old records come along", "We can export everything"],
  },
  option: {
    hint: "One way to solve it, with its cost and how long it takes.",
    title: "Small intake portal on AWS",
    body: "What it is, and what you give up",
    starters: [],
  },
  file_request: {
    hint: "A file you need from the client, e.g. a form, a report, or an export.",
    title: "A blank copy of the current intake form",
    body: "Where to find it, if that helps",
    starters: ["A blank copy of the current form", "Last month's report", "A sample export (with names removed)", "The current vendor contract"],
  },
  constraint: {
    hint: "Something the work has to live with, or assumes. It's printed in the proposal.",
    title: "Landlord signs off before any drilling outside",
    body: "What it means for the work or the dates",
    starters: ["Work happens after hours", "Landlord approval before exterior work", "Internet needed for remote viewing", "We pause the date when access or shipping is outside our control"],
  },
  task: { hint: "One piece of work someone can finish.", title: "Set up the upload page", body: "Done when…", starters: [] },
  milestone: { hint: "A point everyone can see, e.g. a launch or a sign-off.", title: "Staff trial starts", body: "", starters: ["Kickoff", "First working version", "Staff trial", "Go live"] },
  change: { hint: "A change to what was agreed: what, why, and what it does to cost or dates.", title: "Add text-message reminders", body: "Why, and the effect on cost and dates", starters: [] },
  purchase: { hint: "Something to buy for the work. You buy it unless you agree, with your initials, that neon1 buys it and is paid back at cost.", title: "Document scanner for the front desk", body: "Why it's needed, and an example model or link", starters: [] },
  signoff: { hint: "An approval needed from outside: a landlord, the building, or a licensed trade. Give it an owner and a due date.", title: "Landlord approves the outdoor camera mount", body: "Who gives it, and what it holds up", starters: ["Landlord approval", "Building management approval", "Licensed electrician signs off"] },
  metric: { hint: "A number that shows it worked, with where it is now and where it should be.", title: "Hours a week on scheduling", body: "", starters: ["Hours a week on this work", "Mistakes per month", "Monthly cost", "Time to answer a customer"] },
  check: { hint: "Something to test before calling it done.", title: "Backups restored once as a test", body: "", starters: ["Backups restored once as a test", "Works on a phone", "Admin access confirmed", "Alerts reach the right person"] },
  incident: { hint: "Something that broke: what people saw, and when.", title: "Upload page down for 20 minutes", body: "What people saw, when, and what fixed it", starters: [] },
  handoff: { hint: "A step before it's fully yours.", title: "Admin access transferred", body: "", starters: [] },
  runbook: { hint: "Written steps for a job that comes up again.", title: "Add a new staff member", body: "The steps, in order", starters: ["Add a new staff member", "Remove someone who left", "Restore from backup", "Renew the domain"] },
  training: { hint: "Who learns what, and how.", title: "Front desk walkthrough", body: "Who, and how long", starters: ["Front desk walkthrough", "Admin walkthrough", "Short how-to video"] },
  care: { hint: "Ongoing care after launch.", title: "Monthly updates and backup check", body: "", starters: ["Monthly updates and backup check", "Quarterly access review", "Yearly cost review"] },
  retro: { hint: "What went well, or what to do differently.", title: "Getting the sample form early saved a week", body: "", starters: [] },
};


/** Starter chips not yet on the project; a tap hands the text back */
export function Starters({ kind, taken, onPick }: { kind: ItemKind; taken: string[]; onPick: (s: string) => void }) {
  const seen = new Set(taken.map((t) => t.trim().toLowerCase()));
  const left = (GUIDE[kind]?.starters ?? []).filter((s) => !seen.has(s.toLowerCase()));
  if (!left.length) return null;
  return (
    <div className="chips starters" aria-label="Suggestions">
      {left.map((s) => <button type="button" key={s} className="chip" onClick={() => onPick(s)}>+ {s}</button>)}
    </div>
  );
}


/**
 * One row of single-choice chips, built on native radio buttons so Tab enters the group once and the
 * arrow keys move the choice. Tapping the chosen chip again clears it, and so does Space on it (a
 * checked radio ignores Space on its own); arrows and taps on another chip land on a new value
 */
export function Pick<T extends string>({ label, options, value, onChange }: { label: string; options: readonly (readonly [T, string])[]; value: T | ""; onChange: (v: T | "") => void }) {
  // One name per group, so each Pick on a page moves on its own
  const name = useId();
  return (
    <span role="radiogroup" aria-label={label} className="pick">
      {options.map(([v, words]) => (
        <label key={v} className={`chip${value === v ? " on" : ""}`}>
          <input type="radio" className="sr" name={name} value={v} checked={value === v} onChange={() => onChange(v)} onClick={() => value === v && onChange("")}
            onKeyDown={(e) => { if (e.key === " " && value === v) { e.preventDefault(); onChange(""); } }} />
          {words}
        </label>
      ))}
    </span>
  );
}


// The need sentence's choices, as stored value and the words people see
const GOALS = [["time", "save time"], ["errors", "stop mistakes"], ["cost", "cut costs"], ["outreach", "boost outreach"], ["enhance", "enhance"], ["fix", "fix"], ["secure", "secure"], ["review", "review"], ["prepare", "prepare"]] as const;
const OFTEN = [["daily", "daily"], ["weekly", "weekly"], ["monthly", "monthly"], ["rarely", "now and then"]] as const;
const DUE = [["soon", "this month"], ["quarter", "this quarter"], ["later", "no rush"], ["date", "on a date"]] as const;
const GOAL_WORDS = new Map<string, string>(GOALS);


/** One need as tapped and typed. Goals hold preset keys and the person's own words */
export interface Need {
  goals: string[];
  who: string;
  now: string;
  often: (typeof OFTEN)[number][0] | "";
  due: (typeof DUE)[number][0] | "";
  from: string;
  to: string;
}
const blankNeed = (): Need => ({ goals: [], who: "", now: "", often: "", due: "", from: "", to: "" });


/** What a finished need becomes: a short title, readable details, a due date, and its answers */
export interface RequestDraft {
  title: string;
  body: string;
  dueDate?: string;
  fields: Record<string, unknown>;
}


// "save time, cut costs, and fix" with the serial comma
const list = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}`);


/** A calendar date as people read it ("Nov 30, 2026"), without shifting it by time zone */
export function dayWords(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}


/**
 * The absolute due date a need's timing means right now: "this month" and "this quarter" end on the
 * last day of that month or quarter in the organization's time zone; a picked date or range ends on
 * its last day (a range with only an end date ends there too); "no rush" has none
 */
export function dueOf(n: Pick<Need, "due" | "from" | "to">, now = new Date(), timeZone?: string): string | undefined {
  if (n.due === "date") return n.to || n.from || undefined;
  return resolveTiming(n.due, now, timeZone)?.dueDate;
}


/** One need in words: the title reads as the sentence's start, the details as the rest */
export function draftOf(n: Need, now = new Date(), timeZone?: string): RequestDraft {
  const goals = n.goals.map((g) => GOAL_WORDS.get(g) ?? g);
  const said = list(goals);
  const title = `${said[0]!.toUpperCase()}${said.slice(1)}${n.who.trim() ? ` for ${n.who.trim()}` : ""}`.slice(0, 160);
  const dueDate = dueOf(n, now, timeZone);
  // The words say both what was asked and the date it was resolved to, so they read the same later
  const range = n.from && n.to && n.to !== n.from ? `${n.from} to ${n.to}` : !n.from && n.to ? `by ${n.to}` : n.from || n.to;
  const relative = DUE.find(([k]) => k === n.due)?.[1];
  const dueWords = n.due === "date" ? range : n.due === "later" ? relative : relative && dueDate ? `${relative} (by ${dayWords(dueDate)})` : undefined;
  const lines = [
    n.now.trim() && `Currently: ${n.now.trim()}`,
    n.often && `Happens ${OFTEN.find(([k]) => k === n.often)?.[1]}.`,
    dueWords && `Due ${dueWords}.`,
  ].filter(Boolean);
  // The due date goes on the item, so it shows in Coming up and turns overdue when it passes
  return { title, body: lines.join("\n"), dueDate, fields: { goals: n.goals, who: n.who.trim(), now: n.now.trim(), often: n.often, due: n.due, from: n.from, to: n.to } };
}


/** Multi-select goal chips, plus a + chip that takes the person's own action word */
function Goals({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [word, setWord] = useState("");
  const toggle = (g: string) => onChange(value.includes(g) ? value.filter((x) => x !== g) : [...value, g]);
  // Their own words join the chosen goals as a chip of their own
  const add = () => {
    // Their words keep their capitals (names, places); the same words twice are added once
    const w = word.trim();
    if (w && !value.some((g) => g.toLowerCase() === w.toLowerCase())) onChange([...value, w]);
    setWord("");
    setAdding(false);
  };
  const own = value.filter((g) => !GOAL_WORDS.has(g));
  return (
    <span className="pick" role="group" aria-label="What you'd like to do (choose any)">
      {GOALS.map(([g, words]) => (
        <button type="button" key={g} aria-pressed={value.includes(g)} className={`chip${value.includes(g) ? " on" : ""}`} onClick={() => toggle(g)}>{words}</button>
      ))}
      {own.map((g) => <button type="button" key={g} aria-pressed className="chip on" onClick={() => toggle(g)} title="Tap to remove">{g} ×</button>)}
      {adding ? (
        <input className="chip-input" aria-label="Your own action" autoFocus value={word} maxLength={40} placeholder="e.g. automate billing"
          onChange={(e) => setWord(e.target.value)} onBlur={add}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); add(); } if (e.key === "Escape") { setWord(""); setAdding(false); } }} />
      ) : (
        <button type="button" className="chip add" onClick={() => setAdding(true)} aria-label="Add your own action">+</button>
      )}
    </span>
  );
}


/** A request as one or more needs, each one sentence: "I'd like to ___ for ___. Currently, ___.
 * It happens ___, and it's due ___." Each need with a goal becomes its own request */
export function RequestBuilder({ onSubmit, onCancel, busy, timeZone }: { onSubmit: (d: RequestDraft[]) => void; onCancel: () => void; busy?: boolean; timeZone?: string }) {
  const [needs, setNeeds] = useState<Need[]>([blankNeed()]);
  // Change one field of one need
  const set = (i: number, patch: Partial<Need>) => setNeeds(needs.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  const ready = needs.filter((n) => n.goals.length);

  return (
    <form className="card sentence" onSubmit={(e) => { e.preventDefault(); if (ready.length) onSubmit(ready.map((n) => draftOf(n, new Date(), timeZone))); }}>
      <p className="eyebrow">Tell us what you need</p>
      {needs.map((n, i) => (
        <fieldset className="need" key={i}>
          {needs.length > 1 && (
            <legend className="need-h">
              <span>Need {i + 1}</span>
              <button type="button" className="linkish small" onClick={() => setNeeds(needs.filter((_, j) => j !== i))}>Remove</button>
            </legend>
          )}
          {/* Each line reads as part of one sentence; blanks are chips or short fields */}
          <div className="line"><span>I'd like to</span><Goals value={n.goals} onChange={(goals) => set(i, { goals })} /></div>
          <div className="line"><span>for</span><input aria-label="Who or what it's for" value={n.who} onChange={(e) => set(i, { who: e.target.value })} maxLength={80} placeholder="your workflow, system, or space" /></div>
          <div className="line"><span>Currently,</span><textarea rows={1} aria-label="What happens now" value={n.now} onChange={(e) => set(i, { now: e.target.value.replace(/\n/g, " ") })} maxLength={300} placeholder="e.g. forms get retyped" /></div>
          <div className="line"><span>It happens</span><Pick label="How often" options={OFTEN} value={n.often} onChange={(often) => set(i, { often })} /></div>
          <div className="line">
            <span>and it's due</span>
            <Pick label="When it's due" options={DUE} value={n.due} onChange={(due) => set(i, { due })} />
            {/* This month or quarter shows the actual date it will be due before anything is sent */}
            {(n.due === "soon" || n.due === "quarter") && <span className="muted small" aria-live="polite">due by {dayWords(dueOf(n, new Date(), timeZone)!)}</span>}
            {/* A date, or a range when the second date is set */}
            {n.due === "date" && (
              <span className="dates">
                <input type="date" aria-label="Due date, or start of a range" value={n.from} onChange={(e) => set(i, { from: e.target.value })} />
                <span className="muted small">to</span>
                <input type="date" aria-label="End of the range (optional)" value={n.to} min={n.from || undefined} onChange={(e) => set(i, { to: e.target.value })} />
              </span>
            )}
          </div>
        </fieldset>
      ))}
      <button type="button" className="btn btn-ghost btn-sm another" onClick={() => setNeeds([...needs, blankNeed()])}>+ Define another need</button>
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={!ready.length || busy}>{busy ? "Sending…" : ready.length > 1 ? `Send ${ready.length} requests` : "Send request"}</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
