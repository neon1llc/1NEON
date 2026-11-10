// apps/web/src/lib/neo.ts - What the signed-in Neo window does with an answer: the reply's text turned
// into safe pieces (paragraphs, lists, and links that stay inside 1NEON), the conversation kept within
// the API's limits, and a plan's steps run one at a time through the same API calls the pages make.
// Nothing here skips a check: every step goes through api() as the signed-in person, so permissions,
// "Confirm it's you", and version checks apply exactly as they do on the page.


import { NEO_LIMITS, NeoPlan, NeoTour, type NeoOp, type NeoReply } from "@1neon/domain";
import { api } from "./api.ts";
import { navigate } from "./nav.ts";
import type { Me, ProjectDetail } from "./types.ts";


// --- The conversation -----------------------------------------------------------------

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** A reply kept for the history: within the per-turn limit, cut at a word with "…" when it's longer */
export function keep(text: string): string {
  const t = text.trim();
  if (t.length <= NEO_LIMITS.chars) return t;
  return `${t.slice(0, NEO_LIMITS.chars - 1).replace(/\s+\S*$/, "")}…`;
}

/** The turns to send: the history plus the new question, oldest question and answer dropped together until it fits */
export function fit(history: Turn[], question: string): Turn[] {
  const turns: Turn[] = [...history, { role: "user", content: question }];
  const size = () => turns.reduce((n, t) => n + t.content.length, 0);
  while (turns.length > 1 && (turns.length > NEO_LIMITS.turns || size() > NEO_LIMITS.total)) turns.splice(0, 2);
  return turns;
}

/** Ask Neo. The tour and plan are checked again here, so a malformed one is dropped, never shown */
export async function askNeo(messages: Turn[], where: string): Promise<NeoReply> {
  const r = await api<NeoReply>("/neo", { method: "POST", body: { messages, where } });
  const tour = r.tour ? NeoTour.safeParse(r.tour) : undefined;
  const plan = r.plan ? NeoPlan.safeParse(r.plan) : undefined;
  return { reply: String(r.reply ?? ""), tour: tour?.success ? tour.data : undefined, plan: plan?.success ? plan.data : undefined };
}


// --- Reply text -------------------------------------------------------------------------

/** One piece of a line: plain text, bold text, or a link (inside 1NEON, or one of neon1's two addresses) */
export type Piece = { text: string; bold?: boolean } | { text: string; href: string; inside: boolean };
/** One block: a paragraph, or a bulleted or numbered list */
export type Block = { kind: "p"; lines: Piece[][] } | { kind: "ul" | "ol"; items: Piece[][] };

// The only links a reply may carry, matching the API's own rule
const SAFE = /^(\/1NEON\/[A-Za-z0-9/_#?=&.%-]*|mailto:(hello|security)@neon1\.tech)$/;
const INLINE = /\[([^\]]{1,200})\]\(([^)\s]{1,400})\)|\*\*([^*]{1,300})\*\*/g;

/** A line's pieces: links stay only when safe, otherwise their label stays as text */
export function pieces(line: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    if (m[3] !== undefined) out.push({ text: m[3], bold: true });
    else if (SAFE.test(m[2]!)) out.push({ text: m[1]!, href: m[2]!, inside: m[2]!.startsWith("/1NEON/") });
    else out.push({ text: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

/** Blank lines split blocks; runs of "- " or "1. " lines become lists */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const chunk of text.trim().split(/\n\s*\n/)) {
    let cur: Block | undefined;
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = /^[-*•]\s+(.*)$/.exec(line);
      const num = /^\d{1,2}[.)]\s+(.*)$/.exec(line);
      const kind = bullet ? "ul" : num ? "ol" : "p";
      const body = pieces(bullet?.[1] ?? num?.[1] ?? line);
      if (cur?.kind === kind) {
        if (cur.kind === "p") cur.lines.push(body);
        else cur.items.push(body);
        continue;
      }
      cur = kind === "p" ? { kind, lines: [body] } : { kind, items: [body] };
      out.push(cur);
    }
  }
  return out;
}


// --- Plans ----------------------------------------------------------------------------

// A new project's create carries a one-time key, so a retry after a lost reply returns the same project
const onceKey = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);

// The current version of what a step changes, read just before the change, as the page would have it
const projectOf = (tid: string, pid: string) => api<ProjectDetail>(`/t/${tid}/projects/${pid}`);
async function itemVersion(tid: string, pid: string, iid: string) {
  const item = (await projectOf(tid, pid)).items.find((i) => i.id === iid);
  if (!item) throw new Error("That item no longer exists.");
  return item.version;
}

/**
 * Run one step as the signed-in person. Each action is the exact call its page makes; the API decides
 * whether this person may do it. A `go` step only opens the page
 */
export async function runStep(op: NeoOp): Promise<void> {
  switch (op.op) {
    case "go":
      navigate(op.path);
      return;
    case "create_project": {
      const { tid, op: _, ...body } = op;
      await api(`/t/${tid}/projects`, { method: "POST", body: { ...body, idempotencyKey: onceKey() } });
      return;
    }
    case "update_project": {
      const { tid, pid, op: _, ...patch } = op;
      const { project } = await projectOf(tid, pid);
      await api(`/t/${tid}/projects/${pid}`, { method: "PATCH", body: { version: project.version, ...patch } });
      return;
    }
    case "move_project": {
      const { project } = await projectOf(op.tid, op.pid);
      await api(`/t/${op.tid}/projects/${op.pid}/move`, { method: "POST", body: { version: project.version, stageId: op.stageId, reason: op.reason } });
      return;
    }
    case "post_update":
      await api(`/t/${op.tid}/projects/${op.pid}/items`, { method: "POST", body: { kind: "update", title: op.title, fields: { health: op.health } } });
      return;
    case "add_item": {
      const { tid, pid, op: _, ...body } = op;
      await api(`/t/${tid}/projects/${pid}/items`, { method: "POST", body });
      return;
    }
    case "update_item": {
      const { tid, pid, iid, op: _, ...patch } = op;
      await api(`/t/${tid}/projects/${pid}/items/${iid}`, { method: "PATCH", body: { version: await itemVersion(tid, pid, iid), ...patch } });
      return;
    }
    case "delete_item":
      await api(`/t/${op.tid}/projects/${op.pid}/items/${op.iid}`, { method: "DELETE" });
      return;
    case "comment":
      await api(`/t/${op.tid}/projects/${op.pid}/items/${op.iid}/comments`, { method: "POST", body: { body: op.text } });
      return;
    case "approve_option":
      await api(`/t/${op.tid}/projects/${op.pid}/items/${op.iid}/approve`, { method: "POST", body: { version: await itemVersion(op.tid, op.pid, op.iid), conditions: op.conditions } });
      return;
    case "invite":
      await api(`/t/${op.tid}/members/invite`, { method: "POST", body: { people: op.people } });
      return;
    case "update_member": {
      const { tid, uid, op: _, ...patch } = op;
      const m = (await api<{ userId: string; version: number }[]>(`/t/${tid}/members`)).find((x) => x.userId === uid);
      if (!m) throw new Error("That person isn't in this organization.");
      await api(`/t/${tid}/members/${uid}`, { method: "PATCH", body: { version: m.version, ...patch } });
      return;
    }
    case "update_me": {
      const { op: _, ...patch } = op;
      const me = await api<Me>("/me");
      await api("/me", { method: "PATCH", body: { version: me.user.version, ...patch } });
      return;
    }
  }
}
