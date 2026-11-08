// apps/web/src/live/story.ts - The live playback's story: Maria, who owns Maple Street Bakery, and
// Pradeep at neon1 take one project from a first sign-in to ongoing care. The cursor is Maria's;
// Pradeep's side arrives the way it would for her, through the page and the notification bell.


import { liveEngine } from "../lib/api.ts";
import type { Section, Stage } from "./player.ts";
import { MARIA, PRADEEP } from "./seed.ts";


// The bakery's organization, and the project once it exists
const SLUG = "maple-street";
const KEY = "FLOW-1";
const base = `/o/${SLUG}`;

// Pradeep's calls go through the in-browser API, as if from his own browser
const engine = async () => (await liveEngine())!;
async function as<T>(path: string, method = "GET", body?: unknown) {
  return (await engine()).actAs<T>(PRADEEP, path, method, body);
}
type P = { id: string; key: string; version: number; stageId: string };
type I = { id: string; kind: string; title: string; version: number; status: string; fields: Record<string, unknown> };
// The bakery's ID, and its project with every item, fresh each time
async function tid() {
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
async function add(kind: string, title: string, extra: Record<string, unknown> = {}) {
  const { t, p } = await project();
  return as<I>(`/t/${t}/projects/${p.id}/items`, "POST", { kind, title, ...extra });
}
async function moveTo(stageId: string, reason?: string) {
  const { t, p } = await project();
  await as(`/t/${t}/projects/${p.id}/move`, "POST", { version: p.version, stageId, reason });
}
async function patch(match: (i: I) => boolean, body: Record<string, unknown>) {
  const { t, p, items } = await project();
  const i = items.find(match)!;
  await as(`/t/${t}/projects/${p.id}/items/${i.id}`, "PATCH", { version: i.version, ...body });
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


/** The sections, in order. Titles are what the Back and Next buttons say */
export const STORY: Section[] = [
  {
    id: "signin",
    title: "Sign in",
    run: async (s) => {
      await s.say("Maria, who owns Maple Street Bakery, opens 1NEON for the first time");
      await s.wait(1200);
      await s.hover({ sel: ".demo-pick button", text: "Maria" }, 500);
      await s.click({ sel: ".demo-pick button", text: "Maria" }, 1600);
      await s.say("Home shows what needs her, what's coming up, and what's new");
      await s.hover({ sel: "h2.section-h", text: "Needs you" }, 900);
      await s.hover({ sel: "h2.section-h", text: "Coming up" }, 900);
      await s.hover(".bell-btn", 900);
    },
  },
  {
    id: "profile",
    title: "Profile and alerts",
    run: async (s) => {
      await s.say("She opens her profile to choose what reaches her by email");
      await s.go("/me");
      await s.waitFor("#notifications");
      await s.hover({ sel: "#notifications .notify-table tbody th", text: "Files" }, 700);
      await s.say("Important changes email her already; she adds comments too");
      await s.click('input[aria-label="Email me: Comments"]', 500);
      await s.click({ sel: ".chip", text: "Match my device" }, 500);
      await s.click({ sel: ".chip", text: "Awake (light)" }, 400);
      await s.click({ sel: "button", text: /^Save$/ }, 1200);
    },
  },
  {
    id: "team",
    title: "Invite the team",
    run: async (s) => {
      await s.say("She invites Sam, who runs the counter, as an editor");
      if (phone()) await s.go(`${base}/people`);
      else await s.go(`${base}/people`, "People");
      await s.click({ sel: "button", text: "Invite people" });
      await s.type("#emails", "sam@maplestreetbakery.example", 300);
      await s.choose("#acc", "editor");
      await s.click({ sel: "button", text: "Send invitation" }, 1400);
      await s.hover({ sel: ".card, li, tr", text: "sam@maplestreetbakery.example" }, 900);
    },
  },
  {
    id: "start",
    title: "Start a project",
    run: async (s) => {
      await s.say("She starts a project from a template");
      await s.go(`${base}/projects`, "Projects");
      await s.click({ sel: "a, button", text: "New project" }, 700);
      await s.hover({ sel: "label.option", text: "Cloud migration" }, 400);
      await s.click({ sel: "label.option", text: "Workflow automation" }, 500);
      await s.click({ sel: "button", text: /^Next$/ }, 700);
      await s.say("A few short answers, each with an example of what to write");
      await s.type("#n", "Orders without retyping");
      await s.type("#s", "Orders come in by email and phone, and we retype them into a spreadsheet each night.");
      await s.type("#o", "Every order lands in one list on its own, and nobody retypes it.");
      await s.type("#x", "Last Friday, 41 orders: 35 emails and 6 voicemails, typed in from 8 to 9pm.");
      await s.choose("#d", new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10));
      await s.click({ sel: "button", text: /^Next$/ }, 700);
      await s.say("How they'll know it worked: where things are now, and where they should be");
      await s.type("#mt0", "Minutes retyping each night");
      await s.type("#mu0", "min");
      await s.type("#mb0", "60");
      await s.type("#mg0", "10");
      await s.click({ sel: "button", text: /^Next$/ }, 900);
      await s.click({ sel: "button", text: "Create project" }, 1600);
    },
  },
  {
    id: "needs",
    title: "Tell neon1 what's needed",
    run: async (s) => {
      await s.say("In Needs, she builds her request from a few taps");
      await s.click({ sel: "nav.tabs a", text: "Needs" }, 900);
      await s.click({ sel: "button", text: "+ Add request" }, 600);
      const one = "form.sentence fieldset:nth-of-type(1)";
      await s.click({ sel: `${one} button`, text: "save time" }, 250);
      await s.click({ sel: `${one} button`, text: "stop mistakes" }, 300);
      await s.type(`${one} input[aria-label="Who or what it's for"]`, "the nightly order list");
      await s.type(`${one} input[aria-label="What happens now"]`, "we retype about 40 orders from email each night");
      await s.click({ sel: `${one} [role=radio]`, text: "daily" }, 300);
      await s.click({ sel: `${one} [role=radio]`, text: "on a date" }, 400);
      const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      await s.choose(`${one} input[aria-label="Due date, or start of a range"]`, d(30));
      await s.choose(`${one} input[aria-label="End of the range (optional)"]`, d(40));
      await s.say("A second need, for the busy season, with an action of her own");
      await s.click({ sel: "button", text: "+ Define another need" }, 600);
      const two = "form.sentence fieldset:nth-of-type(2)";
      await s.click({ sel: `${two} button`, text: "prepare" }, 300);
      await s.click(`${two} button[aria-label="Add your own action"]`, 300);
      await s.type(`${two} input[aria-label="Your own action"]`, "train Sam");
      await s.click({ sel: `${two} input[aria-label="Who or what it's for"]` }, 200);
      await s.type(`${two} input[aria-label="Who or what it's for"]`, "the holiday rush");
      await s.click({ sel: `${two} [role=radio]`, text: "this quarter" }, 400);
      await s.click({ sel: "button", text: "Send 2 requests" }, 1200);
      await s.say("Discovery questions take a short answer right where they're asked");
      await s.type('textarea[aria-label^="Answer:"]', "Sam and I, every night after close. It takes about an hour.");
      await s.click({ sel: "button", text: "Save answer" }, 900);
      await s.say("Requirements: a suggestion, and how much it matters");
      await s.click({ sel: "button", text: "+ Add requirement" }, 500);
      await s.click({ sel: ".starters .chip", text: "Works on a phone" }, 300);
      await s.click({ sel: "[role=radio]", text: "must have" }, 300);
      await s.click({ sel: "form.add-form button", text: /^Add$/ }, 900);
    },
  },
  {
    id: "listen",
    title: "neon1 listens",
    run: async (s) => {
      await s.say("Pradeep reads it all, moves the project to Listen, and asks for a file");
      await s.others(async () => {
        await moveTo("intake");
        await moveTo("listen");
        await add("file_request", "A week of order emails, names removed", { body: "Export or forward them as a zip, whichever is easier." });
      }, 1200, "Pradeep asked for a file");
      await s.say("The bell breathes: something's new");
      await s.click(".bell-btn", 1800);
      await s.click(".bell-btn", 400);
      await s.say("She drags the export in from her desktop");
      await dropFile(s, { sel: ".file-ask .chip, .file-ask button", text: "Upload" }, "orders-week.zip", "41 orders, names removed", { layer: "needs", itemId: (items) => items.find((i) => i.kind === "file_request")?.id });
      await s.wait(900);
    },
  },
  {
    id: "propose",
    title: "Options arrive",
    run: async (s) => {
      await s.say("Pradeep writes three options, each with its cost, quality, and effort");
      await s.others(async () => {
        await moveTo("propose");
        const opts: [string, string, Record<string, unknown>][] = [
          ["A. Quick fix", "An order form that writes straight into the spreadsheet.", { cost: "$400 fixed", costScore: 5, qualityScore: 2, effortScore: 5, timeline: "2 days" }],
          ["B. Solid setup", "The form, plus emailed orders read into the same list, with a 7pm summary.", { cost: "$1,600 fixed", costScore: 4, qualityScore: 4, effortScore: 4, timeline: "1 week", recommended: true }],
          ["C. Fuller build", "All of that, plus an order page with pickup times and reminders.", { cost: "$4,000 fixed + $10/mo", costScore: 2, qualityScore: 5, effortScore: 2, timeline: "3 weeks" }],
        ];
        for (const [title, body, fields] of opts) {
          const o = await add("option", title, { body, fields });
          const { t, p } = await project();
          await as(`/t/${t}/projects/${p.id}/items/${o.id}`, "PATCH", { version: o.version, status: "proposed" });
        }
        await moveTo("decide");
      }, 1200, "Pradeep proposed three options");
      await s.click(".bell-btn", 1600);
      await s.click(".bell-btn", 300);
      await s.top();
      await s.say("Next step says what's waiting on her");
      await s.hover(".next-step, .card", 900);
    },
  },
  {
    id: "decide",
    title: "Choose an option",
    run: async (s) => {
      await s.say("She compares the three side by side");
      await s.click({ sel: "a, button", text: "Compare options" }, 1200);
      await s.hover({ sel: ".options article", text: "A. Quick fix" }, 700);
      await s.hover({ sel: ".options article", text: "B. Solid setup" }, 700);
      await s.hover({ sel: ".options article", text: "C. Fuller build" }, 700);
      await s.say("She approves the recommended one, with a condition");
      await s.click({ sel: ".options article:nth-child(2) button", text: "Approve this option" }, 700);
      await s.type("#cond", "Go live after the Saturday rush.");
      await s.click({ sel: "dialog[open] button", text: /^Approve$/ }, 1600);
      await s.top();
      await s.hover(".decision", 1200);
    },
  },
  {
    id: "build",
    title: "The work",
    run: async (s) => {
      await s.say("On the board, she drags the project into Build");
      await s.go(`${base}/workflow`, "Board");
      await s.drag({ sel: "article.pcard", text: KEY }, '.col[aria-label^="Build"]');
      await s.wait(600);
      await s.say("Pradeep plans the work and posts an update");
      await s.others(async () => {
        await add("milestone", "Staff trial starts", { dueDate: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10) });
        await add("task", "Order form connected to the spreadsheet");
        await add("task", "Emailed orders read into the same list");
        await add("task", "Daily summary at 7pm");
        await add("update", "Form is live; email reading starts Monday", { fields: { health: "on_track" } });
      }, 900, "Pradeep planned the work and posted an update");
      await s.click({ sel: "article.pcard a.name", text: "Orders without retyping" }, 1200);
      await s.click({ sel: "nav.tabs a", text: "Execute" }, 1000);
      await s.say("She opens a task and leaves a comment");
      await s.click({ sel: ".item-open", text: "Daily summary at 7pm" }, 900);
      await s.type('textarea[aria-label="Write a comment"]', "Could the summary go to Sam too?");
      await s.click({ sel: ".comment-box button", text: "Send" }, 900);
      await s.click('dialog[open] button[aria-label="Close"]', 600);
      await s.others(async () => {
        await patch((i) => i.title === "Order form connected to the spreadsheet", { status: "done" });
        await patch((i) => i.title === "Emailed orders read into the same list", { status: "done" });
        await patch((i) => i.title === "Daily summary at 7pm", { status: "done" });
      }, 1200, "Pradeep finished three tasks");
      await s.hover({ sel: ".item", text: "Daily summary at 7pm" }, 900);
    },
  },
  {
    id: "observe",
    title: "Measure it",
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
      await s.click({ sel: "nav.tabs a", text: "Observe" }, 1000);
      await s.say("Each measure shows its baseline, its target, and where it is now");
      await s.hover(".scores > *", 1200);
      await s.type('input[aria-label^="New reading"]', "5");
      await s.key("Enter");
      await s.wait(900);
      await s.go(`${base}/insights`, "Insights");
      await s.say("Insights pulls it together across projects");
      await s.wait(1600);
      await s.scroll(400, 1200);
    },
  },
  {
    id: "handover",
    title: "Hand over",
    run: async (s) => {
      await s.say("Pradeep hands over: a runbook, a walkthrough, and the accounts in her name");
      await s.others(async () => {
        await moveTo("handover");
        const { t, p } = await project();
        await (await engine()).uploadAs(PRADEEP, t, "orders-runbook.txt", "Where orders go, and what to do if one looks wrong.", { layer: "next", projectId: p.id });
        await add("training", "Front desk walkthrough, recorded for new staff");
      }, 900, "Pradeep uploaded the runbook");
      await s.go(`${base}/projects`, "Projects");
      await s.click({ sel: ".ptr", text: "Orders without retyping" }, 1000);
      await s.click({ sel: "nav.tabs a", text: "Normalize" }, 1000);
      await s.say("She checks off the handover as each step is done");
      for (const t of ["Accounts are in the client's name", "Admin access transferred to the client", "Docs delivered and walked through", "The people who use it are trained on it"]) {
        await s.click(`input[aria-label="Done: ${t}"]`, 450);
      }
      await s.say("And adds ongoing care from a suggestion");
      await s.click({ sel: "button", text: "+ Add care item" }, 500);
      await s.click({ sel: ".starters .chip", text: "Monthly updates and backup check" }, 300);
      await s.click({ sel: "form.add-form button", text: /^Add$/ }, 900);
    },
  },
  {
    id: "care",
    title: "Ongoing care",
    run: async (s) => {
      await s.others(async () => { await moveTo("care"); }, 700, "Pradeep moved the project to Care");
      await s.say("The whole project, on a timeline");
      await s.go(`${base}/projects`, "Projects");
      await s.click({ sel: "[role=tab]", text: "Timeline" }, 1600);
      await s.say("Every file in one place");
      await s.go(`${base}/documents`, "Files");
      await s.wait(1400);
      await s.say("And every change, kept as history");
      await s.go(`${base}/settings`, "Settings");
      await s.wait(1000);
      await s.scroll(1200, 1600);
      await s.go(`${base}/workspace`, "Home");
      await s.say("From a first request to a measured result, all in one place");
      await s.wait(1600);
    },
  },
];
