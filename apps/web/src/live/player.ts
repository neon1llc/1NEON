// apps/web/src/live/player.ts - The live playback's engine: a cursor that moves, hovers, clicks,
// drags, and types on the real portal, and a player that runs the story section by section. Every
// step checks for pause and for a jump, so Back, Next, and the section list cut cleanly.


import { liveEngine } from "../lib/api.ts";
import { clearCache, navigate, refreshAll } from "../lib/nav.ts";


/** One major section of the story */
export interface Section {
  id: string;
  title: string;
  run: (s: Stage) => Promise<void>;
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


/** Is this element on screen and not hidden? */
function visible(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
}


/** A target: a CSS selector, optionally narrowed to elements whose text includes some words */
export type Target = string | { sel: string; text?: string | RegExp; within?: string; nth?: number };

/** The first visible element matching a target, or undefined */
export function find(t: Target): HTMLElement | undefined {
  const spec = typeof t === "string" ? { sel: t } : t;
  const root = spec.within ? document.querySelector(spec.within) ?? document : document;
  const all = [...root.querySelectorAll<HTMLElement>(spec.sel)].filter(visible).filter((el) => {
    if (spec.text === undefined) return true;
    const words = (el.innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).value || "").trim();
    return typeof spec.text === "string" ? words.toLowerCase().includes(spec.text.toLowerCase()) : spec.text.test(words);
  });
  return all[spec.nth ?? 0];
}


/** The on-screen cursor: an arrow, a pointing hand, an I-beam, or a closed hand while dragging */
class Cursor {
  readonly el: HTMLDivElement;
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
    this.place();
  }
  // Draw at the current point
  place() {
    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
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
  hide(h: boolean) {
    this.el.classList.toggle("gone", h);
  }
}


/** The shape a real browser would show over this element */
function shapeFor(el: Element): "arrow" | "hand" | "beam" {
  const editable = el.closest("input:not([type=checkbox]):not([type=radio]):not([type=date]), textarea, [contenteditable=true]");
  if (editable) return "beam";
  return el.closest("a, button, label, summary, select, [role=button], [role=tab], [role=radio], input[type=checkbox], input[type=radio], input[type=date]") ? "hand" : "arrow";
}


/** The player: sections in order, the current one running, snapshots at each section's start */
export class Player {
  private cursor?: Cursor;
  private token = { cut: false };
  private snaps = new Map<number, { data: unknown; path: string }>();
  private listeners = new Set<(v: View) => void>();
  private steps = 0;
  private est = new Map<number, number>();
  private hovered: Element[] = [];
  view: View;
  fast = false;

  constructor(readonly sections: Section[]) {
    this.view = { index: 0, title: sections[0]!.title, caption: "", progress: 0, paused: false, skipping: false, done: false };
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

  /** Start from the first section */
  start() {
    this.cursor ??= new Cursor();
    void this.runFrom(0);
  }
  pause() {
    this.emit({ paused: true });
  }
  resume() {
    // Finished: play again from the top
    if (this.view.done) return void this.goTo(0);
    this.emit({ paused: false });
  }
  toggle() {
    if (this.view.paused || this.view.done) this.resume();
    else this.pause();
  }

  /** Jump to a section: back to its saved start if it's been reached, otherwise fast through the ones before it */
  async goTo(i: number) {
    if (i < 0 || i >= this.sections.length) return;
    this.token.cut = true;
    this.token = { cut: false };
    void this.runFrom(i);
  }

  // --- Running --------------------------------------------------------------

  // Run section i and everything after it; earlier unreached sections run fast first
  private async runFrom(i: number) {
    const token = this.token;
    const engine = await liveEngine();
    if (!engine) return;
    // The nearest saved start at or before i
    let from = i;
    while (from > 0 && !this.snaps.has(from)) from--;
    const snap = this.snaps.get(from);
    if (snap) await this.restore(snap);
    try {
      // Sections between the saved start and the target run fast, cursor hidden
      if (from < i) {
        this.fast = true;
        this.cursor?.hide(true);
        this.emit({ skipping: true, paused: false, done: false, index: i, title: this.sections[i]!.title, caption: "Catching up…", progress: 0 });
        for (let k = from; k < i; k++) {
          this.save(k, engine);
          await this.sections[k]!.run(this.stage(token));
        }
        this.fast = false;
        this.cursor?.hide(false);
      }
      // Then play from i to the end at watching speed
      for (let k = i; k < this.sections.length; k++) {
        this.save(k, engine);
        this.steps = 0;
        this.emit({ index: k, title: this.sections[k]!.title, caption: "", progress: 0, skipping: false, done: false, paused: false });
        await this.sections[k]!.run(this.stage(token));
        this.est.set(k, this.steps);
        this.emit({ progress: 1 });
        if (k < this.sections.length - 1) await this.stage(token).wait(900);
      }
      this.unhover();
      this.emit({ done: true, paused: true, caption: "That's a whole project, start to finish." });
    } catch (e) {
      // A jump cuts the running section; anything else is a real problem worth seeing in the console
      this.fast = false;
      this.cursor?.hide(false);
      if (!(e instanceof Cut)) {
        console.error(e);
        this.emit({ paused: true, skipping: false, caption: "Something went off script. Pick a section to carry on." });
      }
    }
  }

  // Save the data and the page at a section's start, the first time it's reached
  private save(k: number, engine: Awaited<ReturnType<typeof liveEngine>>) {
    if (!engine || this.snaps.has(k)) return;
    this.snaps.set(k, { data: engine.snapshot(), path: location.pathname.replace(/^\/1NEON\/live/, "") || "/" });
  }

  // Put the data back, then the page, then refetch what's shown
  private async restore(s: { data: unknown; path: string }) {
    const engine = await liveEngine();
    engine?.restore(s.data as never);
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
      const end = performance.now() + ms;
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
        if (performance.now() > end) throw new Error(`live: can't find ${JSON.stringify(t)}`);
        await sleep(60);
      }
    };
    // Glide the cursor to a point; the distance sets the time, within limits
    const glide = async (x: number, y: number) => {
      const c = p.cursor!;
      if (p.fast) { c.x = x; c.y = y; c.place(); return; }
      const sx = c.x, sy = c.y;
      const ms = Math.max(280, Math.min(950, Math.hypot(x - sx, y - sy) * 1.1));
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
        el.scrollIntoView({ block: "center", behavior: p.fast ? "instant" : "smooth" });
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
      /** Wait until something is on screen */
      waitFor,
      /** Move onto something and rest there */
      hover: async (t: Target, ms = 700) => { step(); const el = await waitFor(t); await reach(el); await pause(ms); },
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
          if (!p.fast) await sleep(ch === " " ? 75 : 40 + Math.random() * 32);
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
        // A real drag starts on the element itself, carrying its data
        const dt = new DataTransfer();
        if (!drop) a.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
        const b = await waitFor(to);
        b.scrollIntoView({ block: "nearest", inline: "center", behavior: p.fast ? "instant" : "smooth" });
        await pause(300);
        const rb = b.getBoundingClientRect();
        const ox = p.cursor!.x - r.left, oy = p.cursor!.y - r.top;
        const sx = p.cursor!.x, sy = p.cursor!.y;
        const tx = rb.left + Math.min(rb.width / 2, 70), ty = rb.top + 70;
        const ms = p.fast ? 0 : 1200;
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
          else document.elementFromPoint(p.cursor!.x, p.cursor!.y)?.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
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
        ghost.remove();
        a.classList.remove("live-lifted");
        b.classList.remove("live-target");
        p.cursor!.shape("arrow");
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
          setTimeout(() => pop.remove(), 3200);
        }
        await pause(after);
      },
      /** Scroll the page by some amount, smoothly */
      scroll: async (dy: number, after = 600) => {
        await tick();
        scrollBy({ top: dy, behavior: p.fast ? "instant" : "smooth" });
        await pause(after);
      },
      /** Back to the top of the page */
      top: async () => {
        await tick();
        scrollTo({ top: 0, behavior: p.fast ? "instant" : "smooth" });
        await pause(450);
      },
    };
  }
}

/** The helpers a section receives */
export type Stage = ReturnType<Player["stage"]>;
