// packages/domain/src/notify.ts - Notifications: every audit event belongs to one group, and each
// group has an importance and default email and text choices that people can change in their profile.


import { z } from "zod";


/** How much a notification matters: critical ones email by default, info ones never light the bell */
export type Level = "critical" | "normal" | "info";


/** One kind of notification, the audit actions it covers, and its defaults */
export interface NotifyGroup {
  id: string;
  label: string;
  hint: string;
  level: Level;
  email: boolean;
  match: (action: string) => boolean;
}


// In order of importance; the first group whose match accepts an action owns it
export const NOTIFY_GROUPS: NotifyGroup[] = [
  { id: "files", label: "Files", hint: "A file is uploaded or removed", level: "critical", email: true, match: (a) => a.startsWith("doc.") },
  { id: "access", label: "People and access", hint: "Someone is invited, joins, or gets a different access level", level: "critical", email: true, match: (a) => a === "member.invited" || a === "member.joined" || a === "member.updated" },
  { id: "decisions", label: "Decisions and options", hint: "An option is proposed, approved, or changed to another, a proposal is issued, or a refresh is asked for", level: "critical", email: true, match: (a) => a === "decision.approved" || a === "decision.changed" || a.startsWith("option.") || a === "proposal.issued" || a === "proposal.refresh_asked" || a === "purchase.agreed" || a === "handoff.accepted" },
  { id: "billing", label: "Agreements, invoices, and payments", hint: "The service agreement is signed, an invoice is issued or voided, or a payment starts, arrives, or fails", level: "critical", email: true, match: (a) => a === "agreement.signed" || a === "invoice.issued" || a === "invoice.voided" || a.startsWith("payment.") },
  { id: "workflow", label: "Workflow and stages", hint: "A project moves stage, or the board's stages change", level: "critical", email: true, match: (a) => a === "project.moved" || a === "org.stages" || a === "project.created" || a === "project.trashed" },
  // Comments come before the item catch-all below, whose pattern would otherwise claim comment.created
  { id: "comments", label: "Comments", hint: "Someone comments on an item", level: "normal", email: false, match: (a) => a === "comment.created" },
  { id: "updates", label: "Updates and items", hint: "Status updates, requests, tasks, measures, calendar events, and other items", level: "normal", email: false, match: (a) => /^[a-z_]+\.(created|updated|deleted)$/.test(a) || a === "project.updated" },
  { id: "signins", label: "Sign-ins", hint: "Someone in the organization signs in", level: "info", email: false, match: (a) => a === "member.signedin" },
];


/**
 * Records a person signs: they get a copy too, though they did it themselves, so what they agreed to
 * reaches their inbox and their bell (a notice about anything else skips the person who acted)
 */
export const RECEIPTS = new Set(["decision.approved", "decision.changed", "agreement.signed", "handoff.accepted", "purchase.agreed"]);

/** Does the person who acted hear about it too? Signed records always; in neon1's own organization,
 * where neon1 is its own client, the billing that a client would hear about as well */
export const actorHears = (action: string, ownOrg: boolean) => RECEIPTS.has(action) || (ownOrg && groupOf(action).id === "billing");

/** Actions only neon1 hears about: its own working drafts, which a client sees once issued */
export const neon1Only = (action: string) => action === "invoice.drafted";


/**
 * The wording of a notice to a person (bell and email). The stored audit summary keeps "Proposal 0041-r1"
 * so numbering and hashes never change; on a quick fix, whose client reads a quote, the notice says
 * "Quote 0041-r1" instead. Only the proposal's reference is reworded, and only when `quick` is true
 */
export const noticeSummary = (summary: string, quick: boolean) => (quick ? summary.replace(/\bProposal (?=\d{4,}-r\d+)/g, "Quote ") : summary);

/** The group an audit action belongs to; unknown actions count as updates */
export function groupOf(action: string): NotifyGroup {
  return NOTIFY_GROUPS.find((g) => g.match(action)) ?? NOTIFY_GROUPS.find((g) => g.id === "updates")!;
}


/** A person's choices per group; missing groups use the group's defaults */
export const NotifyPrefs = z.record(z.string().max(24), z.object({ email: z.boolean(), sms: z.boolean() }));
export type NotifyPrefs = z.infer<typeof NotifyPrefs>;


/** Should this person get an email (or a text) for this action? */
export function wants(prefs: NotifyPrefs | undefined, action: string, channel: "email" | "sms"): boolean {
  const g = groupOf(action);
  const mine = prefs?.[g.id];
  return mine ? mine[channel] : channel === "email" ? g.email : false;
}
