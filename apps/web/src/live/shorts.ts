// apps/web/src/live/shorts.ts - The short demos: one thing each, start to finish, linked from the
// FAQs and the live playback's menu. Each plays at /1NEON/live?play=<id>, on the real portal, with
// Maria's mail, phone, and passkey prompt drawn around it (props.ts).


import { liveEngine } from "../lib/api.ts";
import type { Show, Stage, Target } from "./player.ts";
import { fakePasskeys, MailWindow, Phone } from "./props.ts";
import { MARIA, SAM } from "./seed.ts";


// The bakery's pages, and where the short demos that start signed in begin
const base = "/o/maple-street";
const HOME = `${base}/workspace`;
// The number 1NEON texts come from
const TEXTS_FROM = "1NEON · (844) 701-1281";
// Maria's mobile, made up
const MOBILE = "(555) 010-2030";

const engine = async () => (await liveEngine())!;
const phone = () => innerWidth <= 640;


// --- Pieces the short demos share -------------------------------------------------------


/** Open Maria's mail with everything sent to her so far; the caller closes it */
async function openMail(s: Stage) {
  const mail = new MailWindow(MARIA);
  mail.fill((await engine()).outbox());
  await s.wait(700);
  return mail;
}

/** Open the newest message whose subject matches, as Maria would: click its row */
async function read(s: Stage, mail: MailWindow, subject: string | RegExp) {
  await s.click(() => mail.row(subject), 300);
  mail.open([...mail.el.querySelectorAll(".mail-row")].indexOf(mail.row(subject)!));
  await s.wait(700);
}

/** On a phone-sized screen the pretend phone would cover the field, so she puts it down to type */
async function putDown(ph: Phone) {
  if (phone()) await ph.close();
}

/** The newest text to Maria's phone, read off the phone (codes are its six digits) */
async function lastText() {
  const t = (await engine()).textsSent().at(-1);
  return t?.body ?? "";
}

/** Passkey prompts stay pretend for the whole short demo, wherever it starts */
let restorePasskeys: (() => void) | undefined;
function pretendPasskeys() {
  restorePasskeys ??= fakePasskeys(MARIA);
}

/** Open the profile from the menu, the way Maria would */
async function profile(s: Stage, section?: string) {
  if (phone()) await s.go("/me");
  else await s.click(".who-link", 900);
  await s.waitFor("#notifications");
  if (section) await s.hover(section, 500);
}

/** Invite Sam: an admin action, so 1NEON asks Maria to confirm it's her first */
async function inviteSam(s: Stage) {
  if (phone()) await s.go(`${base}/people`);
  else await s.go(`${base}/people`, "People");
  await s.click({ sel: "button", text: "Invite people" }, 500);
  await s.type("#emails", SAM, 300);
  await s.click({ sel: "button", text: "Send invitation" }, 1000);
}

/** After confirming, the invitation goes out on the second try */
async function sendAgain(s: Stage) {
  await s.wait(500);
  await s.click({ sel: "button", text: "Send invitation" }, 1200);
  await s.waitFor({ sel: "tbody tr", text: SAM }, 8000);
  await s.hover({ sel: "tbody tr", text: SAM }, 900);
}

// The confirm dialog, once it's open
const CONFIRM: Target = { sel: "dialog[open] h2", text: "Confirm it's you" };


// --- The short demos ----------------------------------------------------------------


/** Join from an invitation: the email, the link, a code by email, and the first look around */
const invite: Show = {
  id: "invite",
  title: "Join from an invitation",
  blurb: "From the invite email to a first sign-in",
  end: "Invited to signed in, with no password at all.",
  sections: [
    {
      id: "invite-email",
      title: "The invitation",
      run: async (s) => {
        // The tour is offered once per browser session; this demo always shows the offer
        try { sessionStorage.removeItem("1neon.tour-offered"); } catch { /* storage blocked */ }
        await s.say("Maria gets an email: Pradeep invited her bakery to 1NEON");
        const mail = await openMail(s);
        try {
          await s.think("An email from neon1. That must be the invite Pradeep mentioned.");
          await read(s, mail, "You're invited");
          await s.think("Pradeep invited me to Maple Street Bakery. No password to make. Good.");
          await s.hover(() => mail.link("Join"), 900);
          await s.click(() => mail.link("Join"), 600);
        } finally {
          await mail.close();
        }
        // The invite link opens 1NEON with her email filled in
        s.open(`/?email=${encodeURIComponent(MARIA)}`);
        await s.wait(900);
      },
    },
    {
      id: "invite-code",
      title: "Sign in with a code",
      run: async (s) => {
        await s.say("Her email is filled in from the link; 1NEON emails her a code");
        await s.think("My email's already there. Continue.");
        await s.click({ sel: "form button", text: "Continue" }, 1000);
        await s.think("It sent me a code. Let me check my email.");
        const mail = await openMail(s);
        let code = "";
        try {
          await read(s, mail, "sign-in code");
          code = mail.code()?.value ?? "";
          await s.think(`There it is: ${code}. It works for a few minutes.`);
          await s.hover(() => mail.code()?.el, 900);
        } finally {
          await mail.close();
        }
        await s.say("She types the code; no password, ever");
        await s.think("Back to 1NEON. I'll type it in.");
        await s.type("#code", code, 400);
        await s.click({ sel: "form button", text: "Sign in" }, 1600);
      },
    },
    {
      id: "invite-tour",
      title: "First look",
      run: async (s) => {
        await s.say("The first time in, 1NEON asks her name and offers a one-minute tour");
        await s.waitFor({ sel: "dialog[open] h2", text: "New here?" }, 8000);
        await s.think("It wants my name, so the team knows who I am.");
        await s.type("#welcome-name", "Maria Lopez", 400);
        await s.think("A one-minute tour? Sure.");
        await s.click({ sel: "dialog[open] button", text: "Start the tour" }, 1200);
        // Step through the whole tour, with a thought at the stops that matter most to her
        const lines: Record<string, string> = {
          Home: "Home first. Good.",
          Board: "The board shows every project's stage.",
          "N E O N": "Needs, Execute, Observe, Normalize. Got it.",
          Menu: "Every page is in the menu, then.",
          Search: "And search, for anything.",
        };
        for (let i = 0; i < 16; i++) {
          const next = await s.waitFor({ sel: ".driver-popover-next-btn" }, 3000).catch(() => undefined);
          if (!next) break;
          const title = document.querySelector(".driver-popover-title")?.textContent?.trim() ?? "";
          if (lines[title]) await s.think(lines[title]!);
          await s.click({ sel: ".driver-popover-next-btn" }, lines[title] ? 700 : 350);
        }
        await s.say("Home: what needs her, what's coming up, and what's new");
        await s.think("So this is where our project will live.");
        await s.hover({ sel: "h2.section-h", text: "Needs you" }, 1200);
      },
    },
  ],
};


/** Add a passkey: make one with a fingerprint, confirm an admin action with it, and sign in with it */
const passkey: Show = {
  id: "passkey",
  title: "Add a passkey",
  blurb: "Your fingerprint or face, for confirming and signing in",
  who: MARIA,
  path: HOME,
  end: "A passkey: no codes to wait for, and nothing to phish.",
  sections: [
    {
      id: "passkey-add",
      title: "Make a passkey",
      run: async (s) => {
        pretendPasskeys();
        await s.say("Maria adds a passkey from her profile");
        await s.think("Pradeep said a passkey makes confirming things quicker. Let me add one.");
        await profile(s, "#security");
        await s.think("A passkey uses my fingerprint. Add.");
        await s.click({ sel: "#security li button", text: "Add" }, 900);
        await s.say("Her computer asks for her fingerprint; the passkey stays on the device");
        await s.think("My laptop wants my fingerprint. Continue.");
        await s.click(".live-sheet .sh-yes", 1400);
        await s.think("Added. It's on now.");
        await s.hover({ sel: "#security li", text: "Passkey" }, 900);
        await s.say("A security email tells her, in case it wasn't her");
        const mail = await openMail(s);
        try {
          await s.think("And an email about it, in case it wasn't me. Good to know.");
          await read(s, mail, "passkey was added");
          await s.wait(1200);
        } finally {
          await mail.close();
        }
      },
    },
    {
      id: "passkey-confirm",
      title: "Confirm it's you",
      run: async (s) => {
        pretendPasskeys();
        await s.say("Inviting someone is an admin action, so 1NEON asks her to confirm it's her");
        await s.think("Now let me invite Sam.");
        await inviteSam(s);
        await s.waitFor(CONFIRM);
        await s.think("It wants me to confirm it's me. That's what the passkey is for.");
        await s.click({ sel: "dialog[open] button", text: "Use my passkey" }, 900);
        await s.think("Fingerprint again. Continue.");
        await s.click(".live-sheet .sh-yes", 1200);
        await s.think("Confirmed. Now send it again.");
        await sendAgain(s);
      },
    },
    {
      id: "passkey-signin",
      title: "Sign in with it",
      run: async (s) => {
        pretendPasskeys();
        await s.say("Next time she signs in, the passkey replaces the emailed code");
        await s.think("Let me see how signing in works now.");
        await profile(s);
        await s.click({ sel: "button", text: "Sign out" }, 1400);
        await s.type("#email", MARIA, 300);
        await s.click({ sel: "form button", text: "Continue" }, 900);
        await s.think("It offers my passkey first.");
        await s.click({ sel: "button", text: "Use my passkey" }, 900);
        await s.click(".live-sheet .sh-yes", 1600);
        await s.think("In. No code to wait for. Nice.");
        await s.hover({ sel: "h2.section-h", text: "Needs you" }, 1200);
      },
    },
  ],
};


/** Add an authenticator app: scan the QR code with a phone, type its code, then confirm with it */
const authenticator: Show = {
  id: "authenticator",
  title: "Add an authenticator app",
  blurb: "A 6-digit code from an app on your phone",
  who: MARIA,
  path: HOME,
  end: "An authenticator app: a fresh code every 30 seconds, even offline.",
  sections: [
    {
      id: "totp-scan",
      title: "Scan the code",
      run: async (s) => {
        await s.say("Maria sets up an authenticator app from her profile");
        await s.think("I already use an authenticator app on my phone. Let me add 1NEON to it.");
        await profile(s, "#security");
        await s.click({ sel: "#security li button", text: "Set up" }, 1000);
        await s.waitFor({ sel: "dialog[open] img" }, 6000);
        await s.say("A QR code to scan, or a key to type");
        const ph = new Phone();
        try {
          ph.scanner();
          await s.think("A QR code. Let me scan it with my phone.");
          await s.click(".live-phone .ph-btn", 700);
          ph.camera();
          await s.hover({ sel: "dialog[open] img" }, 1200);
          const key = (document.querySelector("dialog[open] code.key")?.textContent ?? "").replace(/\s/g, "");
          ph.authenticator(key, MARIA);
          await s.think("Scanned. neon1 is in the app now.");
          await s.hover(".live-phone .ph-code", 1200);
          await s.say("She types the code the app shows");
          const code = ph.code();
          await s.think(`It shows ${code}. A new one every 30 seconds.`);
          await putDown(ph);
          await s.type('dialog[open] input[aria-label="6-digit code"]', code, 400);
          await s.click({ sel: "dialog[open] button", text: "Turn on" }, 1400);
          await s.think("On. Now any admin step can ask for that code.");
          await s.hover({ sel: "#security li", text: "Authenticator app" }, 900);
        } finally {
          await ph.close();
        }
      },
    },
    {
      id: "totp-confirm",
      title: "Confirm it's you",
      run: async (s) => {
        // Setting the app up confirmed her for the day; this is the next day, when it has run out
        await (await engine()).nextDay();
        await s.say("The next day: inviting someone is an admin action, so 1NEON asks her to confirm it's her");
        await s.think("Now let me invite Sam.");
        await inviteSam(s);
        await s.waitFor(CONFIRM);
        const ph = new Phone();
        try {
          const key = await totpKey();
          ph.authenticator(key, MARIA);
          await s.think("It wants a code from my authenticator app.");
          await s.hover(".live-phone .ph-code", 1000);
          const code = ph.code();
          await putDown(ph);
          await s.type('dialog[open] input[aria-label="Code from your authenticator app"]', code, 400);
          await s.click({ sel: "dialog[open] button", text: "Confirm" }, 1000);
        } finally {
          await ph.close();
        }
        await s.think("Confirmed. Now send it again.");
        await sendAgain(s);
      },
    },
  ],
};

// The authenticator's key, read from the in-browser API's own record (as Maria's phone holds it)
async function totpKey() {
  const e = await engine();
  const row = (e.snapshot().rows as { PK: string; SK: string; secret?: string; confirmed?: boolean }[]).find((r) => r.SK === "TOTP" && r.confirmed);
  return row?.secret ?? "";
}


/** Texts: add a number, prove it with a code, choose what texts you, and use text codes to confirm */
const texts: Show = {
  id: "texts",
  title: "Texts and text codes",
  blurb: "Notices by text, and a texted code to confirm it's you",
  who: MARIA,
  path: HOME,
  end: "Texts for what matters to her, and a texted code whenever 1NEON asks.",
  sections: [
    {
      id: "texts-number",
      title: "Add your number",
      run: async (s) => {
        await s.say("Maria adds her mobile number and agrees to texts");
        await s.think("I'm on my feet all day. Texts would reach me faster than email.");
        await profile(s);
        await s.type("#ph", MOBILE, 300);
        await s.hover("#notifications .sms-consent", 900);
        await s.think("Texts are optional, and I can reply STOP anytime. Yes.");
        await s.click("#notifications .sms-consent input", 500);
        await s.click({ sel: "button", text: /^Save$/ }, 1200);
        await s.say("A texted code proves the number is hers");
        await s.think("It wants to make sure the number's mine.");
        await s.click({ sel: "button", text: "Text me a code" }, 900);
        const ph = new Phone();
        try {
          ph.messages(TEXTS_FROM, [await lastText()]);
          await s.think("There's the text.");
          await s.hover(".live-phone .ph-msg", 1200);
          const code = /(\d{6})/.exec(await lastText())?.[1] ?? "";
          await putDown(ph);
          await s.type("#smscode", code, 400);
          await s.click({ sel: "button", text: "Confirm" }, 1200);
        } finally {
          await ph.close();
        }
        await s.think("Confirmed. Texts are on for this number.");
        await s.hover("#notifications [role=status]", 900);
      },
    },
    {
      id: "texts-choose",
      title: "Choose what texts you",
      run: async (s) => {
        await s.say("She picks which notices also come by text");
        await profile(s, "#notifications .notify-table");
        await s.think("Decisions and files matter most. Text me those.");
        await s.click('input[aria-label="Text me: Decisions and options"]', 500);
        await s.click('input[aria-label="Text me: Files"]', 500);
        await s.click({ sel: "button", text: /^Save$/ }, 1200);
        await s.think("The texts only say something's new. The details stay in 1NEON.");
        await s.wait(900);
      },
    },
    {
      id: "texts-factor",
      title: "Text codes to confirm",
      run: async (s) => {
        await s.say("Text codes can also confirm it's her, like a passkey or an authenticator app");
        await profile(s, "#security");
        await s.think("I can use texted codes for the extra check, too. Turn on.");
        await s.click({ sel: "#security li button", text: "Turn on" }, 1200);
        await s.think("Now let me invite Sam.");
        await inviteSam(s);
        await s.waitFor(CONFIRM);
        await s.think("It wants me to confirm. I'll get a text.");
        await s.click({ sel: "dialog[open] button", text: "Text me a code" }, 900);
        const ph = new Phone();
        try {
          ph.messages(TEXTS_FROM, (await engine()).textsSent().map((t) => t.body));
          await s.hover(".live-phone .ph-msg:last-child", 1200);
          const code = /(\d{6})/.exec(await lastText())?.[1] ?? "";
          await s.think(`${code}. Got it.`);
          await putDown(ph);
          await s.type('dialog[open] input[aria-label="Code from the text"]', code, 400);
          await s.click({ sel: "dialog[open] form button", text: "Confirm" }, 1000);
        } finally {
          await ph.close();
        }
        await s.think("Confirmed. Now send it again.");
        await sendAgain(s);
      },
    },
  ],
};


/** Every short demo, in menu order */
export const SHORTS: Show[] = [invite, passkey, authenticator, texts];
