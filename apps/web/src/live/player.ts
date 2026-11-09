// apps/web/src/live/player.ts - The live playback's engine: a cursor that moves, hovers, clicks,
// drags, and types on the real portal, Maria's thoughts riding beside it, and a player that runs a
// show section by section. Every step checks for pause and for a jump, so Back, Next, and the
// section list cut cleanly, and a stumble recovers on its own before it ever asks for a choice.


import { devUser, liveEngine } from "../lib/api.ts";
import { clearCache, navigate, refreshAll } from "../lib/nav.ts";
import { SHORTS } from "./shorts.ts";
import { PLAY, PROJECT, remember } from "./where.ts";


/** One major section of a show */
export interface Section {
  id: string;
  title: string;
  run: (s: Stage) => Promise<void>;
}

/** A show: the whole project, or a short demo of one thing. Shorts can start signed in, on a page */
export interface Show {
  id: string;
  title: string;
  /** One line for the menu */
  blurb: string;
  sections: Section[];
  /** Who is signed in at the start ("" for the sign-in screen), and the page it starts on */
  who?: string;
  path?: string;
  /** Said when it ends */
  end?: string;
}

/** What the controls show */
export interface View {
  index: number;
  title: string;
  caption: string;
  progress: number;
  paused: boolean;
  skipping: boolean;
  done: boolean;
}


// Thrown through a running section when someone jumps elsewhere; never shown
class Cut extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
// Smooth start and stop for every movement
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Reduced motion: the cursor still shows where things happen, but it steps instead of gliding
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;


/** Is this element on screen and not hidden? */
function visible(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
}


/** A target: a CSS selector, optionally narrowed to elements whose text includes some words, or a
 * function that finds the element itself (for things inside a pretend email) */
export type Target = string | { sel: string; text?: string | RegExp; within?: string; nth?: number } | (() => HTMLElement | null | undefined);

/** The first visible element matching a target, or undefined */
export function find(t: Target): HTMLElement | undefined {
  if (typeof t === "function") {
    const el = t();
    return el && visible(el) ? el : undefined;
  }
  const spec = typeof t === "string" ? { sel: t } : t;
  const root = spec.within ? document.querySelector(spec.within) ?? document : document;
  const all = [...root.querySelectorAll<HTMLElement>(spec.sel)].filter(visible).filter((el) => {
    if (spec.text === undefined) return true;
    const words = (el.innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).value || "").trim();
    return typeof spec.text === "string" ? words.toLowerCase().includes(spec.text.toLowerCase()) : spec.text.test(words);
  });
  return all[spec.nth ?? 0];
}


// --- Maria's thoughts ------------------------------------------------------------


/**
 * A thought bubble that rides below and to the right of the cursor, a little apart from it, so the
 * eye can follow the cursor and read at once. Near the right edge it slides left to stay on screen;
 * near the bottom it moves above the cursor. Screen readers hear each new thought.
 */
class Thought {
  readonly el: HTMLDivElement;
  private txt: HTMLSpanElement;
  private w = 0;
  private h = 0;
  private barBottom = 0;
  private on = false;
  constructor(who: string) {
    this.el = document.createElement("div");
    this.el.className = "live-think";
    this.el.setAttribute("role", "status");
    this.el.innerHTML = `<i class="dot d1"></i><i class="dot d2"></i><span class="who"></span><span class="txt"></span>`;
    this.el.querySelector(".who")!.textContent = who;
    this.txt = this.el.querySelector(".txt")!;
    document.body.append(this.el);
    addEventListener("resize", () => this.measure());
  }
  // Size and the controls' bottom edge, read once per change rather than on every frame
  private measure() {
    const r = this.el.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.barBottom = document.querySelector(".live-bar")?.getBoundingClientRect().bottom ?? 0;
  }
  /** Show a new thought; it fades in, and the old one is gone */
  say(text: string, x: number, y: number) {
    this.txt.textContent = text;
    this.el.classList.remove("fresh");
    void this.el.offsetWidth;
    this.el.classList.add("on", "fresh");
    this.on = true;
    this.measure();
    this.place(x, y);
  }
  /** Fade away until the next thought */
  clear() {
    this.on = false;
    this.el.classList.remove("on");
  }
  /** Follow the cursor tip at (x, y) */
  place(x: number, y: number) {
    if (!this.on) return;
    const m = 10;
    // Below and to the right, clear of the arrow's own box (about 20 by 26)
    let left = x + 22, top = y + 30, below = true;
    // Slide left as the cursor nears the right edge, never past the left one
    left = Math.max(m, Math.min(left, innerWidth - m - this.w));
    // No room below: sit above the cursor instead, unless that runs under the controls
    if (top + this.h > innerHeight - m && y - 14 - this.h > this.barBottom + m) { top = y - 14 - this.h; below = false; }
    // The two small circles lead from the bubble back toward the cursor tip
    const tail = Math.max(14, Math.min(this.w - 18, x - left + 6));
    this.el.style.transform = `translate(${left}px, ${top}px)`;
    this.el.style.setProperty("--tail", `${tail}px`);
    this.el.dataset.side = below ? "below" : "above";
  }
}


// --- The cursor --------------------------------------------------------------------


/** The on-screen cursor: an arrow, a pointing hand, an I-beam, or a closed hand while dragging */
class Cursor {
  readonly el: HTMLDivElement;
  readonly thought: Thought;
  x = innerWidth / 2;
  y = innerHeight / 2;
  constructor() {
    this.el = document.createElement("div");
    this.el.className = "live-cursor";
    this.el.setAttribute("aria-hidden", "true");
    this.el.innerHTML = `
      <svg class="c-arrow" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.6 L14.4 20.4 L11.3 13.7 L17.5 13.7 Z"/></svg>
      <svg class="c-hand" viewBox="0 0 24 24"><path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5c0 3.6-2.4 6.5-6 6.5h-1.2c-1.9 0-3.3-.8-4.4-2.3L3.6 14.6a1.5 1.5 0 0 1 2.4-1.8L8 15.2V11"/></svg>
      <svg class="c-beam" viewBox="0 0 24 24"><path d="M9 3h2.5a1.5 1.5 0 0 1 1.5 1.5V19.5A1.5 1.5 0 0 1 11.5 21H9m6-18h-2.5A1.5 1.5 0 0 0 11 4.5v15a1.5 1.5 0 0 0 1.5 1.5H15"/></svg>
      <svg class="c-grab" viewBox="0 0 24 24"><path d="M8 12V9.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0v4c0 3.6-2.4 6.5-6 6.5h-1c-2 0-3.5-1-4.5-2.6L5 16a1.5 1.5 0 0 1 2.6-1.5L8 15"/></svg>
      <span class="c-ring"></span>`;
    document.body.append(this.el);
    this.thought = new Thought("Maria");
    this.place();
  }
  // Draw at the current point, the thought alongside
  place() {
    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    this.thought.place(this.x, this.y);
  }
  // The cursor's look, matched to what's under it, as a browser would
  shape(kind: "arrow" | "hand" | "beam" | "grab") {
    this.el.dataset.shape = kind;
  }
  // A click: a quick press and a ring
  press() {
    this.el.classList.remove("pressing");
    void this.el.offsetWidth;
    this.el.classList.add("pressing");
  }
  // Hidden while catching up; the thought goes with it
  hide(h: boolean) {
    this.el.classList.toggle("gone", h);
    this.thought.el.classList.toggle("gone", h);
  }
}


/** The shape a real browser would show over this element */
function shapeFor(el: Element): "arrow" | "hand" | "beam" {
  const editable = el.closest("input:not([type=checkbox]):not([type=radio]):not([type=date]), textarea, [contenteditable=true]");
  if (editable) return "beam";
  return el.closest("a, button, label, summary, select, [role=button], [role=tab], [role=radio], [role=switch], input[type=checkbox], input[type=radio], input[type=date]") ? "hand" : "arrow";
}


/** Anything a cut section might leave on screen: lifted cards, pretend windows, hovers, open dialogs */
function tidy() {
  for (const el of document.querySelectorAll(".live-ghost, .live-desk-file, .live-pop, .live-prop")) el.remove();
  for (const el of document.querySelectorAll(".live-lifted, .live-target, .vhover")) el.classList.remove("live-lifted", "live-target", "vhover");
  for (const d of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) d.close();
}


// --- The player --------------------------------------------------------------------


/** The player: sections in order, the current one running, snapshots at each section's start */
export class Player {
  /** The show playing: the whole project, or the short demo the link asked for */
  readonly show: Show;
  private cursor?: Cursor;
  private token = { cut: false };
  // The run in progress; a jump waits for it to stop before touching the data, so runs never overlap
  private running?: Promise<void>;
  // Each section's start: the data, the page, and who was signed in. Section 0 is set at start
  // from the seed, never from wherever the address happened to be
  private snaps = new Map<number, { data: unknown; path: string; who: string }>();
  // Stumbles per section since the last choice made by hand, for the recovery ladder in runFrom
  private stumbles = new Map<number, number>();
  // Someone clicked around the portal while paused; resuming starts the section over, cleanly
  private touched = false;
  // Where the first section starts, from the link
  private first = 0;
  /** How fast it plays: 1 is the calm default, 0.5 half as fast, 2 twice as fast */
  speed = (() => { try { return Number(localStorage.getItem("1neon.liveSpeed")) || 1; } catch { return 1; } })();
  private listeners = new Set<(v: View) => void>();
  private steps = 0;
  private est = new Map<number, number>();
  private hovered: Element[] = [];
  // The last thought and when it appeared, so the next one waits until it can have been read
  private lastThought = { at: 0, read: 0 };
  view: View;
  fast = false;

  constructor(project: Section[]) {
    const short = SHORTS.find((s) => s.id === PLAY.show);
    this.show = short ?? { id: PROJECT, title: "A whole project", blurb: "From a first sign-in to ongoing care", sections: project, end: "That's a whole project, start to finish." };
    // A section named in the link (or saved by a refresh) starts there, catching up on the way
    this.first = Math.max(0, this.show.sections.findIndex((s) => s.id === PLAY.at));
    this.view = { index: this.first, title: this.sections[this.first]!.title, caption: "", progress: 0, paused: false, skipping: false, done: false };
  }

  /** The sections of the show playing */
  get sections() {
    return this.show.sections;
  }

  // Before a section has run once, guess its length from the steps written in it (loops count once)
  guess(i: number) {
    return Math.max(3, (this.sections[i]!.run.toString().match(/\.(click|type|hover|choose|drag|go)\(/g) ?? []).length);
  }

  // --- Controls -------------------------------------------------------------

  /** Listen for changes to what the controls show */
  subscribe(fn: (v: View) => void) {
    this.listeners.add(fn);
    fn(this.view);
    return () => void this.listeners.delete(fn);
  }
  private emit(patch: Partial<View>) {
    this.view = { ...this.view, ...patch };
    for (const fn of this.listeners) fn(this.view);
  }

  /** Start: the seed as the first section's start, on the show's own first page, then play */
  async start() {
    this.cursor ??= new Cursor();
    // Clicks in the portal while paused mean someone explored; note it for resuming
    document.addEventListener("pointerdown", (e) => {
      if (this.view.paused && (e.target as Element).closest("#root")) this.touched = true;
    }, true);
    const engine = await liveEngine();
    if (!engine) return;
    // The address may be anywhere (a refresh deep in the story); the first section always starts
    // from the seed, as the show's first person, on its first page
    await engine.whenReady();
    this.snaps.set(0, { data: engine.snapshot(), path: this.show.path ?? "/", who: this.show.who ?? "" });
    void this.goTo(this.first, true);
  }
  pause() {
    this.emit({ paused: true });
  }
  resume() {
    // Finished, or the page was changed by hand while paused: play this section again from its start
    if (this.view.done) return void this.goTo(0);
    if (this.touched) { this.touched = false; return void this.goTo(this.view.index); }
    this.emit({ paused: false });
  }
  /** Change the speed; it applies from the next movement */
  setSpeed(v: number) {
    this.speed = Math.min(2, Math.max(0.5, v));
    try { localStorage.setItem("1neon.liveSpeed", String(this.speed)); } catch { /* private mode */ }
  }
  // Today's movements were tuned at 1.5x of the calm default; every duration scales from there
  private pace(ms: number) {
    return (ms * 1.5) / this.speed;
  }
  toggle() {
    if (this.view.paused || this.view.done) this.resume();
    else this.pause();
  }

  /**
   * Jump to a section: back to its saved start if it's been reached, otherwise fast through the ones
   * before it. A jump by hand forgets earlier stumbles; `auto` marks the player's own retries
   */
  async goTo(i: number, auto = false) {
    if (i < 0 || i >= this.sections.length) return;
    this.token.cut = true;
    const token = (this.token = { cut: false });
    const prev = this.running;
    this.touched = false;
    if (!auto) this.stumbles.clear();
    this.running = (async () => {
      await prev?.catch(() => undefined);
      if (!token.cut) await this.runFrom(i, token);
    })();
  }

  // --- Running --------------------------------------------------------------

  // Run section i and everything after it; earlier unreached sections run fast first
  private async runFrom(i: number, token: { cut: boolean }) {
    let current = i;
    const engine = await liveEngine();
    if (!engine) return;
    // The nearest saved start at or before i; section 0's always exists
    let from = i;
    while (from > 0 && !this.snaps.has(from)) from--;
    await this.restore(this.snaps.get(from)!);
    try {
      // Sections between the saved start and the target run fast, cursor hidden
      if (from < i) {
        this.fast = true;
        this.cursor?.hide(true);
        this.emit({ skipping: true, paused: false, done: false, index: i, title: this.sections[i]!.title, caption: "Catching up…", progress: 0 });
        for (let k = from; k < i; k++) {
          current = k;
          this.save(k, engine);
          await this.sections[k]!.run(this.stage(token));
        }
        this.fast = false;
        this.cursor?.hide(false);
      }
      // Then play from i to the end at watching speed
      for (let k = i; k < this.sections.length; k++) {
        current = k;
        this.save(k, engine);
        this.steps = 0;
        remember({ show: this.show.id as never, at: this.sections[k]!.id });
        this.emit({ index: k, title: this.sections[k]!.title, caption: "", progress: 0, skipping: false, done: false, paused: false });
        await this.sections[k]!.run(this.stage(token));
        this.stumbles.delete(k);
        this.est.set(k, this.steps);
        this.emit({ progress: 1 });
        if (k < this.sections.length - 1) await this.stage(token).wait(900);
      }
      this.unhover();
      await sleep(1600);
      this.cursor?.thought.clear();
      this.emit({ done: true, paused: true, caption: this.show.end ?? "That's the whole of it." });
    } catch (e) {
      // A jump cuts the running section; anything else is a real problem worth seeing in the console
      this.fast = false;
      this.cursor?.hide(false);
      if (e instanceof Cut || token.cut) return;
      console.error(e);
      // The recovery ladder: restart the section from its saved start; then rebuild everything from
      // the seed and catch up to it (a saved start can itself be wrong); only then ask for a choice
      const n = (this.stumbles.get(current) ?? 0) + 1;
      this.stumbles.set(current, n);
      if (n === 1) {
        this.emit({ caption: "One moment…" });
        void this.goTo(current, true);
      } else if (n === 2) {
        this.emit({ caption: "One moment…" });
        for (const k of [...this.snaps.keys()]) if (k > 0) this.snaps.delete(k);
        void this.goTo(current, true);
      } else {
        this.emit({ paused: true, skipping: false, caption: "Something went off script. Pick a section to carry on." });
      }
    }
  }

  // Save the data and the page at a section's start, the first time it's reached
  private save(k: number, engine: Awaited<ReturnType<typeof liveEngine>>) {
    if (!engine || this.snaps.has(k)) return;
    this.snaps.set(k, { data: engine.snapshot(), path: location.pathname.replace(/^\/1NEON\/live/, "") || "/", who: devUser.get() });
  }

  // Put the data back, then the page, then refetch what's shown
  private async restore(s: { data: unknown; path: string; who: string }) {
    const engine = await liveEngine();
    tidy();
    engine?.restore(s.data as never);
    // Whoever was signed in at that point is signed in again (nobody, at the very start)
    devUser.set(s.who);
    scrollTo({ top: 0 });
    this.unhover();
    clearCache();
    navigate(s.path);
    await sleep(300);
  }

  // Clear the pretend hover from wherever it was
  private unhover() {
    for (const el of this.hovered) el.classList.remove("vhover");
    this.hovered = [];
  }

  // --- The steps a section uses ---------------------------------------------

  /** The helpers bound to one run; each checks for a jump and waits while paused */
  stage(token: { cut: boolean }) {
    const p = this;
    // Between every small action: stop if cut, hold while paused
    const tick = async () => {
      if (token.cut) throw new Cut();
      while (p.view.paused && !token.cut) await sleep(120);
      if (token.cut) throw new Cut();
    };
    // Count a step toward this section's progress line
    const step = () => {
      p.steps++;
      const est = p.est.get(p.view.index) ?? p.guess(p.view.index);
      if (!p.fast) p.emit({ progress: Math.min(0.97, p.steps / est) });
    };
    const pause = async (ms: number) => {
      if (p.fast) return void (await frame());
      const end = performance.now() + p.pace(ms);
      while (performance.now() < end) {
        await tick();
        await sleep(Math.min(80, end - performance.now()));
      }
    };
    // Wait for a target to appear, up to a few seconds (the page may still be loading)
    const waitFor = async (t: Target, ms = 6000) => {
      const end = performance.now() + ms;
      for (;;) {
        await tick();
        const el = find(t);
        if (el) return el;
        if (performance.now() > end) throw new Error(`live: can't find ${typeof t === "function" ? "a target" : JSON.stringify(t)}`);
        await sleep(60);
      }
    };
    // Glide the cursor to a point; the distance sets the time, within limits. Reduced motion steps there
    const glide = async (x: number, y: number) => {
      const c = p.cursor!;
      if (p.fast || calm()) {
        c.x = x; c.y = y; c.place();
        if (!p.fast) await pause(220);
        return;
      }
      const sx = c.x, sy = c.y;
      const ms = p.pace(Math.max(280, Math.min(950, Math.hypot(x - sx, y - sy) * 1.1)));
      const t0 = performance.now();
      for (;;) {
        await tick();
        const t = Math.min(1, (performance.now() - t0) / ms);
        const k = ease(t);
        c.x = sx + (x - sx) * k;
        c.y = sy + (y - sy) * k;
        c.place();
        if (t >= 1) break;
        await frame();
      }
    };
    // Smooth scrolling unless catching up or reduced motion
    const how = (): ScrollBehavior => (p.fast || calm() ? "instant" : "smooth");
    // Mark what's under the cursor as hovered (the portal's hover styles mirror onto .vhover)
    const hoverAt = (el: Element) => {
      p.unhover();
      const chain = [el, el.closest("a, button, label, .item, .chip, .ptr, [role=tab]")].filter((x): x is Element => Boolean(x));
      for (const h of chain) h.classList.add("vhover");
      p.hovered = chain;
      p.cursor!.shape(shapeFor(el));
    };
    // Bring an element into view, then move onto it (a little off-center, as a hand would)
    const reach = async (el: HTMLElement) => {
      const r0 = el.getBoundingClientRect();
      const top = 70 + (document.querySelector(".live-bar")?.getBoundingClientRect().height ?? 0);
      if (r0.top < top || r0.bottom > innerHeight - 70) {
        el.scrollIntoView({ block: "center", behavior: how() });
        await pause(560);
      }
      const r = el.getBoundingClientRect();
      await glide(r.left + Math.min(r.width * 0.45, 24 + r.width * 0.2), r.top + r.height * 0.55);
      hoverAt(el);
    };

    return {
      fast: () => p.fast,
      /** Hold for a moment (skipped when catching up) */
      wait: async (ms: number) => { await pause(ms); },
      /** What's happening, shown in the controls */
      say: async (caption: string) => { await tick(); if (!p.fast) p.emit({ caption }); },
      /**
       * What Maria is thinking, beside the cursor. A new thought waits until the last one has been on
       * screen long enough to read, so quick actions never flash words past
       */
      think: async (text: string) => {
        await tick();
        if (p.fast) return;
        const left = p.lastThought.at + p.lastThought.read - performance.now();
        if (left > 0) await pause(left / p.pace(1));
        p.cursor!.thought.say(text, p.cursor!.x, p.cursor!.y);
        p.lastThought = { at: performance.now(), read: p.pace(450 + text.length * 22) };
      },
      /** Wait until something is on screen */
      waitFor,
      /** Move onto something and rest there */
      hover: async (t: Target, ms = 700) => { step(); const el = await waitFor(t); await reach(el); await pause(ms); },
      /** Move the cursor to a point on screen, without touching anything */
      point: async (x: number, y: number, ms = 400) => { await glide(x, y); await pause(ms); },
      /** Move onto something and click it */
      click: async (t: Target, after = 450) => {
        step();
        const el = await waitFor(t);
        await reach(el);
        await pause(150);
        p.cursor!.press();
        el.click();
        await pause(after);
      },
      /** Click into a field and type, one character at a time */
      type: async (t: Target, text: string, after = 300) => {
        step();
        const el = (await waitFor(t)) as HTMLInputElement | HTMLTextAreaElement;
        await reach(el);
        p.cursor!.press();
        el.focus();
        // React listens for native input events, so set the value through the element's own setter
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
        let now = el.value;
        for (const ch of p.fast ? [text] : [...text]) {
          await tick();
          now += ch;
          setter.call(el, now);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          if (!p.fast) await sleep(p.pace(ch === " " ? 75 : 40 + Math.random() * 32));
        }
        await pause(after);
      },
      /** Set a date or a select the way its picker would */
      choose: async (t: Target, value: string, after = 400) => {
        step();
        const el = (await waitFor(t)) as HTMLInputElement | HTMLSelectElement;
        await reach(el);
        p.cursor!.press();
        await pause(260);
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        await pause(after);
      },
      /** Press a key where the cursor typed; Enter in a form submits it, as a browser would */
      key: async (key: string, after = 500) => {
        await tick();
        const el = document.activeElement as HTMLElement | null;
        el?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        if (key === "Enter") (el?.closest("form") as HTMLFormElement | null)?.requestSubmit();
        await pause(after);
      },
      /** Drag one thing onto another: the cursor grabs, carries a ghost across, and lets go. Without a
       * drop function, the page gets the same drag events a real drag would send */
      drag: async (from: Target, to: Target, drop?: () => Promise<void>) => {
        step();
        const a = await waitFor(from);
        await reach(a);
        await pause(220);
        const r = a.getBoundingClientRect();
        const ghost = a.cloneNode(true) as HTMLElement;
        ghost.classList.add("live-ghost");
        Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
        if (!p.fast) document.body.append(ghost);
        a.classList.add("live-lifted");
        p.cursor!.shape("grab");
        try {
          // A real drag starts on the element itself, carrying its data
          const dt = new DataTransfer();
          if (!drop) a.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
          const b = await waitFor(to);
          b.scrollIntoView({ block: "nearest", inline: "center", behavior: how() });
          await pause(300);
          const rb = b.getBoundingClientRect();
          const ox = p.cursor!.x - r.left, oy = p.cursor!.y - r.top;
          const sx = p.cursor!.x, sy = p.cursor!.y;
          const tx = rb.left + Math.min(rb.width / 2, 70), ty = rb.top + 70;
          const ms = p.fast || calm() ? 0 : p.pace(1200);
          const t0 = performance.now();
          // Carry the ghost with the cursor, easing in and out, tilting a little mid-air
          for (;;) {
            await tick();
            const t = ms ? Math.min(1, (performance.now() - t0) / ms) : 1;
            const k = ease(t);
            p.cursor!.x = sx + (tx - sx) * k;
            p.cursor!.y = sy + (ty - sy) * k;
            p.cursor!.place();
            ghost.style.transform = `translate(${p.cursor!.x - ox - r.left}px, ${p.cursor!.y - oy - r.top}px) rotate(${2 * Math.sin(t * Math.PI)}deg)`;
            if (drop) b.classList.toggle("live-target", t > 0.4);
            // Whatever is under the cursor hears the drag passing over it
            else document.elementsFromPoint(p.cursor!.x, p.cursor!.y).find((el) => !el.closest(".live-shield, .live-ghost, .live-cursor, .live-think"))?.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
            if (t >= 1) break;
            await frame();
          }
          if (drop) await drop();
          else {
            b.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
            a.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
          }
          await refreshAll();
          await pause(400);
          b.classList.remove("live-target");
        } finally {
          // A cut mid-drag leaves nothing floating
          ghost.remove();
          a.classList.remove("live-lifted");
          p.cursor!.shape("arrow");
        }
        await pause(400);
      },
      /** Go somewhere: through a visible menu link when there is one, as a person would */
      go: async (path: string, label?: string) => {
        step();
        const link = label ? find({ sel: ".side a, .tabbar a", text: label }) : undefined;
        if (link && !p.fast) {
          await reach(link);
          await pause(150);
          p.cursor!.press();
          link.click();
        } else {
          navigate(path);
        }
        await pause(800);
      },
      /** Someone else does something in their own browser; everything on screen refreshes, and a
       * small note by the bell says who, so the other side of the work is easy to follow */
      others: async (fn: () => Promise<void>, after = 900, note?: string) => {
        await tick();
        await fn();
        await refreshAll();
        if (note && !p.fast) {
          const pop = document.createElement("div");
          pop.className = "live-pop";
          pop.textContent = note;
          document.body.append(pop);
          setTimeout(() => pop.remove(), 3600);
        }
        await pause(after);
      },
      /** Scroll the page by some amount, smoothly */
      scroll: async (dy: number, after = 600) => {
        await tick();
        scrollBy({ top: dy, behavior: how() });
        await pause(after);
      },
      /** Back to the top of the page */
      top: async () => {
        await tick();
        scrollTo({ top: 0, behavior: how() });
        await pause(450);
      },
      /** Sign in as someone without the sign-in screen (between scenes of a short demo) */
      signInAs: async (email: string) => {
        await tick();
        devUser.set(email);
        clearCache();
        await refreshAll();
        await pause(300);
      },
    };
  }
}

/** The helpers a section receives */
export type Stage = ReturnType<Player["stage"]>;
