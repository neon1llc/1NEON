// apps/web/src/lib/measures.ts - The new-project measures as typed, checked and turned into the exact
// values the API will store, so the form, the Review step, and the create call all use one reading.


// The API's limits for a starter measure (CreateProjectInput.metrics in @1neon/domain)
export const MEASURE_TITLE_MAX = 160;
export const MEASURE_UNIT_MAX = 24;


/** A measure as typed: every field is the raw text */
export interface MetricDraft {
  title: string;
  unit: string;
  baseline: string;
  target: string;
}


/** A measure as it will be sent; a missing number is unset, which is not the same as zero */
export interface MetricValue {
  title: string;
  unit: string;
  baseline?: number;
  target?: number;
}


/** What's wrong with each field, in words for the person */
export type MetricErrors = Partial<Record<keyof MetricDraft, string>>;


// A plain decimal: optional minus, digits with at most one point (".5" and "5." read as numbers)
const DECIMAL = /^-?(?:\d+\.?\d*|\.\d+)$/;


/**
 * An optional number as typed. Blank is "not set" (undefined); anything else must be one finite
 * decimal, or it's an error, never silently dropped
 */
export function optionalNumber(raw: string): { ok: true; value?: number } | { ok: false } {
  const s = raw.trim();
  if (s === "") return { ok: true };
  if (!DECIMAL.test(s)) return { ok: false };
  const n = Number(s);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}


/** True when nothing at all was typed in this measure; such a row is left out, not an error */
export function isBlank(m: MetricDraft) {
  return !m.title.trim() && !m.unit.trim() && !m.baseline.trim() && !m.target.trim();
}


/** Check one measure and, when it's valid, give the values that will be saved */
export function checkMeasure(m: MetricDraft): { errors: MetricErrors; value?: MetricValue } {
  const errors: MetricErrors = {};
  const title = m.title.trim();
  const unit = m.unit.trim();
  if (!title) errors.title = "Name this measure, or clear its other fields.";
  else if (title.length > MEASURE_TITLE_MAX) errors.title = `Keep the name to ${MEASURE_TITLE_MAX} characters.`;
  if (unit.length > MEASURE_UNIT_MAX) errors.unit = `Keep the unit to ${MEASURE_UNIT_MAX} characters.`;
  const baseline = optionalNumber(m.baseline);
  const target = optionalNumber(m.target);
  if (!baseline.ok) errors.baseline = "Enter a number like 12, -3, or 4.5, or leave it blank.";
  if (!target.ok) errors.target = "Enter a number like 12, -3, or 4.5, or leave it blank.";
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { title, unit, baseline: baseline.ok ? baseline.value : undefined, target: target.ok ? target.value : undefined } };
}


/**
 * Every measure the person started: the values to send, each row's errors (by its index in `drafts`),
 * and the first field to fix, as "<field>:<index>"
 */
export function checkMeasures(drafts: MetricDraft[]) {
  const values: MetricValue[] = [];
  const errors: MetricErrors[] = drafts.map(() => ({}));
  let first: string | undefined;
  drafts.forEach((d, i) => {
    if (isBlank(d)) return;
    const r = checkMeasure(d);
    errors[i] = r.errors;
    if (r.value) values.push(r.value);
    const bad = (["title", "unit", "baseline", "target"] as const).find((f) => r.errors[f]);
    if (bad && !first) first = `${bad}:${i}`;
  });
  return { values, errors, first, ok: !first };
}


/** A saved number as people read it, saying so when it's unset (zero stays "0") */
export function numberWords(n: number | undefined) {
  return n === undefined ? "not set" : String(n);
}
