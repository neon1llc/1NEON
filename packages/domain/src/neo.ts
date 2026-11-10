// packages/domain/src/neo.ts - Neo inside 1NEON: the conversation the window sends, and what comes
// back. A reply can carry a tour to show and a plan of actions to offer. Neo never acts itself: a plan
// runs in the person's own browser, step by step, through the same API calls the pages make, only
// after the person says yes. Shared by the API (which checks what the model wrote) and the window
// (which checks it again before showing or running it).


import { z } from "zod";
import { AccessLevel, Health, ItemKind, Theme, id } from "./model.ts";


// --- The conversation -----------------------------------------------------------------

/** Limits on what the window sends: turns alternate, start and end with the person */
export const NEO_LIMITS = { turns: 13, chars: 2000, total: 12_000 } as const;

const Turn = z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(NEO_LIMITS.chars) });

/** A question: the recent turns, and where the person is in the portal right now */
export const NeoAsk = z.object({
  messages: z.array(Turn).min(1).max(NEO_LIMITS.turns),
  // The address in the browser, under /1NEON (for example /o/acme-dental/projects/FLOW-1/needs)
  where: z.string().max(300).regex(/^\/[A-Za-z0-9/_#?=&.-]*$/).default("/"),
}).superRefine((a, ctx) => {
  a.messages.forEach((m, i) => {
    if (m.role !== (i % 2 ? "assistant" : "user")) ctx.addIssue({ code: "custom", message: "Turns must alternate, starting with the person." });
  });
  if (a.messages.at(-1)?.role !== "user") ctx.addIssue({ code: "custom", message: "The last turn must be the person's." });
  if (a.messages.reduce((n, m) => n + m.content.length, 0) > NEO_LIMITS.total) ctx.addIssue({ code: "custom", message: "conversation_too_long" });
});
export type NeoAsk = z.infer<typeof NeoAsk>;


// --- Tours ------------------------------------------------------------------------------

/** One stop on a tour: the page to open (under /1NEON), the spot to point at, and two short lines */
export const NeoTourStep = z.object({
  path: z.string().max(300).regex(/^\/(o|all|me)[A-Za-z0-9/_#?=&.-]*$/),
  // A data-tour anchor on that page; without one the step is a popover in the middle of the page
  at: z.string().max(40).regex(/^[a-z-]+$/).optional(),
  title: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(300),
});
export const NeoTour = z.object({ title: z.string().trim().min(1).max(80), steps: z.array(NeoTourStep).min(1).max(12) });
export type NeoTour = z.infer<typeof NeoTour>;


// --- Plans ------------------------------------------------------------------------------

// The values a step names. Organization (tid), project (pid), item (iid), and person (uid) IDs come
// from what Neo read, never from what the person typed
const date = z.string().date();
const Person = z.object({ email: z.string().trim().toLowerCase().email().max(254), name: z.string().trim().max(80).default(""), access: AccessLevel.default("editor") });

/**
 * Every action a plan may hold. Each maps to exactly one API call the pages already make (lib/neo
 * in the web app), so every permission, confirmation, and version check still applies. Anything
 * else (uploading a file, adding a passkey, trashing a project, changing stages) is a `go` step that
 * opens the page where the person does it.
 */
export const NeoOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("go"), path: z.string().max(300).regex(/^\/(o|all|me)[A-Za-z0-9/_#?=&.-]*$/) }),
  z.object({ op: z.literal("create_project"), tid: id, name: z.string().trim().min(1).max(120), template: z.string().max(40).default("blank"), summary: z.string().max(500).default(""), outcome: z.string().max(500).default(""), targetDate: date.optional() }),
  z.object({ op: z.literal("update_project"), tid: id, pid: id, name: z.string().trim().min(1).max(120).optional(), summary: z.string().max(500).optional(), outcome: z.string().max(500).optional(), health: Health.optional(), targetDate: date.nullable().optional(), archived: z.boolean().optional() }),
  z.object({ op: z.literal("move_project"), tid: id, pid: id, stageId: id, reason: z.string().max(300).optional() }),
  z.object({ op: z.literal("post_update"), tid: id, pid: id, title: z.string().trim().min(1).max(160), health: Health }),
  z.object({ op: z.literal("add_item"), tid: id, pid: id, kind: ItemKind.exclude(["decision", "option", "update"]), title: z.string().trim().min(1).max(160), body: z.string().max(4000).default(""), status: z.string().max(24).optional(), assigneeId: id.optional(), dueDate: date.optional() }),
  z.object({ op: z.literal("update_item"), tid: id, pid: id, iid: id, title: z.string().trim().min(1).max(160).optional(), body: z.string().max(4000).optional(), status: z.string().max(24).optional(), assigneeId: id.nullable().optional(), dueDate: date.nullable().optional() }),
  z.object({ op: z.literal("delete_item"), tid: id, pid: id, iid: id }),
  z.object({ op: z.literal("comment"), tid: id, pid: id, iid: id, text: z.string().trim().min(1).max(4000) }),
  z.object({ op: z.literal("approve_option"), tid: id, pid: id, iid: id, conditions: z.string().max(2000).default("") }),
  z.object({ op: z.literal("invite"), tid: id, people: z.array(Person).min(1).max(20) }),
  z.object({ op: z.literal("update_member"), tid: id, uid: id, access: AccessLevel.optional(), title: z.string().trim().max(80).optional(), status: z.enum(["joined", "deactivated"]).optional() }),
  z.object({ op: z.literal("update_me"), name: z.string().trim().max(80).optional(), title: z.string().trim().max(80).optional(), theme: Theme.optional(), menu: z.enum(["default", "mini"]).optional() }),
]);
export type NeoOp = z.infer<typeof NeoOp>;

/** One step: what it does in plain words, and the action itself */
export const NeoStep = z.object({ say: z.string().trim().min(1).max(200), action: NeoOp });
export type NeoStep = z.infer<typeof NeoStep>;

/** A plan offered with "Want me to do it?"; nothing runs until the person says yes */
export const NeoPlan = z.object({ title: z.string().trim().min(1).max(100), steps: z.array(NeoStep).min(1).max(12) });
export type NeoPlan = z.infer<typeof NeoPlan>;

/** Actions that change something that can't simply be edited back, so the plan says so before running */
export const LASTING_OPS: ReadonlySet<NeoOp["op"]> = new Set(["approve_option", "delete_item", "invite", "update_member"]);


// --- The answer -------------------------------------------------------------------------

/** What the window gets back: the reply to show, and optionally a tour and a plan to offer */
export interface NeoReply {
  reply: string;
  tour?: NeoTour;
  plan?: NeoPlan;
}
