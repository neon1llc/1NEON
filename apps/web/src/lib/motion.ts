// apps/web/src/lib/motion.ts - Assembly-line motion between states. The changing part pans out to
// one side as the next state pans in from the other, using the browser's View Transitions; with
// no support, or with reduced motion asked for, the change is instant.


import { flushSync } from "react-dom";


/** Which way the line moves: forward pans left, back pans right */
export type Way = "next" | "back";


// Browsers without view transitions, and people who asked for less motion, get instant changes
type VT = { finished: Promise<void>; ready?: Promise<void>; updateCallbackDone?: Promise<void> };
type Doc = Document & { startViewTransition?: (cb: () => void) => VT };
const start = (): ((cb: () => void) => VT) | undefined => {
  const d = document as Doc;
  if (!d.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
  return d.startViewTransition.bind(d);
};

/** Whether a change can slide right now: links that ask the router for a transition check first, and
 * navigate plainly otherwise (no support, less motion asked for, or a walkthrough setting up out of sight) */
export const canSlide = () => Boolean(start());


/**
 * A transition cut short by the next one (two quick clicks on the tabs) rejects its `ready` promise.
 * Nothing waits on it, the page still changes, and the browser would report an error nobody can act
 * on. Called once at startup, this marks that rejection as expected for every transition, the
 * router's included
 */
export function quietSkippedTransitions() {
  const d = document as Doc;
  const begin = d.startViewTransition;
  if (!begin) return;
  d.startViewTransition = ((cb: () => void) => {
    const t = begin.call(d, cb);
    t.ready?.catch(() => undefined);
    // Once its change has landed, and again when it ends, make sure the page still matches the address
    const check = () => void setTimeout(() => settle?.(), 60);
    (t.updateCallbackDone ?? t.finished).then(check, check);
    t.finished.then(check, check);
    return t;
  }) as typeof d.startViewTransition;
}


// --- Keeping the page and the address together ---------------------------------------------------
// The router draws a transition's page a frame or more after the click. A navigation that lands in
// that gap (two quick taps on a busy phone) is drawn first, and the transition's older page is then
// drawn over it, while the address stays on the newer one. So after every transition the page drawn
// is compared with the router's place, and when they differ the router goes to its place again

// The location the app drew last (its key), reported by the app's root
let drawn = "";
/** The app's root says which location it just drew */
export function drew(key: string) {
  drawn = key;
}

// Set once at startup: goes to the router's place again when the page drawn isn't it
let settle: (() => void) | undefined;
/** Give the check the router: where it is (and whether it's at rest), and how to go there again */
export function keepPageWithAddress(at: () => { key: string; idle: boolean }, again: () => void) {
  settle = () => {
    const now = at();
    if (now.idle && drawn && drawn !== now.key) again();
  };
}


/** Mark the direction for the CSS, cleared once the transition ends */
export function aim(way: Way) {
  document.documentElement.dataset.slide = way;
}


/** Change state with a slide: React renders the new state inside the transition */
export function slide(way: Way, update: () => void) {
  const go = start();
  if (!go) return update();
  aim(way);
  go(() => flushSync(update)).finished.finally(() => delete document.documentElement.dataset.slide);
}


/** For links that use the router's own view transition: set the way from positions in a sequence */
export function aimBetween(from: number, to: number) {
  if (to !== from) aim(to > from ? "next" : "back");
  // The router starts and ends the transition; clear the mark shortly after it would finish
  setTimeout(() => { delete document.documentElement.dataset.slide; }, 700);
}
