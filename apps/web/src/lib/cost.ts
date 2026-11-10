// apps/web/src/lib/cost.ts - Reads an option's price as written ("$6,500 fixed + ~$15/mo") into
// one-time and recurring parts, so a comparison can show them apart and add up a first year. The
// written price stays the authority: anything this can't read with confidence is left as written.


/** One recurring charge, per month or per year */
export interface Recurring {
  amount: number;
  per: "month" | "year";
  approx: boolean;
}

/** A price split into what's paid once and what repeats */
export interface CostParts {
  oneTime?: { amount: number; approx: boolean };
  recurring: Recurring[];
}


// A dollar amount, optionally approximate ("~", "about", "approx.") and optionally in thousands ("4k")
const AMOUNT = /(~|about\s+|approx(?:imately|\.)?\s+)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i;
const MONTHLY = /\/\s*(mo|month)\b|\bper\s+month\b|\bmonthly\b|\ba\s+month\b/i;
const YEARLY = /\/\s*(yr|year)\b|\bper\s+year\b|\byearly\b|\bannual(ly)?\b|\ba\s+year\b/i;
// Prices that aren't a single amount: a range, or a rate per hour, seat, or user
const RANGE = /\d\s*[-–]\s*\$?\d/;
const RATE = /\/\s*(h|hr|hour|seat|user)\b|\bper\s+(hour|seat|user)\b/i;


/**
 * Split a written price on "+" into one-time and recurring parts. Returns undefined unless every
 * part names exactly one dollar amount and at most one part is one-time, so a free-form price
 * ("depends on seats", "$40-60/mo") is never turned into a misleading number
 */
export function parseCost(text: string): CostParts | undefined {
  const parts = text.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  const out: CostParts = { recurring: [] };
  for (const part of parts) {
    const m = AMOUNT.exec(part);
    if (!m || (part.match(/\$/g) ?? []).length > 1 || RANGE.test(part) || RATE.test(part)) return undefined;
    const amount = Number(m[2]!.replace(/,/g, "")) * (m[3] ? 1000 : 1);
    if (!Number.isFinite(amount)) return undefined;
    const approx = Boolean(m[1]);
    if (MONTHLY.test(part)) out.recurring.push({ amount, per: "month", approx });
    else if (YEARLY.test(part)) out.recurring.push({ amount, per: "year", approx });
    else if (out.oneTime) return undefined;
    else out.oneTime = { amount, approx };
  }
  return out;
}


/** One-time plus twelve months of every recurring charge; only when both kinds are known */
export function firstYear(c: CostParts): { amount: number; approx: boolean } | undefined {
  if (!c.oneTime || !c.recurring.length) return undefined;
  const repeat = c.recurring.reduce((sum, r) => sum + r.amount * (r.per === "month" ? 12 : 1), 0);
  return { amount: c.oneTime.amount + repeat, approx: c.oneTime.approx || c.recurring.some((r) => r.approx) };
}


/** "$6,500", or "about $6,680" when any part was approximate */
export function money(n: { amount: number; approx: boolean }) {
  const s = `$${n.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return n.approx ? `about ${s}` : s;
}
