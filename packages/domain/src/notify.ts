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
  { id: "decisions", label: "Decisions and options", hint: "An option is proposed or approved", level: "critical", email: true, match: (a) => a === "decision.approved" || a.startsWith("option.") },
  { id: "workflow", label: "Workflow and stages", hint: "A project moves stage, or the board's stages change", level: "critical", email: true, match: (a) => a === "project.moved" || a === "org.stages" || a === "project.created" || a === "project.trashed" },
  // Comments come before the item catch-all below, whose pattern would otherwise claim comment.created
  { id: "comments", label: "Comments", hint: "Someone comments on an item", level: "normal", email: false, match: (a) => a === "comment.created" },
  { id: "updates", label: "Updates and items", hint: "Status updates, requests, tasks, measures, and other items", level: "normal", email: false, match: (a) => /^[a-z_]+\.(created|updated|deleted)$/.test(a) || a === "project.updated" },
  { id: "signins", label: "Sign-ins", hint: "Someone in the organization signs in", level: "info", email: false, match: (a) => a === "member.signedin" },
];


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
