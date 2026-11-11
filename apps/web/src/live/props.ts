// apps/web/src/live/props.ts - The pretend world around the portal that the short demos need: Maria's
// mail, her phone (an authenticator app and her texts), and the browser's own passkey prompt. Each
// is a plain window drawn over the portal, filled with what 1NEON really sent: the emails come from
// the in-browser API's outbox, rendered from the same templates real mail uses.


import * as OTPAuth from "otpauth";


// --- Mail ---------------------------------------------------------------------------


/** One message in the pretend inbox */
export interface Mail { to: string; subject: string; text: string; html: string; at: number }

// Who 1NEON's mail is from, as a mail app would show it
const FROM = "neon1";
const FROM_ADDR = "notify@notify.neon1.tech";

/** A short "time ago" for the message list */
const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

/**
 * Maria's mail app: the message list on the left, the open message on the right (one at a time on a
 * phone). The message body sits in a shadow root, so the email's own inline styles show exactly as
 * sent and nothing from the portal leaks in.
 */
export class MailWindow {
  readonly el: HTMLDivElement;
  private list: HTMLUListElement;
  private pane: HTMLDivElement;
  private body: ShadowRoot;
  private mails: Mail[] = [];
  constructor(private owner: string) {
    this.el = document.createElement("div");
    this.el.className = "live-prop live-mail";
    this.el.setAttribute("aria-label", "Maria's email (part of the demo)");
    this.el.innerHTML = `
      <div class="mail-top"><span class="mail-dots"><i></i><i></i><i></i></span><b>Mail</b><span class="mail-me"></span></div>
      <div class="mail-cols">
        <aside><p class="mail-h">Inbox</p><ul></ul></aside>
        <article class="mail-read"><div class="mail-empty">No message selected</div></article>
      </div>`;
    this.el.querySelector(".mail-me")!.textContent = owner;
    this.list = this.el.querySelector("ul")!;
    this.pane = this.el.querySelector(".mail-read")!;
    const host = document.createElement("div");
    host.className = "mail-body";
    this.body = host.attachShadow({ mode: "open" });
    this.pane.append(host);
    document.body.append(this.el);
    requestAnimationFrame(() => this.el.classList.add("on"));
  }
  /** Show these messages, newest first; unread ones in bold */
  fill(mails: Mail[]) {
    this.mails = mails.filter((m) => m.to === this.owner).sort((a, b) => b.at - a.at);
    this.list.replaceChildren(...this.mails.map((m, i) => {
      const li = document.createElement("li");
      li.className = "mail-row unread";
      li.dataset.i = String(i);
      const preview = m.text.split("\n").find((l) => l.trim()) ?? "";
      li.innerHTML = `<b class="mail-from"></b><span class="mail-when"></span><span class="mail-subj"></span><span class="mail-prev"></span>`;
      li.querySelector(".mail-from")!.textContent = FROM;
      li.querySelector(".mail-when")!.textContent = ago(m.at);
      li.querySelector(".mail-subj")!.textContent = m.subject;
      li.querySelector(".mail-prev")!.textContent = preview;
      // A real click works too, when someone pauses and explores
      li.addEventListener("click", () => this.open(i));
      return li;
    }));
  }
  /** The list row for a subject, for the cursor to click */
  row(subject: string | RegExp) {
    return [...this.list.querySelectorAll<HTMLLIElement>(".mail-row")].find((li) => {
      const s = li.querySelector(".mail-subj")!.textContent ?? "";
      return typeof subject === "string" ? s.includes(subject) : subject.test(s);
    });
  }
  /** Open message i in the reading pane */
  open(i: number) {
    const m = this.mails[i];
    if (!m) return;
    for (const li of this.list.children) li.classList.toggle("on", (li as HTMLElement).dataset.i === String(i));
    this.list.children[i]?.classList.remove("unread");
    this.pane.querySelector(".mail-empty")?.remove();
    this.pane.querySelector(".mail-head")?.remove();
    const head = document.createElement("header");
    head.className = "mail-head";
    head.innerHTML = `<h3></h3><p><b></b> <span></span></p><p class="mail-to"></p>`;
    head.querySelector("h3")!.textContent = m.subject;
    head.querySelector("b")!.textContent = FROM;
    head.querySelector("span")!.textContent = `<${FROM_ADDR}>`;
    head.querySelector(".mail-to")!.textContent = `to ${m.to}`;
    this.pane.prepend(head);
    // Our own template's HTML; links don't navigate (the demo follows them itself). The page's
    // policy blocks inline style attributes, so each is moved onto the element through the
    // style object instead, which the policy allows, and the email looks as it would in a mail app
    const doc = new DOMParser().parseFromString(m.html, "text/html");
    const styled = [...doc.body.querySelectorAll<HTMLElement>("[style]")].map((el) => {
      const css = el.getAttribute("style") ?? "";
      el.removeAttribute("style");
      return [el, css] as const;
    });
    this.body.replaceChildren(...doc.body.childNodes);
    for (const [el, css] of styled) el.style.cssText = css;
    for (const a of this.body.querySelectorAll("a")) a.addEventListener("click", (e) => e.preventDefault());
    this.el.classList.add("reading");
  }
  /** A link in the open message, by its words */
  link(words: string) {
    return [...this.body.querySelectorAll<HTMLAnchorElement>("a")].find((a) => (a.textContent ?? "").includes(words));
  }
  /** The big code in the open message, if it has one */
  code() {
    const big = [...this.body.querySelectorAll<HTMLElement>("span")].find((s) => /^\d{6,8}$/.test((s.textContent ?? "").trim()));
    return big ? { el: big, value: big.textContent!.trim() } : undefined;
  }
  /** Back to the list (phones show one or the other) */
  back() {
    this.el.classList.remove("reading");
  }
  /** Put the mail app away */
  async close() {
    this.el.classList.remove("on");
    await new Promise((r) => setTimeout(r, 260));
    this.el.remove();
  }
}


// --- The phone ------------------------------------------------------------------------


/**
 * Maria's phone, at the side of the screen (sliding up over the page on a phone-sized screen): an
 * authenticator app that shows the real current code for a key, or her text messages.
 */
export class Phone {
  readonly el: HTMLDivElement;
  private screen: HTMLDivElement;
  private timer?: number;
  constructor() {
    this.el = document.createElement("div");
    this.el.className = "live-prop live-phone";
    this.el.setAttribute("aria-label", "Maria's phone (part of the demo)");
    this.el.innerHTML = `<div class="ph-notch"></div><div class="ph-screen"></div>`;
    this.screen = this.el.querySelector(".ph-screen")!;
    document.body.append(this.el);
    requestAnimationFrame(() => this.el.classList.add("on"));
  }
  /** The authenticator app before anything is added: a button to scan */
  scanner() {
    clearInterval(this.timer);
    this.screen.innerHTML = `<div class="ph-app"><p class="ph-title">Authenticator</p><div class="ph-empty"><span>No accounts yet</span><button type="button" class="ph-btn">Scan a QR code</button></div></div>`;
  }
  /** The camera, aimed at the QR code on screen */
  camera() {
    this.screen.innerHTML = `<div class="ph-cam"><div class="ph-frame"><i></i><i></i><i></i><i></i></div><p>Point at the QR code</p></div>`;
  }
  /** The account added: its code now, and a ring that empties as the 30 seconds run out */
  authenticator(secret: string, label: string) {
    const totp = new OTPAuth.TOTP({ issuer: "neon1", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
    this.screen.innerHTML = `<div class="ph-app"><p class="ph-title">Authenticator</p><div class="ph-acct"><span class="ph-iss">neon1</span><span class="ph-lbl"></span><span class="ph-code"></span><span class="ph-ring"></span></div></div>`;
    this.screen.querySelector(".ph-lbl")!.textContent = label;
    const tickNow = () => {
      const code = totp.generate();
      this.screen.querySelector(".ph-code")!.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
      const left = 30 - (Math.floor(Date.now() / 1000) % 30);
      (this.screen.querySelector(".ph-ring") as HTMLElement).style.setProperty("--left", String(left / 30));
    };
    tickNow();
    clearInterval(this.timer);
    this.timer = window.setInterval(tickNow, 1000);
  }
  /** The code the app shows right now, digits only */
  code() {
    return (this.screen.querySelector(".ph-code")?.textContent ?? "").replace(/\D/g, "");
  }
  /** The code's element, for the cursor to look at */
  codeEl() {
    return this.screen.querySelector<HTMLElement>(".ph-code, .ph-msg:last-child");
  }
  /** Her texts from 1NEON's number, newest last */
  messages(from: string, bodies: string[]) {
    clearInterval(this.timer);
    this.screen.innerHTML = `<div class="ph-app"><p class="ph-title ph-thread"></p><div class="ph-msgs"></div></div>`;
    this.screen.querySelector(".ph-thread")!.textContent = from;
    const box = this.screen.querySelector(".ph-msgs")!;
    for (const b of bodies) {
      const m = document.createElement("p");
      m.className = "ph-msg";
      m.textContent = b;
      box.append(m);
    }
  }
  /** Put the phone down */
  async close() {
    clearInterval(this.timer);
    this.el.classList.remove("on");
    await new Promise((r) => setTimeout(r, 260));
    this.el.remove();
  }
}


// --- The browser's passkey prompt ------------------------------------------------------------


/**
 * Stands in for the prompt a browser shows for passkeys (Touch ID, Face ID, Windows Hello). While a
 * short demo runs, the browser's real passkey calls come here instead, so nothing on this device is
 * touched: the page asks, this sheet appears, and Continue answers with a made-up passkey.
 */
export function fakePasskeys(email: string) {
  // Some browsers have no passkey support at all here (an in-app browser, a page that isn't secure):
  // the demo brings its own stand-in, so it plays the same everywhere, and takes it away again after
  const missing = !navigator.credentials;
  if (missing) Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: async () => null, get: async () => null } });
  const real = { create: navigator.credentials.create.bind(navigator.credentials), get: navigator.credentials.get.bind(navigator.credentials) };
  const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
  // Show the sheet and wait for Continue or Cancel
  const ask = (making: boolean) => new Promise<boolean>((done) => {
    const el = document.createElement("div");
    el.className = "live-prop live-sheet";
    el.innerHTML = `<div class="sh-card" role="dialog" aria-label="Passkey prompt (part of the demo)">
      <svg class="sh-key" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a5 5 0 0 0-5 5v2M17 10V8a5 5 0 0 0-1.5-3.6M8.5 21c-1-1.8-1.5-3.9-1.5-6M12 21c-.7-1.9-1-3.9-1-6a1 1 0 0 1 2 0c0 2.1.4 4 1.2 5.8M15.5 20c.3-1.6.5-3.3.5-5a4 4 0 0 0-8 0"/></svg>
      <p class="sh-h"></p><p class="sh-who"></p><p class="sh-note"></p>
      <div class="sh-acts"><button type="button" class="sh-no">Cancel</button><button type="button" class="sh-yes">Continue</button></div></div>`;
    el.querySelector(".sh-h")!.textContent = making ? "Create a passkey for neon1.tech" : "Sign in to neon1.tech";
    el.querySelector(".sh-who")!.textContent = email;
    el.querySelector(".sh-note")!.textContent = making ? "Your fingerprint, face, or device PIN will unlock it. Nothing about it leaves this device." : "Use your fingerprint, face, or device PIN.";
    const end = (yes: boolean) => { el.classList.remove("on"); setTimeout(() => el.remove(), 220); done(yes); };
    el.querySelector(".sh-yes")!.addEventListener("click", () => end(true));
    el.querySelector(".sh-no")!.addEventListener("click", () => end(false));
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("on"));
  });
  // A made-up credential, shaped like the browser's own
  const credential = (making: boolean) => ({
    id: "bGl2ZS1wYXNza2V5", rawId: bytes("live-passkey"), type: "public-key", authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({}),
    response: making
      ? { clientDataJSON: bytes("{}"), attestationObject: bytes("live"), getTransports: () => ["internal"] }
      : { clientDataJSON: bytes("{}"), authenticatorData: bytes("live"), signature: bytes("live"), userHandle: bytes("maria") },
  });
  const swap = (making: boolean) => async () => {
    if (!(await ask(making))) throw new DOMException("The prompt was cancelled", "NotAllowedError");
    return credential(making) as unknown as Credential;
  };
  navigator.credentials.create = swap(true);
  navigator.credentials.get = swap(false);
  /** Put the browser's own passkey calls back */
  return () => {
    if (missing) return void delete (navigator as { credentials?: unknown }).credentials;
    navigator.credentials.create = real.create;
    navigator.credentials.get = real.get;
  };
}
