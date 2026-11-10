// apps/web/src/live/preview.ts - The short preview /1NEON/live opens with: one fictional request
// becoming a handover in about a minute, on the real portal. Request, compare, approve,
// see progress, receive the handover. The full story (?play=full) and the short demos stay a pick
// away in the controls' menu.


import { liveEngine } from "../lib/api.ts";
import type { Show } from "./player.ts";
import { MARIA } from "./seed.ts";
import { base, finishWork, handOver, KEY, moveTo, planWork, proposeOptions, tid } from "./story.ts";


// The project the preview works in, and its pages
const PROJECT = `${base}/projects/${KEY}`;


/** Maria's project, made quietly as the preview starts, so the first thing on screen is the request */
async function startProject() {
  const engine = (await liveEngine())!;
  await engine.actAs(MARIA, `/t/${await tid()}/projects`, "POST", { name: "Orders without retyping", template: "workflow_automation", idempotencyKey: "live-preview-project" });
}


/** About 60 to 70 seconds at the default speed (measured end to end in a desktop browser) */
export const PREVIEW: Show = {
  id: "preview",
  title: "The short preview",
  blurb: "Request, compare, approve, progress, and handover",
  length: "about a minute and a half",
  who: MARIA,
  path: `${base}/workspace`,
  end: "That's the short version. The full story, or the interactive demo, goes further.",
  sections: [
    {
      id: "p-request",
      title: "Ask for something",
      run: async (s) => {
        await s.others(startProject, 200);
        await s.open(`${PROJECT}/needs`, 700);
        await s.say("Maria, who owns a fictional bakery, asks neon1 for help with nightly orders");
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
        await s.say("neon1 answers with three options, each with its cost and tradeoffs");
        await s.others(proposeOptions, 900, "Pradeep proposed three options");
        await s.top();
        await s.click({ sel: "a, button", text: "Compare options" }, 1000);
        await s.think("A is cheap, but it only fixes the form.");
        await s.hover({ sel: ".options article", text: "A. Quick fix" }, 900);
        await s.think("B reads the emails too. That's the real time saver.");
        await s.hover({ sel: ".options article", text: "B. Solid setup" }, 900);
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
        await s.click({ sel: "dialog[open] button", text: /^Approve$/ }, 1200);
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
        await s.others(async () => { await moveTo("build"); await planWork(); await finishWork(); }, 700, "Pradeep finished three tasks");
        await s.click({ sel: "nav.tabs a", text: "Execute" }, 900);
        await s.think("Pradeep posted the plan, and an update.");
        await s.wait(900);
        await s.think("All three tasks are done already.");
        await s.hover({ sel: ".item", text: "Daily summary at 7pm" }, 900);
      },
    },
    {
      id: "p-handover",
      title: "Receive the handover",
      run: async (s) => {
        await s.say("At handover, the accounts and the know-how become hers");
        await s.others(async () => { await moveTo("verify"); await handOver(); }, 700, "Pradeep uploaded the runbook");
        await s.click({ sel: "nav.tabs a", text: "Normalize" }, 900);
        await s.think("The accounts are in the bakery's name. Check.");
        await s.click('input[aria-label="Done: Accounts are in the client\'s name"]', 500);
        await s.think("And a runbook, so we can handle things ourselves.");
        await s.click('input[aria-label="Done: Docs delivered and walked through"]', 900);
        await s.say("From a request to a handover, in one place");
        await s.wait(2600);
      },
    },
  ],
};
