// apps/web/src/lib/handover.ts - The short version of a closed project's handover: what changed, the
// measured result, and who owns what now, worked out from the project's own items so it can't drift.

import { currentDecision, metricReached, MetricFields } from "@1neon/domain";


/** The fields of an item the summary reads; the portal's Item satisfies it */
export interface HandoverItem {
  id: string;
  kind: string;
  title: string;
  status: string;
  assigneeId?: string;
  fields: Record<string, unknown>;
  updatedAt?: string;
}

/** One measure as before and after, in the measure's own unit */
export interface HandoverResult {
  title: string;
  before?: string;
  now?: string;
  target?: string;
  reached?: boolean;
}

export interface Handover {
  /** The agreed option, as approved, and the finished changes */
  agreed?: string;
  changes: string[];
  results: HandoverResult[];
  /** Systems and accounts with the person named as their owner, or no one yet */
  owners: { title: string; owner?: string }[];
  /** The handoff checklist, done of total */
  handoff: [number, number];
  /** Whether there is anything to show beyond the bare fact the project is closed */
  empty: boolean;
}

// At most this many of each, so the box stays a summary; the tabs hold the full lists
const MAX = 3;

// A number in the measure's unit, as people write it ("$1,450", "45 min", "12%", "3")
export function withUnit(value: number | undefined, unit: string) {
  if (value === undefined) return undefined;
  const n = Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const sign = value < 0 ? "-" : "";
  const u = unit.trim();
  if (u === "$" || u.toUpperCase() === "USD") return `${sign}$${n}`;
  return u === "%" ? `${sign}${n}%` : u ? `${sign}${n} ${u}` : `${sign}${n}`;
}


/** The summary for a closed project. names maps user IDs to display names */
export function handoverSummary(items: HandoverItem[], names: Map<string, string>): Handover {
  // The current agreement: the decision nothing later replaced, by its terms as approved when it has them
  const { decision, option } = currentDecision(items);
  const terms = decision?.fields.terms as { title?: string } | undefined;
  const agreed = terms?.title ?? option?.title;
  const changes = items.filter((i) => i.kind === "change" && i.status === "done").map((i) => i.title).slice(0, MAX);
  // Measures with something to compare: a baseline or at least one reading
  const results = items.filter((i) => i.kind === "metric").flatMap((i) => {
    const m = MetricFields.safeParse(i.fields);
    if (!m.success) return [];
    const latest = m.data.readings.at(-1)?.value;
    if (m.data.baseline === undefined && latest === undefined) return [];
    return [{
      title: i.title,
      before: withUnit(m.data.baseline, m.data.unit),
      now: withUnit(latest, m.data.unit),
      target: withUnit(m.data.target, m.data.unit),
      reached: metricReached(i.fields),
    }];
  }).slice(0, MAX);
  const owners = items.filter((i) => i.kind === "asset").map((i) => ({ title: i.title, owner: i.assigneeId ? names.get(i.assigneeId) : undefined })).slice(0, MAX);
  const steps = items.filter((i) => i.kind === "handoff");
  const handoff: [number, number] = [steps.filter((i) => i.status === "done").length, steps.length];
  const empty = !agreed && !changes.length && !results.length && !owners.length && !steps.length;
  return { agreed, changes, results, owners, handoff, empty };
}
