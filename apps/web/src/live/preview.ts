// apps/web/src/live/preview.ts - The short preview /1NEON/live opens with: one fictional request
// becoming a handover in about two minutes, signed in for real, on the real portal. Request, compare, approve,
// see progress, receive the handover. The full story (?play=full) and the short demos stay a pick
// away in the controls' menu.


import { liveEngine } from "../lib/api.ts";
import { MEASURES, MONEY, PROJECT as BAKERY, TASKS } from "../lib/bakery.ts";
import { opening } from "./opening.ts";
import type { Show } from "./player.ts";
import { MARIA } from "./seed.ts";
import { base, dryRun, finishWork, handOver, KEY, listenNotes, moveTo, planWork, proposeOptions, signAgreementAsMaria, tid } from "./story.ts";


// The project the preview works in, and its pages
const PROJECT = `${base}/projects/${KEY}`;


/** Maria's project, made quietly before she signs in (she set it up earlier), so the walk leads to it */
async function startProject() {
  const engine = (await liveEngine())!;
  await engine.actAs(MARIA, `/t/${await tid()}/projects`, "POST", {
    name: BAKERY.name, template: "workflow_automation", summary: BAKERY.today, outcome: BAKERY.outcome, example: BAKERY.example,
    metrics: [{ title: MEASURES[0].title, unit: MEASURES[0].unit, baseline: MEASURES[0].baseline, target: MEASURES[0].target }],
    idempotencyKey: "live-preview-project",
  });
}


// The opening: Maria's reason, the sign-in, and the walk to the project's Needs tab
const IN = opening("p-in", "Maria, who owns a fictional bakery, opens 1NEON", "The nightly orders take us an hour of retyping. Let me sign in and ask Pradeep for help.", `${PROJECT}/needs`);


/** About two minutes at the default speed: the sign-in and the walk to the project, then the five steps */
export const PREVIEW: Show = {
  id: "preview",
  title: "The short preview",
  blurb: "Request, compare, approve, progress, and handover",
  length: "about two minutes",
  intro: {
    text: [
      "Maria owns a fictional bakery. Every night she and Sam retype about 40 orders from email, voicemail, and Instagram into a spreadsheet, and she has asked Pradeep at neon1 for help.",
      "In about two minutes you'll watch her sign in, ask for what she needs, compare three priced options, approve one, see the work and its hours, and take the handover. Her thoughts appear beside the cursor, and a line at the bottom says what's happening.",
    ],
  },
  end: "That's the short version.",
  recap: "Maria asked for help in one sentence, compared three options with the hours behind each price, signed for one, saw the work finished hour by hour, and took over the accounts and the runbook. The full story shows every step in between, including both invoices.",
  sections: [
    // She comes in the front door: why she's here, the emailed code, and the walk to the project's Needs
    { ...IN, run: async (s) => { await s.others(startProject, 0); await IN.run(s); } },
    {
      id: "p-request",
      title: "Ask for something",
      run: async (s) => {
        await s.say("She asks neon1 for help with the nightly orders");
        await s.think("I'll say what I need in one sentence.");
        await s.click({ sel: "button", text: "+ Add request" }, 500);
        const one = "form.sentence fieldset:nth-of-type(1)";
        await s.click({ sel: `${one} button`, text: "save time" }, 250);
        await s.type(`${one} input[aria-label="Who or what it's for"]`, "the nightly orders");
        await s.click({ sel: "button", text: /^Send request$/ }, 900);
        await s.think("Sent. Pradeep sees it right away.");
        await s.wait(700);
      },
    },
    {
      id: "p-compare",
      title: "Compare options",
      run: async (s) => {
        await s.say("neon1 listens first, then answers with three options, each with its price and tradeoffs");
        // She signed neon1's service agreement when the bakery joined, and Pradeep wrote up their
        // first call (the full story shows both)
        await s.others(async () => { await signAgreementAsMaria(); await listenNotes(); await proposeOptions(); }, 900, "Pradeep proposed three options");
        await s.top();
        await s.click({ sel: "a, button", text: "Compare options" }, 1000);
        await s.think("A is the cheapest, but it only fixes the form.");
        await s.hover({ sel: ".options article", text: "A. Quick fix" }, 900);
        await s.think("B reads the emails and voicemails too. That's the real time saver.");
        await s.hover({ sel: ".options article", text: "B. Solid setup" }, 900);
        await s.say("A price is never a bare number: it opens to the hours behind it and when she pays");
        await s.click(".options article:nth-child(2) .basis summary", 800);
        await s.think(`${MONEY.range}, an estimate. I pay for the hours he works, and never more than ${MONEY.high} unless I agree first.`);
        await s.hover(".options article:nth-child(2) .basis-table", 1500);
      },
    },
    {
      id: "p-approve",
      title: "Approve one",
      run: async (s) => {
        await s.say("She approves one; the decision is kept with the exact terms she saw");
        await s.click({ sel: ".options article:nth-child(2) button", text: "Approve this option" }, 600);
        await s.think("Just not before Saturday. That's our busiest day.");
        await s.type("#cond", "After the Saturday rush.");
        await s.type("#approve-sign-name", "Maria Lopez");
        await s.click("#approve-sign-name ~ .sign-consent input", 400);
        await s.click({ sel: "dialog[open] .actions button", text: /^Sign and approve/ }, 1200);
        await s.top();
        await s.think("Written down, condition and all.");
        await s.hover(".decision", 1200);
      },
    },
    {
      id: "p-progress",
      title: "See progress",
      run: async (s) => {
        await s.say("The work shows up as it happens, with updates she can read in a minute");
        await s.others(async () => { await moveTo("build"); await planWork(); await finishWork(); }, 700, "Pradeep finished four tasks");
        await s.click({ sel: "nav.tabs a", text: "Execute" }, 900);
        await s.think("Pradeep posted the plan, and four of the five tasks are done.");
        await s.hover({ sel: ".item", text: TASKS.summary }, 900);
        await s.think(`${MONEY.loggedAfterBuild} logged so far, each with what it was for.`);
        await s.hover("#hours .hours-table", 1300);
      },
    },
    {
      id: "p-handover",
      title: "Receive the handover",
      run: async (s) => {
        await s.say("At handover, the accounts and the know-how become hers");
        await s.others(async () => { await moveTo("verify"); await dryRun(); await handOver(); }, 700, "Pradeep uploaded the runbook");
        await s.click({ sel: "nav.tabs a", text: "Normalize" }, 900);
        await s.think("The accounts are in the bakery's name. Check.");
        await s.click('input[aria-label="Done: Accounts are in the client\'s name"]', 500);
        await s.think("And a runbook, so we can handle things ourselves.");
        await s.click('input[aria-label="Done: Docs delivered and walked through"]', 900);
        await s.say("From a request to a handover, in one place");
        await s.think("That's it. The orders run themselves now, and it's all ours.");
        await s.wait(1200);
      },
    },
  ],
};
