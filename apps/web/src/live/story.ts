// apps/web/src/live/story.ts - The live playback's story: Maria, who owns Maple Street Bakery, and
// Pradeep at neon1 take one project from a first sign-in to ongoing care. The cursor is Maria's;
// Pradeep's side arrives the way it would for her, through the page and the notification bell.


import { liveEngine } from "../lib/api.ts";
import type { Section, Stage } from "./player.ts";
import { signInWithCode, walkTo } from "./opening.ts";
import { MARIA, PRADEEP } from "./seed.ts";


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


// --- Pradeep's side, shared with the short preview (preview.ts) ------------------------

/**
 * Three options, each with what's in and out, neon1's hours, the price, what the bakery pays vendors
 * directly, and the result she can check; shared for approval, and the project moves to Decide.
 * The hours are what the work takes one experienced person, estimated task by task: no padding
 */
export async function proposeOptions() {
  await moveTo("propose");
  // Illustrative figures for a fictional bakery, not a quote
  const opts: [string, string, Record<string, unknown>][] = [
    ["A. Quick fix", [
      "An order form that writes straight into your order spreadsheet, and an email reply that points customers to it.",
      "Includes:\n- A Google Form with your items, quantities, pickup day and time, name, phone, and notes\n- Each order lands as a row in your spreadsheet, sorted by pickup\n- An automatic reply to order emails with the form's link, and the link on your website and Google profile\n- Five test orders with you, then a 15-minute walkthrough for you and Sam",
      "Not included:\n- Orders that still come by email or voicemail, which are typed in as today\n- A daily summary",
    ].join("\n\n"), { cost: "$500 fixed", hours: "about 3 hours", timeline: "2 days", outsideCosts: "None. It uses your Google account", result: "Form orders appear in the spreadsheet within a minute, with nothing retyped.", costScore: 5, qualityScore: 2, effortScore: 4 }],
    ["B. Solid setup", [
      "The form from A, plus order emails and voicemails added to the same list on their own, and a summary at 7pm.",
      "Includes:\n- Everything in A\n- Order emails and voicemail transcripts copied into the list as they arrive, each marked to check, so nothing is retyped or missed\n- A 7pm email to you and Sam: tomorrow's pickups, and anything still to check\n- A dry run on last week's 41 real orders before go-live\n- A week side by side with the old way, with two short check-ins\n- A one-page runbook and a 30-minute walkthrough, recorded for new staff",
      "Not included:\n- Taking payment online\n- Changes to your phone service",
      "Depends on:\n- Your phone service emailing voicemail transcripts. Most do, and if yours doesn't, a free Google Voice number can",
    ].join("\n\n"), { cost: "$1,700 fixed", hours: "about 10 hours", timeline: "2 weeks", outsideCosts: "None. It uses your Google account", result: "Every order is in one list by 7pm, with under 10 minutes of checking a night.", costScore: 4, qualityScore: 4, effortScore: 4, recommended: true,
      purchases: [{ name: "Label printer for pickup bags", estimate: "$90-$120", buyer: "client", why: "Prints a pickup tag from each order in the list", example: "Brother QL-820NWB" }] }],
    ["C. Fuller build", [
      "Everything in B, plus an online order page where customers choose a pickup time, pay ahead, and get a reminder.",
      "Includes:\n- Everything in B\n- An order page on Square's free online store, with your menu, pickup times, and holiday cutoffs\n- Payment when ordering, and an email or text reminder the day before pickup\n- Online orders copied into the same list",
      "Not included:\n- Delivery\n- Photography; I set up the photos you send",
      "Depends on:\n- Your menu with prices, a week before go-live",
    ].join("\n\n"), { cost: "$2,900 fixed", hours: "about 17 hours", timeline: "3 weeks", outsideCosts: "About $20/mo for the link to your spreadsheet, plus Square's card fees on online orders", result: "Most orders arrive paid, with a pickup time, and never pass through the inbox.", costScore: 3, qualityScore: 5, effortScore: 3 }],
  ];
  for (const [title, body, fields] of opts) {
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

/** The plan: a milestone, three tasks, and a first update */
export async function planWork() {
  await add("milestone", "Staff trial starts", { dueDate: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10) });
  await add("task", "Order form connected to the spreadsheet");
  await add("task", "Order emails and voicemails added to the list");
  await add("task", "Daily summary at 7pm");
  await add("update", "Form is live; email reading starts Monday", { fields: { health: "on_track" } });
}

/** The three tasks, done */
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

// Record the whole of an issued invoice of one type as paid by bank transfer
async function paid(type: string) {
  const { t, p, items } = await project();
  const inv = items.find((i) => i.kind === "invoice" && i.status === "issued" && i.fields.type === type);
  if (!inv) return;
  const cents = (inv.fields.lines as { qty: number; unitCents: number }[]).reduce((n, l) => n + Math.round(l.qty * l.unitCents), 0);
  await as(`/t/${t}/projects/${p.id}/invoices/${inv.id}/payments`, "POST", { amountCents: cents, method: "ach", ref: "Stripe bank transfer", receivedAt: new Date().toISOString().slice(0, 10) });
}

export async function finishWork() {
  await patch((i) => i.title === "Order form connected to the spreadsheet", { status: "done" });
  await patch((i) => i.title === "Order emails and voicemails added to the list", { status: "done" });
  await patch((i) => i.title === "Daily summary at 7pm", { status: "done" });
}

/** The runbook Pradeep hands over: one page the bakery can follow without him */
const RUNBOOK = [
  "Maple Street Bakery: orders runbook",
  "",
  "Where orders go",
  "- Every order, from the form, email, or voicemail, lands in the Orders sheet, one row each, sorted by pickup.",
  "- Rows marked CHECK came from an email or voicemail. Read the original (linked in the row), fix anything, and clear the mark.",
  "",
  "Every evening",
  "- The 7pm email lists tomorrow's pickups and anything still marked CHECK. Clear those before closing.",
  "- Print pickup tags: select tomorrow's rows, then Extensions > Print tags (label printer at the front desk).",
  "",
  "If something looks wrong",
  "- An order missing: search the inbox for the customer's name; add the row by hand if it never arrived.",
  "- No 7pm email: check the Orders sheet's Triggers page (Extensions > Apps Script > Triggers) shows it running.",
  "- Anything else: email hello@neon1.tech with a screenshot.",
  "",
  "Accounts (all in the bakery's name)",
  "- Google account: owner Maria; Sam is an editor on the Orders sheet only.",
].join("\n");

/** Handover: the stage, the runbook, and the walkthrough Sam takes on Friday */
export async function handOver() {
  await moveTo("handover");
  const { t, p } = await project();
  await (await engine()).uploadAs(PRADEEP, t, "orders-runbook.txt", RUNBOOK, { layer: "next", projectId: p.id });
  await add("training", "Front desk walkthrough for Sam, recorded for new staff");
}


// Phones show a bottom tab bar instead of the side menu; some steps take the phone's way
const phone = () => innerWidth <= 640;


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


/** The primer card before the story: who's who, what's coming, and how to steer. Removed by the caller */
function primer() {
  const el = document.createElement("section");
  el.className = "live-primer live-prop";
  el.setAttribute("aria-label", "Before it starts");
  const h = document.createElement("h2");
  h.textContent = "Meet Maria";
  el.append(h);
  for (const t of [
    "Maria owns Maple Street Bakery. Every night her team retypes about 40 orders from email and voicemail into a spreadsheet. Pradeep at neon1 has invited her to 1NEON, the portal where they'll fix that together.",
    "You'll watch her sign in with a code from her email, set up her alerts, invite her team, start a project, sign for the option she chooses, follow the work, pay the deposit, and take the handover. Her thoughts appear beside the cursor.",
    "Everything here is made up and stays in this browser. The bar above pauses it, steps between parts, and changes the speed.",
  ]) {
    const p = document.createElement("p");
    p.textContent = t;
    el.append(p);
  }
  document.body.append(el);
  // Props start see-through and fade in once marked on
  requestAnimationFrame(() => el.classList.add("on"));
  return el;
}


/** The sections, in order. Titles are what the Back and Next buttons say. Captions (say) narrate in
 * the bar; thoughts (think) are Maria's own, beside the cursor, at each look and move */
export const STORY: Section[] = [
  {
    id: "primer",
    title: "Meet Maria",
    run: async (s) => {
      const card = primer();
      try {
        await s.say("Before it starts: who's who, and what you'll see");
        // Long enough to read all three short paragraphs at the default speed
        await s.wait(card.textContent!.length * 22);
      } finally {
        card.remove();
      }
    },
  },
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
      if (phone()) await s.go(`${base}/people`);
      else await s.go(`${base}/people`, "People");
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
      await s.type("#n", "Orders without retyping");
      await s.think("What happens now… we retype everything.");
      await s.type("#s", "Orders come in by email and phone, and we retype them into a spreadsheet each night.");
      await s.think("And what I want instead:");
      await s.type("#o", "Every order lands in one list on its own, and nobody retypes it.");
      await s.think("Last Friday was a good example.");
      await s.type("#x", "Last Friday, 41 orders: 35 emails and 6 voicemails, typed in from 8 to 9pm.");
      await s.think("Before the holidays would be ideal.");
      await s.choose("#d", new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10));
      await s.click({ sel: "button", text: /^Next$/ }, 700);
      await s.say("How they'll know it worked: where things are now, and where they should be");
      await s.think("How will I know it worked? Minutes spent retyping.");
      await s.type("#mt0", "Minutes retyping each night");
      await s.type("#mu0", "min");
      await s.think("About an hour now. Ten minutes would be a dream.");
      await s.type("#mb0", "60");
      await s.type("#mg0", "10");
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
      await s.type(`${one} textarea[aria-label="What happens now"]`, "we retype about 40 orders from email each night");
      await s.think("It happens every day.");
      await s.click({ sel: `${one} .pick label`, text: "daily" }, 300);
      await s.think("And I'd like it in about a month.");
      await s.click({ sel: `${one} .pick label`, text: "on a date" }, 400);
      const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      await s.choose(`${one} input[aria-label="Due date, or start of a range"]`, d(30));
      await s.choose(`${one} input[aria-label="End of the range (optional)"]`, d(40));
      await s.say("A second need, for the busy season, with an action of her own");
      await s.think("Oh, and the holiday rush. Sam needs to learn whatever we set up.");
      await s.click({ sel: "button", text: "+ Define another need" }, 600);
      const two = "form.sentence fieldset:nth-of-type(2)";
      await s.click({ sel: `${two} button`, text: "prepare" }, 300);
      await s.think("None of these say it. I'll write my own.");
      await s.click(`${two} button[aria-label="Add your own action"]`, 300);
      await s.type(`${two} input[aria-label="Your own action"]`, "train Sam");
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
      await s.say("Pradeep reads it all, moves the project to Listen, and asks for a file");
      await s.others(async () => {
        await moveTo("intake");
        await moveTo("listen");
        await add("file_request", "A week of order emails, names removed", { body: "Export or forward them as a zip, whichever is easier." });
      }, 1200, "Pradeep asked for a file");
      await s.say("The bell breathes: something's new");
      await s.think("Something new came in.");
      await s.click(".bell-btn", 1400);
      await s.think("Pradeep wants a week of order emails. I have those.");
      // Each notification opens what it's about: this one lands on the file request in Needs
      await s.click({ sel: ".bell-list a.note", text: "order emails" }, 1000);
      await s.think("It took me straight to his request.");
      await s.say("She drags the export in from her desktop");
      await s.think("I exported them this morning. Let me drag the zip in.");
      await dropFile(s, { sel: ".file-ask .chip, .file-ask button", text: "Upload" }, "orders-week.zip", "41 orders, names removed", { layer: "needs", itemId: (items) => items.find((i) => i.kind === "file_request")?.id });
      await s.think("Done. That was quick.");
      await s.wait(900);
    },
  },
  {
    id: "propose",
    title: "Options arrive",
    why: "Pradeep said the options are ready. Let me sign in and see where it's at.",
    run: async (s) => {
      await s.say("Pradeep writes three options, each with his hours, the price, and what it gets her");
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
      await s.think("A is three hours. Quick, but the emails still get typed.");
      await s.hover({ sel: ".options article", text: "A. Quick fix" }, 900);
      await s.think("B catches the emails and voicemails too. That's the real time saver.");
      await s.hover({ sel: ".options article", text: "B. Solid setup" }, 900);
      await s.think("C takes payment online. Nice, but more than we need before the holidays.");
      await s.hover({ sel: ".options article", text: "C. Fuller build" }, 900);
      await s.say("The full proposal: what's in and out, the hours, and what each side will do");
      await s.think("Let me read the whole proposal before I say yes.");
      await s.click({ sel: "a", text: "Read the proposal" }, 1200);
      await s.scroll(700, 1400);
      await s.think("What I do, what he does. Clear enough.");
      await s.scroll(900, 1400);
      await s.think("It's numbered, 0039-r1, and each option has its own ID. Approving in 1NEON counts as choosing.");
      await s.click({ sel: "a", text: "Back to options" }, 1200);
      await s.say("First, once, she signs neon1's service agreement for the bakery");
      await s.think("He said there's one agreement that covers everything. Let me read it first.");
      await s.go(`${base}/agreement`, "Service agreement");
      await s.scroll(900, 1400);
      await s.think("Purchases at cost, invoices due in 15 days, my data stays mine. Fair.");
      await s.scroll(1600, 1200);
      await s.type("#agreement-sign-name", "Maria Lopez");
      await s.click("#agreement-sign-name ~ .sign-consent input", 400);
      await s.click({ sel: ".sign-card button", text: /^Sign for/ }, 1400);
      await s.go(`${base}/projects/${KEY}/needs#options`, "Options");
      await s.say("She approves the recommended one, with a condition, and signs it");
      await s.think("B it is. Pradeep recommends it too.");
      await s.click({ sel: ".options article:nth-child(2) button", text: "Approve this option" }, 700);
      await s.say("The approval restates exactly what she's accepting");
      await s.think("$1,700, two weeks, and we buy a label printer ourselves. That's what I read.");
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
      await s.click({ sel: "article.pcard a.name", text: "Orders without retyping" }, 1200);
      await s.click({ sel: "nav.tabs a", text: "Execute" }, 1000);
      await s.say("She opens a task and leaves a comment");
      await s.think("A 7pm summary. Sam closes most nights, though.");
      await s.click({ sel: ".item-open", text: "Daily summary at 7pm" }, 900);
      await s.type('textarea[aria-label="Write a comment"]', "Could the summary go to Sam too?");
      await s.click({ sel: ".comment-box button", text: "Send" }, 900);
      await s.click('dialog[open] button[aria-label="Close"]', 600);
      await s.say("The label printer from her option is on the list, for the bakery to buy");
      await s.think("I picked up the label printer at Staples yesterday. Let me mark it bought.");
      await s.hover({ sel: ".item", text: "Label printer for pickup bags" }, 900);
      await s.choose('select[aria-label="Where Label printer for pickup bags stands"]', "bought", 900);
      await s.think("It wants the receipt. It's right here.");
      await dropFile(s, { sel: ".item:has(.purchase-meta) .file-ask .chip", text: "Attach the receipt" }, "staples-receipt.pdf", "Staples receipt: Brother QL-820NWB label printer, $104.99", { layer: "execution", itemId: (items) => items.find((i) => i.kind === "purchase")?.id });
      await s.wait(700);
      await s.others(finishWork, 1200, "Pradeep finished three tasks");
      await s.think("All three are done already.");
      await s.hover({ sel: ".item", text: "Daily summary at 7pm" }, 900);
    },
  },
  {
    id: "pay",
    title: "Pay an invoice",
    why: "Pradeep's email says the deposit invoice is ready. Let me sign in and pay it.",
    run: async (s) => {
      await s.say("Half the fixed price is due up front, as her option said: Pradeep issues the deposit invoice");
      await s.others(issueDeposit, 900, "Pradeep issued the deposit invoice");
      await walkTo(s, `${base}/projects/${KEY}/execute`);
      await s.top();
      await s.say("Next step tells her it's ready, how much, and when it's due");
      await s.think("$850, due in two weeks. That's the half up front.");
      await s.hover(".next-step", 1100);
      await s.click({ sel: ".next-step a", text: "See and pay" }, 1000);
      await s.say("Every invoice lives under Execute, with what's paid and what's left");
      await s.hover({ sel: ".invoice-row", text: "INV-" }, 900);
      await s.think("Let me see the invoice itself first.");
      await s.click({ sel: ".invoice-row a.title", text: "INV-" }, 1200);
      await s.say("The invoice, on neon1's letterhead: its number, the lines, the due date, and how to pay");
      await s.think("Deposit, 50% of option B, 0039-r1-B. It matches what I signed.");
      await s.scroll(500, 1400);
      await s.think("Bank transfer is preferred. I'll do that.");
      await s.top();
      await s.say("Pay opens Stripe's secure page; 1NEON never sees her bank or card details");
      await s.click({ sel: ".pp-tools button", text: /^Pay / }, 1400);
      await s.say("She pays by bank transfer (ACH). It clears in a few days, and Stripe tells 1NEON");
      await s.others(depositPaid, 1200, "Her bank payment cleared");
      await s.think("Paid in full. It says so right on the invoice.");
      await s.hover(".inv-lines tfoot", 1200);
      await s.click({ sel: "a", text: "Back to invoices" }, 1000);
      await s.hover({ sel: ".invoice-row", text: "INV-" }, 1000);
    },
  },
  {
    id: "observe",
    title: "Measure it",
    why: "Is any of this actually saving us time? Let me sign in and check the numbers.",
    run: async (s) => {
      await s.say("Two weeks side by side; Pradeep records the numbers");
      await s.others(async () => {
        await moveTo("verify");
        const { t, p, items } = await project();
        for (const m of items.filter((i) => i.kind === "metric")) {
          const at = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
          // Templates' measures may have no numbers yet; give them a plausible start and goal
          const baseline = Number(m.fields.baseline ?? 0) || 60, target = Number(m.fields.target ?? 0) || 10;
          const readings = [{ at: at(10), value: baseline * 0.6, note: "" }, { at: at(5), value: baseline * 0.3, note: "" }, { at: at(1), value: Math.max(target * 0.6, 1), note: "" }];
          await as(`/t/${t}/projects/${p.id}/items/${m.id}`, "PATCH", { version: m.version, fields: { ...m.fields, baseline, target, readings } });
        }
      }, 900, "Pradeep recorded two weeks of numbers");
      await s.think("Two weeks in. Is it actually working?");
      await s.click({ sel: "nav.tabs a", text: "Observe" }, 1000);
      await s.say("Each measure shows its baseline, its target, and where it is now");
      await s.think("From an hour a night to six minutes. Wow.");
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
      await s.click({ sel: ".ptr", text: "Orders without retyping" }, 1000);
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
      await s.say("Sam takes the walkthrough on Friday; she marks the training done");
      await s.think("Sam ran Friday's orders on his own after the walkthrough.");
      await s.click('input[aria-label="Done: Front desk walkthrough for Sam, recorded for new staff"]', 600);
      await s.say("Pradeep retires the old order spreadsheet's macros and steps his own access down");
      await s.others(async () => {
        await patch((i) => i.title === "Older tools it replaces retired or merged, and leftovers cleaned up", { status: "done" });
        await patch((i) => i.title === "neon1 access reduced or removed", { status: "done" });
      }, 900, "Pradeep finished his two handover steps");
      await s.say("For the last step she checks it herself and accepts it, in writing");
      await s.think("Sam's trained. I'll accept that one myself.");
      await s.click({ sel: '.item:has(input[aria-label="Done: The people who use it are trained on it"]) button.chip', text: "Check it and accept" }, 500);
      await s.type('input[aria-label="What you checked (optional)"]', "Sam closed Friday using the runbook");
      await s.type('form.accept-form input.sign-name', "Maria Lopez");
      await s.click("form.accept-form .sign-consent input", 400);
      await s.click({ sel: "form.accept-form button", text: /^Sign and accept$/ }, 1000);
      await s.say("Accepting the last step drafts the final invoice for the rest, for Pradeep to send");
      await s.say("And adds ongoing care from a suggestion");
      await s.think("A monthly check-in makes sense for us.");
      await s.click({ sel: "button", text: "+ Add care item" }, 500);
      await s.click({ sel: ".starters .chip", text: "Monthly updates and backup check" }, 300);
      await s.click({ sel: "form.add-form button", text: /^Add$/ }, 900);
    },
  },
  {
    id: "care",
    title: "Ongoing care",
    why: "It's been running a while. Let me sign in and see how things look across everything.",
    run: async (s) => {
      await s.say("Pradeep issues the final invoice for the other half; she pays it the same way");
      await s.others(issueFinal, 900, "Pradeep issued the final invoice");
      await s.others(finalPaid, 900, "Her bank payment cleared");
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
      await s.think("No more retyping orders. That's my evenings back.");
      await s.wait(1800);
    },
  },
];
