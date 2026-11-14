// apps/web/src/live/story.ts - The live playback's story: Maria, who owns Maple Street Bakery, and
// Pradeep at neon1 take one project from a first sign-in to ongoing care. The cursor is Maria's;
// Pradeep's side arrives the way it would for her, through the page and the notification bell.


import { demoPaymentEvent } from "../components/Billing.tsx";
import { liveEngine } from "../lib/api.ts";
import { ASSETS, BETTER, CONSTRAINTS, DRY_RUN, FILE_ASK, FRIDAY, HOURS, LEARNED, MEASURES, MILESTONE, MONEY, OPTIONS, PRINTER, PROJECT, RUNBOOK, TASKS, UPDATES } from "../lib/bakery.ts";
import type { Section, Show, Stage } from "./player.ts";
import { signInWithCode, walkTo } from "./opening.ts";
import { MARIA, PRADEEP } from "./seed.ts";
import { FULL_LENGTH } from "./where.ts";


// The bakery's organization, and the project once it exists
export const SLUG = "maple-street";
export const KEY = "FLOW-1";
export const base = `/o/${SLUG}`;

// Pradeep's calls go through the in-browser API, as if from his own browser
const engine = async () => (await liveEngine())!;
async function as<T>(path: string, method = "GET", body?: unknown) {
  return (await engine()).actAs<T>(PRADEEP, path, method, body);
}
type P = { id: string; key: string; version: number; stageId: string };
type I = { id: string; kind: string; title: string; version: number; status: string; fields: Record<string, unknown> };
// The bakery's ID, and its project with every item, fresh each time
export async function tid() {
  const me = await as<{ orgs: { id: string; slug: string }[] }>("/me");
  return me.orgs.find((o) => o.slug === SLUG)!.id;
}
async function project() {
  const t = await tid();
  const p = (await as<P[]>(`/t/${t}/projects`)).find((x) => x.key === KEY)!;
  const d = await as<{ items: I[] }>(`/t/${t}/projects/${p.id}`);
  return { t, p, items: d.items };
}
// Pradeep adds an item, moves the project to a stage, or changes an item
export async function add(kind: string, title: string, extra: Record<string, unknown> = {}) {
  const { t, p } = await project();
  return as<I>(`/t/${t}/projects/${p.id}/items`, "POST", { kind, title, ...extra });
}
export async function moveTo(stageId: string, reason?: string) {
  const { t, p } = await project();
  await as(`/t/${t}/projects/${p.id}/move`, "POST", { version: p.version, stageId, reason });
}
export async function patch(match: (i: I) => boolean, body: Record<string, unknown>) {
  const { t, p, items } = await project();
  const i = items.find(match)!;
  await as(`/t/${t}/projects/${p.id}/items/${i.id}`, "PATCH", { version: i.version, ...body });
}
// Pradeep deletes an item (a template placeholder the project doesn't need)
async function remove(match: (i: I) => boolean) {
  const { t, p, items } = await project();
  for (const i of items.filter(match)) await as(`/t/${t}/projects/${p.id}/items/${i.id}?version=${i.version}`, "DELETE");
}
// A calendar date some days before today, for work the story says happened earlier
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
// Pradeep logs the hours of one part of the work, each with what was done
async function logHours(phase: (typeof HOURS)[number]["phase"]) {
  for (const h of HOURS.filter((x) => x.phase === phase)) await add("time", h.work, { fields: { date: daysAgo(h.when), hours: h.hours } });
}


// --- Pradeep's side, shared with the short preview (preview.ts) ------------------------

/**
 * Listen: what Pradeep writes down after the first call. What he learned, the limits every option has
 * to respect, the bakery's accounts the work touches, and the two measures with their numbers. The
 * template's placeholders that don't fit this project go
 */
export async function listenNotes() {
  for (const [title, body] of LEARNED) await add("discovery", title, { body, status: "done" });
  await patch((i) => i.kind === "discovery" && i.title.startsWith("What would 'better'"), { body: BETTER, status: "done" });
  for (const [title, body] of CONSTRAINTS) await add("constraint", title, { body });
  await remove((i) => i.kind === "asset");
  for (const title of ASSETS) await add("asset", title);
  // The measures: Maria's own keeps its numbers, the template's two don't apply, and the second is added
  await remove((i) => i.kind === "metric" && !MEASURES.some((m) => m.title === i.title));
  const { items } = await project();
  for (const m of MEASURES) {
    const fields = { category: "performance", unit: m.unit, direction: "down", baseline: m.baseline, target: m.target };
    const have = items.find((i) => i.kind === "metric" && i.title === m.title);
    if (have) await patch((i) => i.id === have.id, { fields: { ...have.fields, ...fields } });
    else await add("metric", m.title, { fields });
  }
}

/**
 * Three options, each with what's in and out, the hours behind its price, what the bakery pays vendors
 * directly, and the result she can check; shared for approval, and the project moves to Decide.
 * Each price is an estimate: hours at neon1's rate, task by task, with a low and a high end
 */
export async function proposeOptions() {
  await moveTo("propose");
  // Illustrative figures for a fictional bakery, not a quote (lib/bakery.ts)
  for (const { title, body, fields } of OPTIONS) {
    const o = await add("option", title, { body, fields });
    const { t, p } = await project();
    await as(`/t/${t}/projects/${p.id}/items/${o.id}`, "PATCH", { version: o.version, status: "proposed" });
  }
  // Issuing freezes the numbered revision Maria approves from (Proposal 0039-r1)
  const { t, p } = await project();
  await as(`/t/${t}/projects/${p.id}/proposals`, "POST", { note: "" });
  await moveTo("decide");
}

/** Maria signs neon1's service agreement through the API, for the short preview, which skips reading it */
export async function signAgreementAsMaria() {
  const t = await tid();
  const e = await engine();
  const a = await e.actAs<{ edition: string; hash: string; signed?: unknown }>(MARIA, `/t/${t}/agreement`);
  if (!a.signed) await e.actAs(MARIA, `/t/${t}/agreement/sign`, "POST", { edition: a.edition, hash: a.hash, typedName: "Maria Lopez", consent: true });
}

/** The plan: a milestone, the tasks, the first hours, and a first update */
export async function planWork() {
  await add("milestone", MILESTONE, { dueDate: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) });
  for (const title of Object.values(TASKS)) await add("task", title);
  await logHours("plan");
  await add("update", UPDATES.plan.title, { body: UPDATES.plan.body, fields: { health: "on_track" } });
}

/** Pradeep issues the deposit drafted when Maria approved */
export async function issueDeposit() {
  await issue("deposit");
}

/** Pradeep checks the final invoice drafted when Maria accepted the handover, and issues it */
export async function issueFinal() {
  await issue("final");
}

// Issue the draft invoice of one type, as Pradeep would from Execute
async function issue(type: string) {
  const { t, p, items } = await project();
  const draft = items.find((i) => i.kind === "invoice" && i.status === "draft" && i.fields.type === type);
  if (draft) await as(`/t/${t}/projects/${p.id}/invoices/${draft.id}/issue`, "POST", { version: draft.version });
}

/** Her bank (ACH) payment clears; in the walkthrough it's recorded as Stripe's webhook would */
export async function depositPaid() {
  await paid("deposit");
}

/** The final invoice's bank payment clears the same way */
export async function finalPaid() {
  await paid("final");
}

// The bank clears the transfer she started on an issued invoice of one type, reported as Stripe would;
// if she never started one (a chapter was skipped), the whole of it is recorded as paid by bank transfer
async function paid(type: string) {
  const { t, p, items } = await project();
  const inv = items.find((i) => i.kind === "invoice" && i.status === "issued" && i.fields.type === type);
  if (!inv) return;
  const started = items.find((i) => i.kind === "payment" && i.status === "pending" && i.fields.invoiceId === inv.id);
  if (started) return demoPaymentEvent({ id: (started.fields.stripe as { session: string }).session, amountCents: Number(started.fields.amountCents), invoiceNumber: String(inv.fields.number), metadata: { tenantId: t, projectId: p.id, invoiceId: inv.id } }, "bank_cleared");
  const cents = (inv.fields.lines as { qty: number; unitCents: number }[]).reduce((n, l) => n + Math.round(l.qty * l.unitCents), 0);
  await as(`/t/${t}/projects/${p.id}/invoices/${inv.id}/payments`, "POST", { amountCents: cents, method: "ach", ref: "Stripe bank transfer", receivedAt: new Date().toISOString().slice(0, 10) });
}

/** Everything built, with its hours logged; only the dry run is left */
export async function finishWork() {
  for (const title of [TASKS.form, TASKS.reading, TASKS.summary, TASKS.safety]) await patch((i) => i.title === title, { status: "done" });
  await logHours("build");
}

/** The dry run on a past week of real orders: the task, its hours, and an update that says what it found */
export async function dryRun() {
  await patch((i) => i.title === TASKS.dryRun, { status: "done" });
  await logHours("test");
  await add("update", UPDATES.dryRun.title, { body: UPDATES.dryRun.body, fields: { health: "on_track" } });
}

/** The walkthrough Sam and Dee take, which Maria marks done at handover */
export const TRAINING = "Walkthrough for Sam and Dee, recorded for new staff";

/** Handover: the stage, the runbook, the walkthrough Sam and Dee take, and the last hours */
export async function handOver() {
  await moveTo("handover");
  const { t, p } = await project();
  await (await engine()).uploadAs(PRADEEP, t, "orders-runbook.txt", RUNBOOK, { layer: "next", projectId: p.id });
  await add("training", TRAINING);
  await logHours("handover");
}


/** A file waiting on the "desktop" at the bottom left, ready to drag into the page */
function deskFile(name: string) {
  const el = document.createElement("div");
  el.className = "live-desk-file";
  el.textContent = name;
  document.body.append(el);
  return el;
}


/** Drag a file from the desk onto an upload target; the bytes go up as Maria */
async function dropFile(s: Stage, target: Parameters<Stage["click"]>[0], name: string, text: string, at: { layer: string; itemId?: (items: I[]) => string | undefined }) {
  const f = deskFile(name);
  try {
    await s.wait(500);
    await s.drag(".live-desk-file", target, async () => {
      const { t, p, items } = await project();
      await (await engine()).uploadAs(MARIA, t, name, text, { layer: at.layer, projectId: p.id, itemId: at.itemId?.(items) });
    });
  } finally {
    f.remove();
  }
}


/** The sections, in order. Titles are what the Back and Next buttons say. Captions (say) narrate in
 * the bar; thoughts (think) are Maria's own, beside the cursor, at each look and move */
export const STORY: Section[] = [
  {
    id: "signin",
    title: "Sign in",
    run: async (s) => {
      await s.say("Maria, who owns Maple Street Bakery, opens 1NEON for the first time");
      await s.think("Pradeep said our project lives here. Let me sign in.");
      await s.wait(600);
      await signInWithCode(s);
      await s.say("Home shows what needs her, what's coming up, and what's new");
      await s.think("Okay, home. What's waiting on me?");
      await s.hover({ sel: "h2.section-h", text: "Needs you" }, 900);
      await s.think("Nothing yet. And nothing on the calendar either.");
      await s.hover("[data-tour=coming-up] h2", 900);
      await s.think("The bell must be where news shows up.");
      await s.hover(".bell-btn", 900);
    },
  },
  {
    id: "profile",
    title: "Profile and alerts",
    why: "I keep getting more email than I want. Let me sign in and choose what reaches me.",
    run: async (s) => {
      await s.say("She opens her profile to choose what reaches her by email");
      await s.think("Before anything, I want to choose what emails me.");
      await s.go("/me");
      await s.waitFor("#notifications");
      await s.think("Everything shows under the bell. Which of these also email me?");
      await s.hover({ sel: "#notifications .notify-table tbody th", text: "Files" }, 700);
      await s.say("Important changes email her already; she adds comments too");
      await s.think("The important ones are on already. I want comments too.");
      await s.click('input[aria-label="Email me: Comments"]', 500);
      await s.think("Hmm, match my device? Let me see.");
      await s.click({ sel: ".chip", text: "Match my device" }, 500);
      await s.think("No, I like it light.");
      await s.click({ sel: ".chip", text: "Awake (light)" }, 400);
      // On a phone (either way up) she tries the mini menu, which keeps the menu's icons on screen
      const small = matchMedia("(max-width: 640px), (max-height: 500px)").matches;
      if (small) {
        await s.think("Menu: Default or Mini? Let me try Mini.");
        await s.click({ sel: ".chip", text: "Mini" }, 500);
      }
      await s.click({ sel: "button", text: /^Save$/ }, 1200);
      if (small) {
        await s.say("The mini menu keeps every page one tap away, and the full menu opens over it");
        await s.think("Hey, that's neat. The icons stay put on the left.");
        await s.click(".top .menu-btn", 900);
        await s.think("And the menu button opens the full menu with names.");
        await s.click(".scrim", 500);
        // Upright phones also have Menu at the end of the tab bar, in reach of her thumb
        if (await s.has(".tabbar .menu-btn")) {
          await s.click(".tabbar .menu-btn", 900);
          await s.think("Same menu from the bottom, right by my thumb. Useful.");
          await s.click(".scrim", 500);
        }
      }
    },
  },
  {
    id: "team",
    title: "Invite the team",
    why: "Sam runs the counter. Let me sign in and get Sam onto 1NEON too.",
    run: async (s) => {
      await s.say("She invites Sam, who runs the counter, as an editor");
      await s.think("Sam should see this too. He handles the orders.");
      await s.go(`${base}/people`, "People");
      await s.click({ sel: "button", text: "Invite people" });
      await s.type("#emails", "sam@maplestreetbakery.example", 300);
      await s.think("Editor, so he can add things but not manage people.");
      await s.choose("#acc", "editor");
      await s.click({ sel: "button", text: "Send invitation" }, 1400);
      await s.think("Invited. He'll get an email.");
      await s.hover({ sel: ".card, li, tr", text: "sam@maplestreetbakery.example" }, 900);
    },
  },
  {
    id: "start",
    title: "Start a project",
    why: "Time to start the orders project. Let me sign in and set it up.",
    run: async (s) => {
      await s.say("She starts a project from a template");
      await s.think("Now the real reason I'm here: the nightly order typing.");
      await s.go(`${base}/projects`, "Projects");
      await s.click({ sel: "a, button", text: "New project" }, 700);
      await s.think("Cloud migration? No, that's not us.");
      await s.hover({ sel: "label.option", text: "Cloud migration" }, 400);
      await s.think("Workflow automation. That's exactly it.");
      await s.click({ sel: "label.option", text: "Workflow automation" }, 500);
      await s.click({ sel: "button", text: /^Next$/ }, 700);
      await s.say("A few short answers, each with an example of what to write");
      await s.think("Short answers. I can do that.");
      await s.type("#n", PROJECT.name);
      await s.think("What happens now… Sam and I retype everything, and Dee counts it all again at 4am.");
      await s.type("#s", PROJECT.today);
      await s.think("And what I want instead:");
      await s.type("#o", PROJECT.outcome);
      await s.think("Last Friday was a good example.");
      await s.type("#x", PROJECT.example);
      await s.think("Before the holidays would be ideal.");
      await s.choose("#d", new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10));
      await s.click({ sel: "button", text: /^Next$/ }, 700);
      await s.say("How they'll know it worked: where things are now, and where they should be");
      await s.think("How will I know it worked? Minutes spent retyping.");
      await s.type("#mt0", MEASURES[0].title);
      await s.type("#mu0", MEASURES[0].unit);
      await s.think("About an hour now. Ten minutes would be a dream.");
      await s.type("#mb0", String(MEASURES[0].baseline));
      await s.type("#mg0", String(MEASURES[0].target));
      await s.click({ sel: "button", text: /^Next$/ }, 900);
      await s.think("Looks right. Create it.");
      await s.click({ sel: "button", text: "Create project" }, 1600);
    },
  },
  {
    id: "needs",
    title: "Tell neon1 what's needed",
    why: "I need to tell Pradeep exactly what we need. Let me sign in and write it down.",
    run: async (s) => {
      await s.say("In Needs, she builds her request from a few taps");
      await s.think("Needs is where I tell Pradeep what I want.");
      await s.click({ sel: "nav.tabs a", text: "Needs" }, 900);
      await s.click({ sel: "button", text: "+ Add request" }, 600);
      const one = "form.sentence fieldset:nth-of-type(1)";
      await s.think("It builds a sentence. I want to save time…");
      await s.click({ sel: `${one} button`, text: "save time" }, 250);
      await s.think("…and stop the typos too.");
      await s.click({ sel: `${one} button`, text: "stop mistakes" }, 300);
      await s.type(`${one} input[aria-label="Who or what it's for"]`, "the nightly order list");
      await s.type(`${one} textarea[aria-label="What happens now"]`, "we retype about 40 orders from email, voicemail, and Instagram each night");
      await s.think("It happens every day.");
      await s.click({ sel: `${one} .pick label`, text: "daily" }, 300);
      await s.think("And I'd like it in about a month.");
      await s.click({ sel: `${one} .pick label`, text: "on a date" }, 400);
      const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      await s.choose(`${one} input[aria-label="Due date, or start of a range"]`, d(30));
      await s.choose(`${one} input[aria-label="End of the range (optional)"]`, d(40));
      await s.say("A second need, for the busy season, with an action of her own");
      await s.think("Oh, and the holiday rush. Sam and Dee need to learn whatever we set up.");
      await s.click({ sel: "button", text: "+ Define another need" }, 600);
      const two = "form.sentence fieldset:nth-of-type(2)";
      await s.click({ sel: `${two} button`, text: "prepare" }, 300);
      await s.think("None of these say it. I'll write my own.");
      await s.click(`${two} button[aria-label="Add your own action"]`, 300);
      await s.type(`${two} input[aria-label="Your own action"]`, "train Sam and Dee");
      await s.click({ sel: `${two} input[aria-label="Who or what it's for"]` }, 200);
      await s.type(`${two} input[aria-label="Who or what it's for"]`, "the holiday rush");
      await s.click({ sel: `${two} .pick label`, text: "this quarter" }, 400);
      await s.think("Both read well. Send.");
      await s.click({ sel: "button", text: "Send 2 requests" }, 1200);
      await s.say("Discovery questions take a short answer right where they're asked");
      await s.think("A question for me already. Easy one.");
      await s.type('textarea[aria-label^="Answer:"]', "Sam and I, every night after close. It takes about an hour.");
      await s.click({ sel: "button", text: "Save answer" }, 900);
      await s.say("Requirements: a suggestion, and how much it matters");
      await s.think("One must-have: I do everything from my phone.");
      await s.click({ sel: "button", text: "+ Add requirement" }, 500);
      await s.click({ sel: ".starters .chip", text: "Works on a phone" }, 300);
      await s.click({ sel: ".pick label", text: "must have" }, 300);
      await s.click({ sel: "form.add-form button", text: /^Add$/ }, 900);
      await s.think("That's everything for now.");
    },
  },
  {
    id: "listen",
    title: "neon1 listens",
    why: "Pradeep asked me for a few things. Let me sign in and see what's new.",
    run: async (s) => {
      await s.say("Pradeep reads it all, calls her for twenty minutes, and writes down what he heard");
      await s.others(async () => {
        await moveTo("intake");
        await moveTo("listen");
        await listenNotes();
        await add("file_request", FILE_ASK.title, { body: FILE_ASK.body });
      }, 1200, "Pradeep asked for a file");
      await s.say("The bell breathes: something's new");
      await s.think("Something new came in.");
      await s.click(".bell-btn", 1400);
      await s.think("Pradeep wants last week's orders, to test against the real thing. I have those.");
      // Each notification opens what it's about: this one lands on the file request in Needs
      await s.click({ sel: ".bell-list a.note", text: "order emails" }, 1000);
      await s.think("It took me straight to his request.");
      await s.say("She drags the export in from her desktop");
      await s.think("I exported them this morning. Let me drag the zip in.");
      await dropFile(s, { sel: ".file-ask .chip, .file-ask button", text: "Upload" }, FILE_ASK.name, FILE_ASK.text, { layer: "needs", itemId: (items) => items.find((i) => i.kind === "file_request")?.id });
      await s.think("Done. That was quick.");
      await s.say("What he learned on the call is written into the project, where she can correct it");
      await s.think("He wrote down what I told him: the Instagram orders, Dee's 4am count, the shared password.");
      await s.hover({ sel: ".item", text: "What goes wrong today?" }, 1100);
      await s.think("And what we won't do yet. Instagram messages stay manual. Good to know now, not later.");
      await s.hover({ sel: ".item", text: "Instagram messages stay manual for now" }, 1100);
    },
  },
  {
    id: "propose",
    title: "Options arrive",
    why: "Pradeep said the options are ready. Let me sign in and see where it's at.",
    run: async (s) => {
      await s.say("Pradeep writes three options, each with the hours behind its price and what it gets her");
      await s.others(async () => {
        await proposeOptions();
      }, 1200, "Pradeep proposed three options");
      await s.think("Another one. Looks like Pradeep sent options.");
      await s.click(".bell-btn", 1400);
      await s.think("Three options to choose from. Let me look.");
      await s.click(".bell-btn", 300);
      await s.top();
      await s.say("Next step says what's waiting on her");
      await s.think("The next step is mine: choose an option.");
      await s.hover(".next-step, .card", 900);
    },
  },
  {
    id: "decide",
    title: "Choose an option",
    why: "I've thought about Pradeep's options. Let me sign in and approve one.",
    run: async (s) => {
      await s.say("She compares the three side by side");
      await s.think("I want to see them side by side.");
      await s.click({ sel: "a, button", text: "Compare options" }, 1200);
      await s.think("A is the cheapest. But the emails, voicemails, and Instagram orders still get typed.");
      await s.hover({ sel: ".options article", text: "A. Quick fix" }, 900);
      await s.think("B reads the emails and voicemails, and Dee gets her bake sheet. That's the real time saver.");
      await s.hover({ sel: ".options article", text: "B. Solid setup" }, 900);
      await s.think("C takes payment online. Nice, but it would land after the holidays.");
      await s.hover({ sel: ".options article", text: "C. Fuller build" }, 900);
      await s.say("Every price opens up: what kind of price it is, the hours behind it, and when she pays");
      await s.think(`${MONEY.range} is real money for us. What's in it?`);
      await s.click(".options article:nth-child(2) .basis summary", 900);
      await s.think(`Task by task, ${MONEY.expected} at ${MONEY.rate} an hour. I pay for the hours he works, and never more than ${MONEY.high} unless I agree first.`);
      await s.hover(".options article:nth-child(2) .basis-table", 1500);
      await s.think(`${MONEY.deposit} when I approve, the rest at handover. And an hour a night back for Sam and me: it pays for itself in a few months.`);
      await s.hover(".options article:nth-child(2) .basis-pay", 1300);
      await s.say("The full proposal: what he learned, what's in and out, the hours, and what each side will do");
      await s.think("Let me read the whole proposal before I say yes.");
      await s.click({ sel: "a", text: "Read the proposal" }, 1200);
      await s.scroll(700, 1400);
      await s.think("What I do, what he does. Clear enough.");
      await s.scroll(900, 1400);
      await s.think("It's numbered, 0039-r1, and each option has its own ID. Approving in 1NEON counts as choosing.");
      await s.click({ sel: "a", text: "Back to options" }, 1200);
      await s.say("First, once, she signs neon1's service agreement for the bakery");
      await s.think("It says to sign the service agreement first. One agreement covers every project.");
      await s.click({ sel: ".agreement-needed a", text: "Read and sign it" }, 1200);
      await s.think("Let me actually read it before I sign anything.");
      await s.scroll(900, 1400);
      await s.think("Purchases at cost, an estimate never billed past its high end, invoices due in 15 days. Fair.");
      await s.scroll(1600, 1200);
      await s.type("#agreement-sign-name", "Maria Lopez");
      await s.click("#agreement-sign-name ~ .sign-consent input", 400);
      await s.click({ sel: ".sign-card button", text: /^Sign for/ }, 1400);
      await s.think("Signed, and it kept a copy. Back to the options.");
      await s.click({ sel: "a.agreement-back", text: "Back to your options" }, 1200);
      await s.say("She approves the recommended one, with a condition, and signs it");
      await s.think("B it is. Pradeep recommends it too.");
      await s.click({ sel: ".options article:nth-child(2) button", text: "Approve this option" }, 700);
      await s.say("The approval restates exactly what she's accepting");
      await s.think(`${MONEY.range}, four weeks, and we buy a label printer ourselves. That's what I read.`);
      await s.hover("dialog[open] .terms-list", 1200);
      await s.think("Just not before Saturday. That's our busiest day.");
      await s.type("#cond", "Go live after the Saturday rush.");
      await s.type("#approve-sign-name", "Maria Lopez");
      await s.click("#approve-sign-name ~ .sign-consent input", 400);
      await s.click({ sel: "dialog[open] .actions button", text: /^Sign and approve/ }, 1600);
      await s.top();
      await s.think("Good, the decision is written down, condition and all.");
      await s.hover(".decision", 1200);
    },
  },
  {
    id: "pay",
    title: "Pay the deposit",
    why: "Pradeep's email says the deposit invoice is ready. Let me sign in and pay it.",
    run: async (s) => {
      await s.say("Her option said half of the estimate's low end is due up front: Pradeep issues that invoice");
      await s.others(issueDeposit, 900, "Pradeep issued the deposit invoice");
      await walkTo(s, `${base}/projects/${KEY}/execute`);
      await s.top();
      await s.say("Next step tells her it's ready, how much, and when it's due");
      await s.think(`${MONEY.deposit}, due in 15 days. That's the deposit I read about before I approved.`);
      await s.hover(".next-step", 1100);
      await s.click({ sel: ".next-step a", text: "See and pay" }, 1000);
      await s.say("Every invoice lives under Execute, with what's paid and what's left");
      await s.hover({ sel: ".invoice-row", text: "INV-" }, 900);
      await s.think("Let me see the invoice itself first.");
      await s.click({ sel: ".invoice-row a.title", text: "INV-" }, 1200);
      await s.say("The invoice, on neon1's letterhead: its number, the lines, the due date, and how to pay");
      await s.think(`Deposit on 0039-r1-B, half of the low end, ${MONEY.low}. It matches what I signed.`);
      await s.scroll(500, 1400);
      await s.think("Bank transfer is preferred. I'll do that.");
      await s.top();
      await s.say("Pay opens Stripe's hosted payment page; 1NEON never sees her bank or card details");
      await s.click({ sel: ".pp-tools button", text: /^Pay / }, 1200);
      await s.say("No money moves in a walkthrough, so a stand-in page opens. She pays from the bakery's bank account");
      await s.click({ sel: "dialog[open] button", text: "Pay from a bank account" }, 1200);
      await s.say("Until the bank clears it, the invoice says it's on its way, and Pay is gone so nobody pays twice");
      await s.think("Started today, and nothing more to pay. Good.");
      await s.hover(".pp-state", 1400);
      await s.others(depositPaid, 1200, "Her bank payment cleared");
      await s.think("Paid in full. It says so right on the invoice.");
      await s.hover(".inv-lines tfoot", 1200);
      await s.click({ sel: "a", text: "Back to invoices" }, 1000);
      await s.hover({ sel: ".invoice-row", text: "INV-" }, 1000);
    },
  },
  {
    id: "build",
    title: "The work",
    why: "The work's started. Let me sign in and see how it's going.",
    run: async (s) => {
      await s.say("On the board, she drags the project into Build");
      await s.think("Let me check the board.");
      await s.go(`${base}/workflow`, "Board");
      await s.think("It's decided, so it can move to Build.");
      await s.drag({ sel: "article.pcard", text: KEY }, '.col[aria-label^="Build"]');
      await s.wait(600);
      await s.say("Pradeep plans the work and posts an update");
      await s.others(planWork, 900, "Pradeep planned the work and posted an update");
      await s.think("Pradeep posted the plan. Let me open the project.");
      await s.click({ sel: "article.pcard a.name", text: PROJECT.name }, 1200);
      await s.click({ sel: "nav.tabs a", text: "Execute" }, 1000);
      await s.say("She opens a task and leaves a comment");
      await s.think("A bake sheet for Dee. She starts at four, though.");
      await s.click({ sel: ".item-open", text: TASKS.summary }, 900);
      await s.type('textarea[aria-label="Write a comment"]', "Dee starts at 4. Could her bake sheet arrive by 3:30?");
      await s.click({ sel: ".comment-box button", text: "Send" }, 900);
      await s.click('dialog[open] button[aria-label="Close"]', 600);
      await s.say("The label printer from her option is on the list, for the bakery to buy");
      await s.think("I picked up the label printer at Staples yesterday. Let me mark it bought.");
      await s.hover({ sel: ".item", text: PRINTER.name }, 900);
      await s.choose(`select[aria-label="Where ${PRINTER.name} stands"]`, "bought", 900);
      await s.think("It wants the receipt. It's right here.");
      await dropFile(s, { sel: ".item:has(.purchase-meta) .file-ask .chip", text: "Attach the receipt" }, PRINTER.receipt, PRINTER.text, { layer: "execution", itemId: (items) => items.find((i) => i.kind === "purchase")?.id });
      await s.wait(700);
      await s.others(finishWork, 1200, "Pradeep finished four tasks");
      await s.think("Four of the five are done. Only the dry run is left.");
      await s.hover({ sel: ".item", text: TASKS.safety }, 900);
      await s.say("Every hour he works is listed here as he logs it, against the estimate she approved");
      await s.think(`${MONEY.loggedAfterBuild} so far, of ${MONEY.hours}. Each one says what it was for.`);
      await s.hover("#hours .hours-at", 1300);
      await s.hover("#hours .hours-table", 1300);
    },
  },
  {
    id: "observe",
    title: "Measure it",
    why: "Is any of this actually saving us time? Let me sign in and check the numbers.",
    run: async (s) => {
      await s.say("Pradeep replays a past week of real orders, then runs a week side by side and records the numbers");
      await s.others(async () => {
        await moveTo("verify");
        await dryRun();
        const { t, p, items } = await project();
        // Three readings each, on the way from where it started to where it is now
        const readings: Record<string, number[]> = { [MEASURES[0].title]: [36, 18, 6], [MEASURES[1].title]: [2, 1, 0] };
        for (const m of items.filter((i) => i.kind === "metric")) {
          const values = readings[m.title];
          if (!values) continue;
          await as(`/t/${t}/projects/${p.id}/items/${m.id}`, "PATCH", { version: m.version, fields: { ...m.fields, readings: values.map((value, k) => ({ at: daysAgo([10, 5, 1][k]!), value, note: "" })) } });
        }
      }, 900, "Pradeep posted the dry run and recorded two weeks of numbers");
      await s.say("His update says what the dry run found, including what went wrong");
      await s.think(`${DRY_RUN.right} of ${DRY_RUN.orders} right the first time. And he says which ${DRY_RUN.fixed} weren't, and what he changed.`);
      await s.click({ sel: "nav.tabs a", text: "Overview" }, 1000);
      await s.hover({ sel: ".card, article, section", text: UPDATES.dryRun.title }, 1500);
      await s.think("Now the numbers. Is it actually working?");
      await s.click({ sel: "nav.tabs a", text: "Observe" }, 1000);
      await s.say("Each measure shows its baseline, its target, and where it is now");
      await s.think("From an hour a night to six minutes. And no order missed last week.");
      await s.hover(".scores > *", 1200);
      await s.think("Tonight only took five. Let me add that.");
      await s.type('input[aria-label^="New reading"]', "5");
      await s.key("Enter");
      await s.wait(900);
      await s.think("What does it look like overall?");
      await s.go(`${base}/insights`, "Insights");
      await s.say("Insights pulls it together across projects");
      await s.wait(1400);
      await s.scroll(400, 1200);
    },
  },
  {
    id: "handover",
    title: "Hand over",
    why: "Pradeep says it's ready to hand over. Let me sign in and go through it.",
    run: async (s) => {
      await s.say("Pradeep hands over: a runbook, a walkthrough, and the accounts in her name");
      await s.others(handOver, 900, "Pradeep uploaded the runbook");
      await s.think("A runbook, so we can handle things ourselves.");
      await s.go(`${base}/projects`, "Projects");
      // The page remembers List or Timeline; the project row is in List
      await s.click({ sel: ".switch button", text: "List" }, 500);
      await s.click({ sel: ".ptr a", text: PROJECT.name }, 1000);
      await s.think("Normalize is where it becomes ours for good.");
      await s.click({ sel: "nav.tabs a", text: "Normalize" }, 1000);
      await s.say("She checks off the handover as each step is done");
      const steps: [string, string][] = [
        ["Accounts are in the client's name", "The accounts are in the bakery's name. Check."],
        ["Admin access transferred to the client", "I have admin access now. Check."],
        ["Docs delivered and walked through", "Pradeep walked me through the docs."],
      ];
      for (const [t, thought] of steps) {
        await s.think(thought);
        await s.click(`input[aria-label="Done: ${t}"]`, 450);
      }
      await s.say("Sam and Dee take the walkthrough on Friday; she marks the training done");
      await s.think("Sam ran Friday's orders on his own, and Dee had her bake sheet at 3:30.");
      await s.click(`input[aria-label="Done: ${TRAINING}"]`, 600);
      await s.say("Pradeep retires the old spreadsheet and the shared password, and steps his own access down");
      await s.others(async () => {
        await patch((i) => i.title === "Older tools it replaces retired or merged, and leftovers cleaned up", { status: "done" });
        await patch((i) => i.title === "neon1 access reduced or removed", { status: "done" });
      }, 900, "Pradeep finished his two handover steps");
      await s.say("With every step done, she accepts the whole handover with one signature");
      await s.think("Sam's trained. That's the last one.");
      await s.click('input[aria-label="Done: The people who use it are trained on it"]', 700);
      await s.think("Every step is done. One signature for all of it.");
      await s.click({ sel: ".handover-all button", text: "Accept the handover" }, 500);
      await s.type('.handover-all input[aria-label="What you checked (optional)"]', "Sam closed Friday using the runbook");
      await s.type("#accept-handover-name", "Maria Lopez");
      await s.click(".handover-all .sign-consent input", 400);
      await s.click({ sel: ".handover-all button", text: /^Sign and accept the handover$/ }, 1000);
      await s.think("Each step now says I accepted it, and when.");
      await s.hover(".accepted-note", 900);
      await s.say("Accepting the handover drafts the final invoice from the hours logged, for Pradeep to check and send");
      await s.say("And adds ongoing care from a suggestion");
      await s.think("A monthly check-in makes sense for us.");
      await s.click({ sel: "button", text: "+ Add care item" }, 500);
      await s.click({ sel: ".starters .chip", text: "Monthly updates and backup check" }, 300);
      await s.click({ sel: "form.add-form button", text: /^Add$/ }, 900);
    },
  },
  {
    id: "final",
    title: "Pay the final invoice",
    why: "Pradeep's email says the final invoice is ready. Let me sign in and check it against the hours.",
    run: async (s) => {
      await s.say("Pradeep issues the final invoice: the hours he logged, less her deposit");
      await s.others(issueFinal, 900, "Pradeep issued the final invoice");
      await walkTo(s, `${base}/projects/${KEY}/execute`);
      await s.top();
      await s.think(`${MONEY.final}. Let me see how he got there.`);
      await s.hover(".next-step", 1000);
      await s.click({ sel: ".next-step a", text: "See and pay" }, 1000);
      await s.click({ sel: ".invoice-row.is-open a.title, .invoice-row.is-overdue a.title", text: "INV-" }, 1200);
      await s.say("The invoice shows the arithmetic, and lists every hour it bills");
      await s.think(`${MONEY.logged} at ${MONEY.rate} is ${MONEY.earned}, less the ${MONEY.deposit} I already paid. Under the ${MONEY.high} he said it couldn't pass.`);
      await s.hover(".inv-lines", 1600);
      await s.think("And each hour, with the date and what it was for. Nothing to take on trust.");
      await s.hover(".inv-hours", 1500);
      await s.top();
      await s.click({ sel: ".pp-tools button", text: /^Pay / }, 1200);
      await s.think("From the bank account again, like the deposit.");
      await s.click({ sel: "dialog[open] button", text: "Pay from a bank account" }, 1200);
      await s.others(finalPaid, 1200, "Her bank payment cleared");
      await s.think("Paid in full. Both invoices stay here for my accountant.");
      await s.hover(".inv-lines tfoot", 1200);
    },
  },
  {
    id: "care",
    title: "Ongoing care",
    why: "It's been running a while. Let me sign in and see how things look across everything.",
    run: async (s) => {
      await s.others(async () => { await moveTo("care"); }, 700, "Pradeep moved the project to Care");
      await s.say("The whole project, on a timeline");
      await s.think("I want to see the whole thing at once.");
      await s.go(`${base}/projects`, "Projects");
      await s.click({ sel: ".switch button", text: "Timeline" }, 1600);
      await s.say("Every file in one place");
      await s.think("And every file we traded, in one spot.");
      await s.go(`${base}/documents`, "Files");
      await s.wait(1200);
      // The history is Home's Recent activity: who did what, newest first, the same feed a
      // client reaches from the menu (each item's panel keeps its own History too)
      await s.go(`${base}/workspace`, "Home");
      await s.say("And every change, kept as history");
      await s.think("Even a history of every change. Good for my records.");
      await s.hover('[data-tour="activity"]', 1800);
      await s.say("From a first request to a measured result, all in one place");
      await s.think("No more retyping orders. That's our evenings back, and Dee's 4am count.");
      await s.wait(1800);
    },
  },
];


/** The full story as a show: the card before Start introduces Maria, and the end card says what happened */
export const FULL: Show = {
  id: "project",
  title: "The full story",
  blurb: "A whole project, from a first sign-in to ongoing care",
  length: FULL_LENGTH,
  intro: {
    heading: "Meet Maria",
    text: [
      "Maria owns Maple Street Bakery, a neighborhood bakery with a team of eight. Every night she and Sam retype about 40 orders from email, voicemail, and Instagram into a spreadsheet, and a few go wrong each week. Pradeep at neon1 has invited her to 1NEON, the portal where they'll fix that together.",
      "You'll watch her sign in with a code from her email, set up her alerts, invite her team, start a project, compare three priced options, sign for one, pay the deposit, follow the work and its hours, check the result, take the handover, and pay the final invoice. A line under the controls says what's happening, and her thoughts appear beside the cursor.",
    ],
  },
  end: "That's a whole project, start to finish.",
  recap: "Maria asked for help, compared three options with the hours behind each price, signed for one, paid a deposit, followed the work hour by hour, measured the result, took over the accounts and the runbook, and paid a final invoice that matched the hours. Every step is on record in one place.",
  sections: STORY,
};
