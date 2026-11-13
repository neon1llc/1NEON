// apps/web/src/live/opening.ts - How every walkthrough begins: Maria on the sign-in screen with a
// thought about what she's come to do, the real email-code sign-in, and then the walk, click by click,
// from Home to the page where that thing lives. The full story, the short preview, the short demos,
// and a link from the FAQs into the middle of the story all start this way.


import { liveEngine } from "../lib/api.ts";
import type { Section, Stage } from "./player.ts";
import { MailWindow } from "./props.ts";
import { MARIA } from "./seed.ts";


const engine = async () => (await liveEngine())!;

// Thrown inside the sign-in to skip the mail's show while catching up; caught right there
class Skip extends Error {}


/**
 * The real sign-in, as Maria does it: her email, Continue, the code from her inbox, and in. While
 * catching up (fast), the code is read without opening the mail on screen
 */
export async function signInWithCode(s: Stage, opts: { email?: string; prefilled?: boolean } = {}) {
  const email = opts.email ?? MARIA;
  if (!opts.prefilled) await s.type("#email", email, 400);
  await s.click({ sel: "form button", text: "Continue" }, 1000);
  // The code field shows once the code email is out, so it's in her inbox from here
  await s.waitFor("#code", 8000);
  await s.say("No password: 1NEON emails her a sign-in code");
  await s.think("It sent me a code. Let me check my email.");
  const mail = new MailWindow(email);
  let code = "";
  try {
    mail.fill((await engine()).outbox());
    const at = () => [...mail.el.querySelectorAll(".mail-row")].indexOf(mail.row("sign-in code")!);
    if (s.fast()) {
      mail.open(at());
      code = mail.code()?.value ?? "";
      throw new Skip();
    }
    await s.wait(700);
    await s.click(() => mail.row("sign-in code"), 300);
    mail.open(at());
    await s.wait(700);
    code = mail.code()?.value ?? "";
    await s.hover(() => mail.code()?.el, 700);
    await s.think(`There it is: ${code}. Copy.`);
    await s.wait(500);
  } catch (e) {
    if (!(e instanceof Skip)) throw e;
  } finally {
    await mail.close();
  }
  await s.think("Back to 1NEON. Paste, and Enter.");
  await s.paste("#code", code, 400);
  await s.key("Enter", 1400);
  // Signed in: Home, or the first-time welcome when there is one
  await s.waitFor({ sel: "h1, dialog[open] h2" }, 8000);
}


// The project tabs by their address word, as their labels read
const TAB: Record<string, string> = { needs: "Needs", execute: "Execute", execution: "Execute", observe: "Observe", observation: "Observe", normalize: "Normalize", next: "Normalize" };
// The menu's label for each organization page
const PAGE: Record<string, string> = { workspace: "Home", projects: "Projects", people: "People", documents: "Files", insights: "Insights", settings: "Settings", workflow: "Board" };


/**
 * From Home to a page, the way she'd get there: the menu, then the project's row, then its tab. Pages
 * it doesn't know the way to are opened directly, as a bookmark would
 */
export async function walkTo(s: Stage, path: string) {
  const here = () => location.pathname.replace(/^\/1NEON\/live/, "") || "/";
  if (here() === path) return;
  const m = /^\/o\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(path);
  if (path === "/me") {
    await s.think("My profile is in the menu.");
    await s.go("/me");
    return;
  }
  if (!m) return void (await s.open(path));
  const [, slug, page, key, tab] = m;
  const org = `/o/${slug}`;
  if (page === "projects" && key && key !== "new") {
    await s.think("Our project is under Projects.");
    await s.go(`${org}/projects`, "Projects");
    // Each row opens through its link in either layout: List's .ptr or Timeline's .tl-row
    await s.click({ sel: `.ptr a[href$="/projects/${key}"], .tl-row a[href$="/projects/${key}"]` }, 900);
    if (tab && TAB[tab]) {
      await s.think(`${TAB[tab]} is the tab I want.`);
      await s.click({ sel: "nav.tabs a", text: TAB[tab]! }, 900);
    }
  } else if (PAGE[page!]) {
    await s.go(`${org}/${page}`, PAGE[page!]);
  } else {
    await s.open(path);
  }
  // Anything the menu couldn't reach exactly (a search, a filter) lands by address
  if (here() !== path) await s.open(path, 400);
}


/**
 * The opening section of a walkthrough: why she's here, the sign-in, and the walk to `path` (Home if
 * left out). `thought` is Maria's own reason, in her words, matching the question the walkthrough answers
 */
export function opening(id: string, caption: string, thought: string, path?: string): Section {
  return {
    id,
    title: "Sign in",
    run: async (s) => {
      await s.say(caption);
      await s.think(thought);
      await s.wait(900);
      await signInWithCode(s);
      await s.say("Home: what needs her, what's coming up, and what's new");
      await s.think("Home. Now, where I need to go.");
      await s.wait(600);
      if (path) await walkTo(s, path);
    },
  };
}
