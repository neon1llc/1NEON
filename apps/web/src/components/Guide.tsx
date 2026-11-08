// apps/web/src/components/Guide.tsx - Guided input. Each kind of item says what belongs in it, shows
// a real example, and offers one-tap starters, so nobody faces an empty box. Requests are built as
// one sentence from a few taps, the way issue forms and sentence-style forms ask for structure.


import type { ItemKind } from "@1neon/domain";
import { useState } from "react";


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
    hint: "A file you need from the client, such as a form, a report, or an export.",
    title: "A blank copy of the current intake form",
    body: "Where to find it, if that helps",
    starters: ["A blank copy of the current form", "Last month's report", "A sample export (with names removed)", "The current vendor contract"],
  },
  task: { hint: "One piece of work someone can finish.", title: "Set up the upload page", body: "Done when…", starters: [] },
  milestone: { hint: "A point everyone can see, such as a launch or a sign-off.", title: "Staff trial starts", body: "", starters: ["Kickoff", "First working version", "Staff trial", "Go live"] },
  change: { hint: "A change to what was agreed: what, why, and what it does to cost or dates.", title: "Add text-message reminders", body: "Why, and the effect on cost and dates", starters: [] },
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


/** One row of single-choice chips; tapping the chosen chip again clears it */
export function Pick<T extends string>({ label, options, value, onChange }: { label: string; options: readonly (readonly [T, string])[]; value: T | ""; onChange: (v: T | "") => void }) {
  return (
    <span role="radiogroup" aria-label={label} className="pick">
      {options.map(([v, words]) => (
        <button type="button" key={v} role="radio" aria-checked={value === v} className={`chip${value === v ? " on" : ""}`} onClick={() => onChange(value === v ? "" : v)}>{words}</button>
      ))}
    </span>
  );
}


// The request sentence's choices, as stored value and the words people see
const GOALS = [["time", "save time"], ["errors", "stop mistakes"], ["cost", "cut costs"], ["reach", "reach more people"], ["safe", "be safer"], ["fix", "fix something broken"]] as const;
const OFTEN = [["daily", "every day"], ["weekly", "every week"], ["monthly", "every month"], ["rarely", "now and then"]] as const;
const WHEN = [["soon", "this month"], ["quarter", "this quarter"], ["later", "no rush"]] as const;
const WHO = ["our staff", "our customers", "me"];


/** What a finished request sentence becomes: a short title, readable details, and its answers */
export interface RequestDraft {
  title: string;
  body: string;
  fields: Record<string, string>;
}


/** A request as one sentence: "I'd like to ___ for ___. Today, ___. It comes up ___, and I need it ___."
 * Only the goal is required; every other blank is a tap or a few words */
export function RequestBuilder({ onSubmit, onCancel }: { onSubmit: (d: RequestDraft) => void; onCancel: () => void }) {
  const [goal, setGoal] = useState<(typeof GOALS)[number][0] | "">("");
  const [who, setWho] = useState("");
  const [today, setToday] = useState("");
  const [often, setOften] = useState<(typeof OFTEN)[number][0] | "">("");
  const [when, setWhen] = useState<(typeof WHEN)[number][0] | "">("");
  const words = <T extends string>(list: readonly (readonly [T, string])[], v: T | "") => list.find(([k]) => k === v)?.[1] ?? "";

  // The sentence as it reads so far becomes the title and details
  const submit = () => {
    const g = words(GOALS, goal);
    const title = `${g[0]!.toUpperCase()}${g.slice(1)}${who.trim() ? ` for ${who.trim()}` : ""}`;
    const lines = [
      today.trim() && `Today: ${today.trim()}`,
      often && `Comes up ${words(OFTEN, often)}.`,
      when && `Needed ${words(WHEN, when)}.`,
    ].filter(Boolean);
    onSubmit({ title, body: lines.join("\n"), fields: { goal, who: who.trim(), today: today.trim(), often, when } });
  };

  return (
    <form className="card sentence" onSubmit={(e) => { e.preventDefault(); if (goal) submit(); }}>
      <p className="eyebrow">Tell us what you need</p>
      {/* Each line reads as part of one sentence; blanks are chips or short fields */}
      <div className="line"><span>I'd like to</span><Pick label="Goal" options={GOALS} value={goal} onChange={setGoal} /></div>
      <div className="line">
        <span>for</span>
        <input aria-label="Who it's for" value={who} onChange={(e) => setWho(e.target.value)} maxLength={60} placeholder="such as the front desk" list="req-who" />
        <datalist id="req-who">{WHO.map((w) => <option key={w} value={w} />)}</datalist>
      </div>
      <div className="line"><span>Today,</span><input aria-label="What happens today" value={today} onChange={(e) => setToday(e.target.value)} maxLength={300} placeholder="such as: forms get retyped" /></div>
      <div className="line"><span>It comes up</span><Pick label="How often" options={OFTEN} value={often} onChange={setOften} /></div>
      <div className="line"><span>and I need it</span><Pick label="When" options={WHEN} value={when} onChange={setWhen} /></div>
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={!goal}>Send request</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
