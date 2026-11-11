// packages/domain/src/changes.ts - Plain-words descriptions of what an edit changed, for the activity
// record: every update says exactly what moved ("health At risk → On track"), never just "Updated".
// The API writes them into each audit event's summary and details; the web app shows the details.


import type { Item, Project } from "./model.ts";


/** Looks up a person's name by user id (members' names, or their email) */
export type NameOf = (userId: string) => string;


// Words people read, for the stored values
const HEALTH: Record<string, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track", not_started: "Not assessed" };
const STATUS: Record<string, string> = { open: "To do", doing: "Doing", blocked: "Blocked", done: "Done", draft: "Draft", proposed: "Proposed", declined: "Declined", approved: "Approved" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


/** A calendar date (YYYY-MM-DD) as "Nov 3, 2026"; anything else as given */
export function dayWords(d: string | undefined | null): string {
  if (!d) return "none";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : d;
}


// A short quote of free text: whole when short, cut at a word when long
function quote(s: string, n = 48): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "blank";
  return `"${t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t}"`;
}


// camelCase and snake_case field names as words: "costScore" → "cost score"
function words(key: string): string {
  return key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}


// One value of a kind-specific field, in words
function value(v: unknown): string {
  if (v === undefined || v === null || v === "") return "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? dayWords(v) : quote(v, 40);
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? "entry" : "entries"}`;
  return "set";
}


/** What changed on a project, one line each; empty when nothing did */
export function projectChanges(before: Project, after: Project, nameOf: NameOf): string[] {
  const out: string[] = [];
  if (before.name !== after.name) out.push(`name ${quote(before.name)} → ${quote(after.name)}`);
  if ((before.summary ?? "") !== (after.summary ?? "")) out.push(after.summary ? `summary now ${quote(after.summary, 80)}` : "summary cleared");
  if ((before.outcome ?? "") !== (after.outcome ?? "")) out.push(after.outcome ? `outcome now ${quote(after.outcome, 80)}` : "outcome cleared");
  if (before.health !== after.health) out.push(`health ${HEALTH[before.health] ?? before.health} → ${HEALTH[after.health] ?? after.health}`);
  if ((before.targetDate ?? "") !== (after.targetDate ?? "")) out.push(after.targetDate ? `target date ${dayWords(before.targetDate)} → ${dayWords(after.targetDate)}` : `target date ${dayWords(before.targetDate)} cleared`);
  if (before.archived !== after.archived) out.push(after.archived ? "archived" : "unarchived");
  // People: who joined, who left, and whose role changed (decision makers have their own event)
  const was = new Map(before.people.map((p) => [p.userId, p.role]));
  const now = new Map(after.people.map((p) => [p.userId, p.role]));
  const dm = "decision_maker";
  for (const [id, role] of now) {
    if (!was.has(id)) { if (role !== dm) out.push(`added ${nameOf(id)} as ${words(role)}`); }
    else if (was.get(id) !== role && role !== dm && was.get(id) !== dm) out.push(`${nameOf(id)} now ${words(role)}`);
  }
  for (const [id, role] of was) if (!now.has(id) && role !== dm) out.push(`removed ${nameOf(id)}`);
  return out;
}


/** What changed on an item, one line each; empty when nothing did */
export function itemChanges(before: Item, after: Item, nameOf: NameOf): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`renamed ${quote(before.title)} → ${quote(after.title)}`);
  if (before.status !== after.status) out.push(`status ${STATUS[before.status] ?? before.status} → ${STATUS[after.status] ?? after.status}`);
  if ((before.assigneeId ?? "") !== (after.assigneeId ?? "")) out.push(after.assigneeId ? `assigned to ${nameOf(after.assigneeId)}${before.assigneeId ? ` (was ${nameOf(before.assigneeId)})` : ""}` : `unassigned from ${nameOf(before.assigneeId!)}`);
  if ((before.dueDate ?? "") !== (after.dueDate ?? "")) out.push(after.dueDate ? `due ${dayWords(before.dueDate)} → ${dayWords(after.dueDate)}` : `due date ${dayWords(before.dueDate)} cleared`);
  if ((before.body ?? "") !== (after.body ?? "")) out.push(after.body ? `description now ${quote(after.body, 80)}` : "description cleared");
  // Kind-specific fields, by name; a list (a measure's readings) says what was added or removed
  const keys = new Set([...Object.keys(before.fields ?? {}), ...Object.keys(after.fields ?? {})]);
  for (const k of keys) {
    const a = before.fields?.[k], b = after.fields?.[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (k === "health") out.push(`health ${HEALTH[String(a)] ?? value(a)} → ${HEALTH[String(b)] ?? value(b)}`);
    else if (Array.isArray(a) || Array.isArray(b)) {
      const n = (Array.isArray(b) ? b.length : 0) - (Array.isArray(a) ? a.length : 0);
      out.push(n > 0 ? `${words(k)}: ${n} added` : n < 0 ? `${words(k)}: ${-n} removed` : `${words(k)} edited`);
    } else out.push(`${words(k)} ${value(a)} → ${value(b)}`);
  }
  return out;
}


/**
 * The summary line and details for an edit: short changes ride in the summary itself, so the bell
 * and emails (which show only the summary) say what changed; the full list is always in details.
 * Returns undefined when nothing changed, so a save with no change records nothing
 */
export function changeRecord(head: string, changes: string[], max = 300): { summary: string; details: string[] } | undefined {
  if (!changes.length) return undefined;
  const inline = `${head}: ${changes.join("; ")}`;
  const summary = inline.length <= max ? inline
    : `${head}: ${changes[0]!.length < max - head.length - 30 ? `${changes[0]}, and ${changes.length - 1} more` : `${changes.length} changes`}`;
  return { summary: summary.slice(0, max), details: changes.map((c) => c.slice(0, 200)).slice(0, 12) };
}


/** What changed in an organization's workflow stages, one line each */
export function stageChanges(before: readonly { id: string; name: string; exit?: string; wipLimit?: number; hidden?: boolean }[], after: typeof before): string[] {
  const out: string[] = [];
  const was = new Map(before.map((s) => [s.id, s]));
  const now = new Map(after.map((s) => [s.id, s]));
  for (const s of after) {
    const o = was.get(s.id);
    if (!o) { out.push(`added stage "${s.name}"`); continue; }
    if (o.name !== s.name) out.push(`renamed stage "${o.name}" → "${s.name}"`);
    if (Boolean(o.hidden) !== Boolean(s.hidden)) out.push(`${s.hidden ? "hid" : "showed"} "${s.name}"`);
    if ((o.exit ?? "") !== (s.exit ?? "")) out.push(`"${s.name}" done when ${s.exit ? `"${s.exit.slice(0, 60)}"` : "(cleared)"}`);
    if (o.wipLimit !== s.wipLimit) out.push(`"${s.name}" limit ${o.wipLimit ?? "none"} → ${s.wipLimit ?? "none"}`);
  }
  for (const s of before) if (!now.has(s.id)) out.push(`removed stage "${s.name}"`);
  // Order: only when the stages kept in both lists come in a different order
  const kept = (l: typeof before) => l.filter((s) => was.has(s.id) && now.has(s.id)).map((s) => s.id).join();
  if (kept(before) !== kept(after)) out.push("reordered stages");
  return out;
}
