// apps/web/src/lib/motion.ts - Assembly-line motion between states. The changing part pans out to
// one side as the next state pans in from the other, using the browser's View Transitions; with
// no support, or with reduced motion asked for, the change is instant.


import { flushSync } from "react-dom";


/** Which way the line moves: forward pans left, back pans right */
export type Way = "next" | "back";


// Browsers without view transitions, and people who asked for less motion, get instant changes
type VT = { finished: Promise<void> };
const start = (): ((cb: () => void) => VT) | undefined => {
  const d = document as Document & { startViewTransition?: (cb: () => void) => VT };
  if (!d.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
  return d.startViewTransition.bind(d);
};


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
