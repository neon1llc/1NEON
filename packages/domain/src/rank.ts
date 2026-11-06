// packages/domain/src/rank.ts - Fractional ranks: lexicographic strings so a card move rewrites
// only that card.


const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
// Bounds as digit indexes; MAX + 1 stands for "no upper bound" at a position
const MIN = 0;
const MAX = DIGITS.length - 1;


/** The digit value of `s` at `i`, or `fallback` past its end */
function digit(s: string, i: number, fallback: number): number {
  const c = s[i];
  return c === undefined ? fallback : DIGITS.indexOf(c);
}


/**
 * A rank strictly between `a` and `b` (either may be empty for open ends).
 * Ranks made here never end in "0", so a rank always exists between any two of them.
 */
export function rankBetween(a = "", b = ""): string {
  if (a && b && a >= b) throw new Error(`rankBetween: ${a} >= ${b}`);
  let out = "";
  for (let i = 0; ; i++) {
    const lo = digit(a, i, MIN);
    const hi = b ? digit(b, i, MAX + 1) : MAX + 1;
    // Room between the two digits: take the midpoint and stop
    if (hi - lo > 1) {
      return out + DIGITS[Math.floor((lo + hi) / 2)];
    }
    out += DIGITS[lo];
    // Once we copy a digit smaller than b's, b no longer bounds the following digits
    if (lo < hi) b = "";
  }
}


/** Evenly spaced ranks for n items */
export function initialRanks(n: number): string[] {
  const out: string[] = [];
  let prev = "";
  for (let i = 0; i < n; i++) {
    prev = rankBetween(prev, "");
    out.push(prev);
  }
  return out;
}
