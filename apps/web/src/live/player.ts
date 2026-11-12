// apps/web/src/live/player.ts - The live playback's engine: a cursor that moves, hovers, clicks,
// drags, and types on the real portal, Maria's thoughts riding beside it, and a player that runs a
// show section by section. Every step checks for pause and for a jump, so Back, Next, and the
// section list cut cleanly, and a stumble recovers on its own before it ever asks for a choice.


import { devUser, liveEngine } from "../lib/api.ts";
import { clearCache, navigate, refreshAll, REWIND } from "../lib/nav.ts";
import { clearStep, session } from "../lib/signin.ts";
import { endTour } from "../components/Help.tsx";
import { opening } from "./opening.ts";
import { SHORTS } from "./shorts.ts";
import { PLAY, PROJECT, remember } from "./where.ts";


/** One major section of a show */
export interface Section {
  id: string;
  title: string;
  run: (s: Stage) => Promise<void>;
  /** Maria's reason for coming, when a walkthrough starts here (a link from the FAQs): she thinks it on
   * the sign-in screen, signs in for real, and walks to this section's page before it plays */
  why?: string;
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
  /** How long it takes at the default speed, said before it starts ("about 1½ minutes") */
  length?: string;
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
  /** Not started yet: waiting on Start (reduced motion, or a tab opened in the background) */
  idle: boolean;
}


// Thrown through a running section when someone jumps elsewhere; never shown
class Cut extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Typing at a steady, readable pace (before speed scaling): an even beat per letter with a little
// give, a slightly longer one between words, and a small breath after punctuation
const beat = (ch: string) => (/[.,;:!?…]/.test(ch) ? 150 : ch === " " ? 95 : 62 + Math.random() * 14);
const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
// Smooth start and stop for every movement
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Reduced motion: the cursor still shows where things happen, but it steps instead of gliding
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;


/** Is this element on screen and not hidden? Anything inert doesn't count, a person couldn't click
 * it: the menu tucked off the left edge, or the page behind the open menu. Something merely scrolled
 * out of view (a board column off to the side) still counts, since reaching it scrolls it in */
function visible(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  // The portal itself is inert while playing (keyboard isolation); anything inert inside it still
  // doesn't count, nor do the pretend windows the player made inert
  const shut = el.closest("[inert]");
  if (shut && !shut.hasAttribute("data-live-inert") && !(playing && shut.matches(BESIDE))) return false;
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


// --- Keyboard isolation and dialogs ----------------------------------------------------
// While the story plays, the portal underneath (#root) is inert: no pointer (the shield also
// covers it) and no keyboard, so Tab reaches only the controls and the exits, never Sign out or
// any other action behind them. The player's own steps still work there: they click and type
// through the DOM directly. Paused, the portal is live again for exploring.
//
// A native modal dialog sits in the browser's top layer and makes the rest of the page inert, the
// controls included. So here a dialog opens as a plain one drawn like a modal (live.css
// .live-modal), with the same contract kept by hand: focus moves into it, Escape closes it, the
// page behind it is inert while paused, and focus returns to what opened it.

// The playback's own layer: controls, cursor and thoughts, and the pretend windows
const LAYER = ".live-layer, .live-cursor, .live-think, .live-prop, .live-pop, .live-desk-file, .live-shield, .live-ghost";
// The pretend windows and the portal tour's popover sit outside #root but act as the portal does
const BESIDE = ".live-prop, .driver-popover";
const FOCUSABLE = "[autofocus], a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";
// Set by the player: true while the story moves on its own
let playing = false;
// Elements this file made inert to wall off an open dialog, to undo exactly those
let walled: HTMLElement[] = [];

// The open dialog on top, if any, and closing it the way Escape or the backdrop would
const topDialog = () => [...document.querySelectorAll<HTMLDialogElement>("dialog.live-modal[open]")].at(-1);
const dismiss = (d: HTMLDialogElement) => { if (d.dispatchEvent(new Event("cancel", { cancelable: true }))) d.close(); };

/** Make everything beside `keep` (and its ancestors) inert, up to the body, sparing the live layer
 * and anything already inert (the page's own state, which isn't ours to undo) */
function wallOff(keep: Element) {
  for (let el: Element | null = keep; el && el !== document.body; el = el.parentElement) {
    for (const sib of el.parentElement?.children ?? []) {
      if (sib === el || !(sib instanceof HTMLElement) || sib.inert || sib.matches(LAYER) || sib.matches("script, style")) continue;
      sib.inert = true;
      walled.push(sib);
    }
  }
}

/** Bring isolation in line with the state: playing walls off the portal; paused, an open dialog
 * walls off everything but itself and the controls */
function isolate() {
  for (const el of walled) el.inert = false;
  walled = [];
  const root = document.getElementById("root");
  if (root) {
    root.inert = playing;
    root.toggleAttribute("data-live-inert", playing);
  }
  for (const el of document.querySelectorAll<HTMLElement>(BESIDE)) el.inert = playing;
  const d = topDialog();
  if (!playing && d) wallOff(d);
}

// Pretend windows and popovers that appear mid-story take the current state at once
new MutationObserver((list) => {
  if (list.some((m) => [...m.addedNodes].some((n) => n instanceof Element && n.matches(BESIDE)))) isolate();
}).observe(document.body, { childList: true });

HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  this.classList.add("live-modal");
  this.show();
  isolate();
  // Paused (someone exploring): focus goes into the dialog. Playing, the portal is inert anyway
  if (!playing) this.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  this.addEventListener("close", () => {
    this.classList.remove("live-modal");
    isolate();
    // Focus goes back to what opened it, if focus would otherwise be lost
    const lost = !document.activeElement || document.activeElement === document.body || this.contains(document.activeElement);
    if (!playing && lost && back?.isConnected && !back.closest("[inert]")) back.focus();
  }, { once: true });
};
// Escape closes the top dialog while paused; while playing, keys belong to the controls
document.addEventListener("keydown", (e) => {
  const d = topDialog();
  if (e.key !== "Escape" || !d || playing) return;
  e.preventDefault();
  dismiss(d);
});
// A tap outside the dialog closes it rather than reaching the page behind (the live layer excepted)
document.addEventListener("click", (e) => {
  const d = topDialog();
  const el = e.target as Element;
  if (!d || !e.isTrusted || d.contains(el) || el.closest(".live-bar, .live-list, .live-prop, .live-shield")) return;
  e.preventDefault();
  e.stopPropagation();
  dismiss(d);
}, true);

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


/** The on-screen cursor, the shapes a real browser shows: the arrow, a pointing hand over anything that
 * acts when clicked, an I-beam over text fields, and a closed hand while dragging. Drawn after the
 * system's own (white with a dark outline), in neon1's colors: a dark green outline over the light
 * pages, and a dark fill with a green outline over the dark ones and the sign-in rain */
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
      <svg class="c-hand" viewBox="0 0 24 24"><path d="M8.5 3.5A1.5 1.5 0 0 1 11.5 3.5L11.5 10A1.4 1.4 0 0 1 14.3 10L14.3 10.6A1.35 1.35 0 0 1 17 10.6L17 11.4A1.3 1.3 0 0 1 19.6 11.4L19.6 15.5C19.6 19 17.6 21.5 14.5 21.5L12.3 21.5C10.4 21.5 9.3 20.8 8.2 19.4L4.6 14.6A1.4 1.4 0 0 1 6.8 12.9L8.5 14.6Z"/><path class="c-in" d="M11.5 10V13.4M14.3 10.6V13.5M17 11.4V13.6"/></svg>
      <svg class="c-grab" viewBox="0 0 24 24"><path d="M8.5 11.8A1.4 1.4 0 0 1 11.3 11.8L11.3 11.4A1.4 1.4 0 0 1 14.1 11.4L14.1 11.7A1.35 1.35 0 0 1 16.8 11.7L16.8 12.2A1.3 1.3 0 0 1 19.4 12.2L19.4 15.6C19.4 19 17.4 21.5 14.3 21.5L12.1 21.5C10.2 21.5 9.1 20.8 8 19.4L4.6 15.4A1.4 1.4 0 0 1 6.8 13.7L8.5 15.2Z"/><path class="c-in" d="M11.3 11.8V13.8M14.1 11.7V13.9M16.8 12.2V14"/></svg>
      <svg class="c-beam" viewBox="0 0 24 24"><path d="M9 3h2.5a1.5 1.5 0 0 1 1.5 1.5V19.5A1.5 1.5 0 0 1 11.5 21H9m6-18h-2.5A1.5 1.5 0 0 0 11 4.5v15a1.5 1.5 0 0 0 1.5 1.5H15"/></svg>
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
  // The cursor's look, as a browser would draw it over what's under it
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
  endTour();
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
  /** How fast it plays: 1 is the calm default, 0.5 half as fast, 2 twice as fast. Saved as "2:<speed>"
   * since 1x moved (the old 0.75x is today's 1x), so a speed saved on the old scale starts over at 1x */
  speed = (() => { try { const v = /^2:([\d.]+)$/.exec(localStorage.getItem("1neon.liveSpeed") ?? ""); return Number(v?.[1]) || 1; } catch { return 1; } })();
  private listeners = new Set<(v: View) => void>();
  private steps = 0;
  private est = new Map<number, number>();
  private hovered: Element[] = [];
  // The last thought and when it appeared, so the next one waits until it can have been read
  private lastThought = { at: 0, read: 0 };
  // A thought on screen, and how many moves it has ridden along: it goes with the cursor to the one
  // thing it announces, then, once read, fades before the cursor moves on (see settleThought)
  private thinking = false;
  private thoughtMoves = 0;
  // A link from the FAQs: the story so far, set up out of sight before the show starts (prep), and the
  // page the walk in leads to once it's set up (prepPath)
  private prep?: Section[];
  private prepared = false;
  private prepPath = "/";
  view: View;
  fast = false;
  // Set once playing begins; before that the portal stays as it loaded
  private started = false;
  // The field typed into last, which Enter submits (focus can't land in the inert portal)
  private typed?: HTMLElement;

  constructor(project: Section[]) {
    const short = SHORTS.find((s) => s.id === PLAY.show);
    this.show = short ?? { id: PROJECT, title: "The full story", blurb: "A whole project, from a first sign-in to ongoing care", length: "about 8 minutes", sections: project, end: "That's a whole project, start to finish." };
    // A link from the FAQs names one chapter: it plays on its own, start to finish. Maria signs in with
    // her reason for coming, walks to the page, does that one thing, and the walkthrough ends there.
    // The story before it (what that chapter needs in place) is set up out of sight first, so nothing
    // unrelated to the question plays
    const at = !short && PLAY.focus ? project.findIndex((s) => s.id === PLAY.at) : -1;
    const sec = at > 0 ? project[at] : undefined;
    if (sec?.why) {
      this.prep = project.slice(0, at);
      this.show = {
        id: PROJECT, title: sec.title, blurb: "One part of the story, on its own", length: "about a minute",
        sections: [{ id: `${sec.id}-in`, title: "Sign in", run: (st) => opening(`${sec.id}-in`, "Maria opens 1NEON and signs in", sec.why!, this.prepPath).run(st) }, sec],
        end: `That was "${sec.title}". The full story, in the menu above, plays every step from start to finish.`,
      };
    }
    // A section named in the link (or saved by a refresh) starts there, catching up on the way
    this.first = this.prep ? 0 : Math.max(0, this.show.sections.findIndex((s) => s.id === PLAY.at));
    this.view = { index: this.first, title: this.sections[this.first]!.title, caption: "", progress: 0, paused: false, skipping: false, done: false, idle: true };
  }

  /** Playing one chapter of the story on its own (a link from the FAQs) */
  get focused() {
    return Boolean(this.prep);
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
  // The play clock: wall time minus time spent paused. Every wait, glide, and "can't find it yet" limit
  // reads it, so a pause in the middle of a step (or a slow change of speed in the menu, which pauses)
  // doesn't use up the step's time and turn into a false stumble, a restart, and a replay from the start
  private pausedTotal = 0;
  private pausedAt?: number;
  // The last time the clock was read. Every wait reads it at least every 120ms, so a longer gap means
  // the browser froze the page (a phone app switch that sent no visibilitychange, a locked screen);
  // that gap counts as paused, so a step's "can't find it yet" limit doesn't expire while nobody watched
  private seen = performance.now();
  clock() {
    const now = performance.now();
    if (now - this.seen > 1500 && this.pausedAt === undefined) this.pausedTotal += now - this.seen - 100;
    this.seen = now;
    return now - this.pausedTotal - (this.pausedAt === undefined ? 0 : now - this.pausedAt);
  }
  // Paused because the tab went to the background, not by a person; coming back plays on by itself
  private autoPaused = false;
  private emit(patch: Partial<View>) {
    const was = this.view?.paused;
    this.view = { ...this.view, ...patch };
    if (!was && this.view.paused) this.pausedAt = performance.now();
    else if (was && !this.view.paused && this.pausedAt !== undefined) { this.pausedTotal += performance.now() - this.pausedAt; this.pausedAt = undefined; }
    // Moving on its own: the portal underneath goes inert; paused or done, it's live again
    const now = this.started && !this.view.paused && !this.view.done;
    if (now !== playing) { playing = now; isolate(); }
    for (const fn of this.listeners) fn(this.view);
  }

  // A chapter chosen before the seed was ready (Next, Back, or the menu while idle); start plays it
  private want?: number;

  /** Start: the seed as the first section's start, on the show's own first page, then play `at` */
  async start(at?: number) {
    if (at !== undefined) this.want = at;
    if (this.started) return;
    this.started = true;
    this.emit({ idle: false });
    this.cursor ??= new Cursor();
    // A tab sent to the background pauses, so nothing plays unseen. Coming back plays on by itself after
    // a moment for the screen to settle (a phone's toolbars slide back), unless someone paused by hand
    // or touched the portal meanwhile; a page restored from the back-forward cache does the same
    let back: number | undefined;
    const away = () => {
      clearTimeout(back);
      if (this.view.paused || this.view.done || this.view.idle) return;
      this.autoPaused = true;
      this.emit({ paused: true, caption: "Paused while this tab was in the background" });
    };
    const returned = () => {
      clearTimeout(back);
      if (!this.autoPaused) return;
      back = window.setTimeout(() => {
        if (document.hidden || !this.autoPaused || !this.view.paused) return;
        this.resume();
      }, 900);
    };
    document.addEventListener("visibilitychange", () => (document.hidden ? away() : returned()));
    addEventListener("pagehide", away);
    addEventListener("pageshow", (e) => { if (e.persisted) returned(); });
    // Clicks in the portal while paused mean someone explored; note it for resuming
    document.addEventListener("pointerdown", (e) => {
      if (this.view.paused && (e.target as Element).closest("#root")) { this.touched = true; this.autoPaused = false; }
    }, true);
    const engine = await liveEngine();
    if (!engine) return;
    // The address may be anywhere (a refresh deep in the story); the first section always starts
    // from the seed, as the show's first person, on its first page
    await engine.whenReady();
    this.snaps.set(0, { data: engine.snapshot(), path: this.show.path ?? "/", who: this.show.who ?? "" });
    const target = this.want ?? this.first;
    this.want = undefined;
    void this.goTo(target, target === this.first);
  }
  pause() {
    this.autoPaused = false;
    this.emit({ paused: true });
  }
  resume() {
    this.autoPaused = false;
    this.seen = performance.now();
    // Finished, or the page was changed by hand while paused: play this section again from its start
    if (this.view.done) return void this.goTo(0);
    if (this.touched) { this.touched = false; return void this.goTo(this.view.index); }
    this.emit({ paused: false });
  }
  /** Change the speed; it applies from the next movement */
  setSpeed(v: number) {
    this.speed = Math.min(2, Math.max(0.5, v));
    try { localStorage.setItem("1neon.liveSpeed", `2:${this.speed}`); } catch { /* private mode */ }
  }
  // The movements were tuned fast; 1x is what used to be 0.75x on the old scale (1.5 / 0.75 = 2), and
  // every duration scales from there
  private pace(ms: number) {
    return (ms * 2) / this.speed;
  }
  toggle() {
    if (this.view.idle) return void this.start();
    if (this.view.paused || this.view.done) this.resume();
    else this.pause();
  }

  /**
   * Jump to a section: back to its saved start if it's been reached, otherwise fast through the ones
   * before it. A jump by hand forgets earlier stumbles; `auto` marks the player's own retries
   */
  async goTo(i: number, auto = false) {
    if (i < 0 || i >= this.sections.length) return;
    // Not started (reduced motion, or a background tab), or the seed isn't saved yet: a chapter chosen
    // now starts the player there, rather than restoring a start that doesn't exist
    if (!this.snaps.has(0)) return void this.start(i);
    // A jump by hand shows its destination at once (title, Back and On labels, the covering panel), so
    // the bar never offers the old chapter's neighbours while the new one is being set up
    if (!auto) this.emit({ index: i, title: this.sections[i]!.title, caption: "Getting this chapter ready…", progress: 0, skipping: true, done: false, paused: false });
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
    // A single chapter from the FAQs: set the story up to it once, out of sight, then sign Maria out, so
    // the show's own first section is her coming in the front door. That point is the show's start
    if (this.prep && !this.prepared) {
      try {
        await this.restore(this.snaps.get(0)!);
        this.fast = true;
        this.cursor?.hide(true);
        this.emit({ skipping: true, paused: false, done: false, index: 0, title: this.sections[0]!.title, caption: "Setting up the bakery's project so far…", progress: 0 });
        for (const sec of this.prep) await sec.run(this.stage(token));
        await this.settle();
        this.prepPath = location.pathname.replace(/^\/1NEON\/live/, "") || "/";
        devUser.set("");
        clearCache();
        navigate("/");
        await sleep(300);
        this.snaps.set(0, { data: engine.snapshot(), path: "/", who: "" });
        this.prepared = true;
      } catch (e) {
        if (e instanceof Cut || token.cut) return;
        console.error(e);
        this.emit({ paused: true, skipping: false, caption: "Something went off script. Reload the page to try again." });
        return;
      } finally {
        this.fast = false;
        this.cursor?.hide(false);
      }
      this.emit({ skipping: false, caption: "" });
    }
    // The nearest saved start at or before i; section 0's always exists
    let from = i;
    while (from > 0 && !this.snaps.has(from)) from--;
    await this.restore(this.snaps.get(from)!);
    try {
      // Sections between the saved start and the target run fast, cursor hidden
      if (from < i) {
        this.fast = true;
        this.cursor?.hide(true);
        this.emit({ skipping: true, paused: false, done: false, index: i, title: this.sections[i]!.title, caption: "Skipping ahead to this chapter…", progress: 0 });
        for (let k = from; k < i; k++) {
          current = k;
          await this.save(k, engine);
          await this.sections[k]!.run(this.stage(token));
        }
        this.fast = false;
        this.cursor?.hide(false);
        // Nothing from the chapters caught up on (a thought, a hover) carries into this one
        this.cursor?.thought.clear();
        this.unhover();
        // Started partway in (a link from the FAQs): the story so far is in place, but she still comes
        // in the front door. Signed out, she thinks why she's here, signs in, and walks to the page
        if (i === this.first && devUser.get()) {
          // Where the story left off, once the address has settled (the last section caught up may end
          // on a click that navigates a moment later, such as Create project)
          await this.settle();
          const path = location.pathname.replace(/^\/1NEON\/live/, "") || "/";
          devUser.set("");
          clearCache();
          navigate("/");
          scrollTo({ top: 0 });
          await sleep(300);
          this.emit({ skipping: false, caption: "", progress: 0 });
          await opening(`${this.sections[i]!.id}-in`, "Maria opens 1NEON and signs in", this.sections[i]!.why ?? "Let me sign in to 1NEON.", path).run(this.stage(token));
        }
      }
      // Then play from i to the end at watching speed
      for (let k = i; k < this.sections.length; k++) {
        current = k;
        await this.save(k, engine);
        this.steps = 0;
        // A single chapter remembers its chapter, so a refresh plays that chapter again; the full story
        // remembers where it is in the story
        remember(this.prep ? { show: PROJECT, at: this.sections[1]!.id, focus: true } : { show: this.show.id as never, at: this.sections[k]!.id });
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

  // Save the data and the page at a section's start, the first time it's reached. The page is read
  // once the address has stopped changing: a section that ends on a click which navigates after a
  // save (Create project) would otherwise leave the next section's start on the old page, and going
  // Back to it would fail, restart, and replay everything from the beginning
  private async save(k: number, engine: Awaited<ReturnType<typeof liveEngine>>) {
    if (!engine || this.snaps.has(k)) return;
    await this.settle();
    if (this.snaps.has(k)) return;
    // The query stays with the page (the invite link's ?email= fills the sign-in), less the walkthrough's own ?play=
    const q = new URLSearchParams(location.search);
    q.delete("play");
    const query = q.size ? `?${q}` : "";
    this.snaps.set(k, { data: engine.snapshot(), path: (location.pathname.replace(/^\/1NEON\/live/, "") || "/") + query, who: devUser.get() });
  }

  // Wait until the address has held still for 400ms (2.5 seconds at most)
  private async settle() {
    const end = performance.now() + 2500;
    let last = location.pathname, since = performance.now();
    while (performance.now() < end && performance.now() - since < 400) {
      await sleep(50);
      if (location.pathname !== last) { last = location.pathname; since = performance.now(); }
    }
  }

  // Put the data back, then the page, then refetch what's shown
  private async restore(s: { data: unknown; path: string; who: string }) {
    const engine = await liveEngine();
    tidy();
    // A sign-in left partway (a code step, a typed email) or a dialog closed under React would
    // otherwise greet the replay: forget the step and remount the app
    clearStep(session());
    dispatchEvent(new Event(REWIND));
    engine?.restore(s.data as never);
    // A thought from before the jump doesn't carry over
    this.cursor?.thought.clear();
    this.thinking = false;
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
      const end = p.clock() + p.pace(ms);
      while (p.clock() < end) {
        await tick();
        await sleep(Math.min(80, end - p.clock()));
      }
    };
    // Wait for a target to appear, up to a few seconds (the page may still be loading)
    const waitFor = async (t: Target, ms = 6000) => {
      const end = p.clock() + ms;
      for (;;) {
        await tick();
        const el = find(t);
        if (el) return el;
        if (p.clock() > end) throw new Error(`live: can't find ${typeof t === "function" ? "a target" : JSON.stringify(t)}`);
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
      const t0 = p.clock();
      for (;;) {
        await tick();
        const t = Math.min(1, (p.clock() - t0) / ms);
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
    // A thought stays where it's about: it rides along to the one thing it announces ("Add."), and before
    // the cursor moves on again (or the caption moves to the next part, `now`) it finishes being read
    // and fades, with a short beat before anything else happens, so no finished thought trails into
    // the next part of the page
    const settleThought = async (now = false) => {
      if (p.fast || !p.thinking) return;
      if (!now && p.thoughtMoves < 1) { p.thoughtMoves++; return; }
      const left = p.lastThought.at + p.lastThought.read - p.clock();
      if (left > 0) await pause(left / p.pace(1));
      p.cursor!.thought.clear();
      p.thinking = false;
      await pause(160);
    };
    // Bring an element into view, then move onto it (a little off-center, as a hand would)
    const reach = async (el: HTMLElement) => {
      await settleThought();
      const r0 = el.getBoundingClientRect();
      const top = 70 + (document.querySelector(".live-bar")?.getBoundingClientRect().height ?? 0);
      if (r0.top < top || r0.bottom > innerHeight - 70) {
        el.scrollIntoView({ block: "center", behavior: how() });
        await pause(560);
      }
      // Aim where the element is now; if the layout moved while gliding (a resize, a rotation, a menu
      // sliding in), aim again at where it went, so the cursor always lands on it
      for (let tries = 0; tries < 3; tries++) {
        const r = el.getBoundingClientRect();
        const x = r.left + Math.min(r.width * 0.45, 24 + r.width * 0.2), y = r.top + r.height * 0.55;
        await glide(x, y);
        const now = el.getBoundingClientRect();
        if (Math.abs(now.left - r.left) < 4 && Math.abs(now.top - r.top) < 4) break;
      }
      hoverAt(el);
    };

    return {
      fast: () => p.fast,
      /** Whether something is on screen right now (a phone's tab bar, say), without waiting for it */
      has: async (t: Target) => Boolean(find(t)),
      /** Hold for a moment (skipped when catching up) */
      wait: async (ms: number) => { await pause(ms); },
      /** What's happening, shown in the controls */
      say: async (caption: string) => { await tick(); if (!p.fast) { await settleThought(true); p.emit({ caption }); } },
      /**
       * What Maria is thinking, beside the cursor. A new thought waits until the last one has been on
       * screen long enough to read, so quick actions never flash words past
       */
      think: async (text: string) => {
        await tick();
        if (p.fast) return;
        const left = p.lastThought.at + p.lastThought.read - p.clock();
        if (left > 0) await pause(left / p.pace(1));
        p.cursor!.thought.say(text, p.cursor!.x, p.cursor!.y);
        p.lastThought = { at: p.clock(), read: p.pace(450 + text.length * 22) };
        p.thinking = true;
        p.thoughtMoves = 0;
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
        p.typed = el;
        // React listens for native input events, so set the value through the element's own setter
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
        let now = el.value;
        for (const ch of p.fast ? [text] : [...text]) {
          await tick();
          now += ch;
          setter.call(el, now);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          if (!p.fast) await sleep(p.pace(beat(ch)));
        }
        await pause(after);
      },
      /** Click into a field and paste a whole value at once, as from the clipboard */
      paste: async (t: Target, text: string, after = 400) => {
        step();
        const el = (await waitFor(t)) as HTMLInputElement | HTMLTextAreaElement;
        await reach(el);
        p.cursor!.press();
        el.focus();
        p.typed = el;
        await pause(350);
        await tick();
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
        setter.call(el, text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
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
        const el = p.typed?.isConnected ? p.typed : (document.activeElement as HTMLElement | null);
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
          const t0 = p.clock();
          // Carry the ghost with the cursor, easing in and out, tilting a little mid-air
          for (;;) {
            await tick();
            const t = ms ? Math.min(1, (p.clock() - t0) / ms) : 1;
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
        const where = { sel: ".side a, .tabbar a", text: label ?? "" };
        let link = label ? find(where) : undefined;
        // Not on screen (the menu is tucked away): open it the way she would, from the tab bar's Menu
        // on a phone or the top bar's button otherwise, then pick the link from the full menu
        if (label && !link && !p.fast) {
          const btn = find(".tabbar .menu-btn") ?? find(".top .menu-btn");
          if (btn) {
            await reach(btn);
            await pause(150);
            p.cursor!.press();
            btn.click();
            await pause(450);
            link = find({ sel: ".side.open a", text: label });
          }
        }
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
      /** Arrive at an address directly, as following a link from outside the portal would */
      open: async (path: string, after = 600) => {
        await tick();
        navigate(path);
        await pause(after);
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
