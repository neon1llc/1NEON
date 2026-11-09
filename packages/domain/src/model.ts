// packages/domain/src/model.ts - The 1NEON domain: organizations (tenants), people, projects, and
// the four layers. Schemas are shared by the web app and the API, so validation is identical on
// both sides.


import { z } from "zod";


// Shared field shapes. IDs are URL-safe because they appear in routes and keys
export const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const isoDate = z.string().datetime({ offset: true });
export const email = z.string().trim().toLowerCase().email().max(254);


/** Access level inside one organization. Titles and project roles never grant access */
export const AccessLevel = z.enum(["viewer", "editor", "admin"]);
export type AccessLevel = z.infer<typeof AccessLevel>;


/** The four layers of every project: Needs, Execute, Observe, Normalize. Normalize is stored
 * as "next", its earlier name; Execute and Observe keep the keys "execution" and "observation" */
export const Layer = z.enum(["needs", "execution", "observation", "next"]);
export type Layer = z.infer<typeof Layer>;


/** How a project is going, set by the team and shown on every card */
export const Health = z.enum(["on_track", "at_risk", "off_track", "not_started"]);
export type Health = z.infer<typeof Health>;


/** Every stored record carries a version for optimistic concurrency */
const versioned = {
  version: z.number().int().nonnegative(),
  createdAt: isoDate,
  updatedAt: isoDate,
  updatedBy: id,
};


/** One column of an organization's workflow board; each stage belongs to one layer */
export const Stage = z.object({
  id: id,
  name: z.string().trim().min(1).max(40),
  layer: Layer,
  exit: z.string().max(200).default(""),
  wipLimit: z.number().int().positive().max(99).optional(),
  hidden: z.boolean().default(false),
});
export type Stage = z.infer<typeof Stage>;


/** An organization (tenant). Slug and client ID are its public handles; its ID scopes every key */
export const Tenant = z.object({
  id: id,
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
  clientId: z.string().regex(/^N1-\d{4}$/),
  name: z.string().trim().min(1).max(80),
  status: z.enum(["active", "archived"]),
  stages: z.array(Stage).min(1).max(20),
  ...versioned,
});
export type Tenant = z.infer<typeof Tenant>;


/** Display theme. Awake (light) is the default; "device" follows the device's light or dark setting */
export const Theme = z.enum(["awake", "device", "matrix"]);
export type Theme = z.infer<typeof Theme>;


/** A stored theme as it reads today. Records from before "device" existed said "system", which now
 * reads as awake, so people land on the default until they choose device matching again */
export function themeOf(stored: unknown): Theme {
  return stored === "device" || stored === "matrix" ? stored : "awake";
}


/** The menu as it reads today: only a saved "mini" keeps the slim menu showing */
export function menuOf(stored: unknown): "default" | "mini" {
  return stored === "mini" ? "mini" : "default";
}


/** A person, across organizations. Operator and strong sign-in come from sign-in, never from a form */
/** Where someone is with the welcome tour; missing means they haven't seen it */
export const Tour = z.enum(["new", "later", "done"]);


export const User = z.object({
  id: id,
  email: email,
  name: z.string().trim().max(80).default(""),
  title: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(32).default(""),
  operator: z.boolean().default(false),
  // Whether a passkey or authenticator is enrolled, as last seen: a display hint only. Nothing is
  // authorized from it; factor changes read the live inventory and admin actions read the session
  strongAuth: z.boolean().default(false),
  theme: Theme.default("awake"),
  // "default" opens the full menu from a button; "mini" keeps a slim icon menu on screen as well.
  // Older records say "rail" or "hidden" (from before 2026-11-09); both read as default (menuOf)
  menu: z.enum(["default", "mini", "rail", "hidden"]).default("default"),
  // The welcome tour: not yet seen, asked to see it at the next sign-in, or finished or skipped
  tour: Tour.optional(),
  // Set once a passkey is added through the profile, so the portal can offer it to confirm
  passkey: z.boolean().optional(),
  // Which notifications reach this person by email or text; missing groups use their defaults
  notify: z.record(z.string().max(24), z.object({ email: z.boolean(), sms: z.boolean() })).optional(),
  // When this person agreed to texts, and under which version of the wording; texts are never sent without it
  smsConsentAt: isoDate.optional(),
  smsPolicy: z.string().max(20).optional(),
  // The number a text code proved this person holds (E.164), and when. Texts go only there, and only
  // while it is still the profile's number; changing the number clears all three of these fields
  smsPhone: z.string().max(16).optional(),
  smsVerifiedAt: isoDate.optional(),
  // Set when the carrier reports a STOP from this number; agreeing again clears it
  smsOptedOutAt: isoDate.optional(),
  // When text-message codes were turned on as a way to confirm it's you. They count only while the
  // verified number above is ready for texts (sms.ts smsFactorOn), so a new number switches them off
  smsFactorAt: isoDate.optional(),
  ...versioned,
});
export type User = z.infer<typeof User>;


/** A person's membership in one organization; access lives here, not on the user */
export const MemberStatus = z.enum(["invited", "joined", "deactivated"]);
// Where an invitation email stands: waiting in the outbox, handed to the mail service, or given up on
export const InviteDelivery = z.enum(["queued", "sent", "failed"]);
export const Member = z.object({
  tenantId: id,
  userId: id,
  email: email,
  name: z.string().max(80).default(""),
  title: z.string().max(80).default(""),
  access: AccessLevel,
  status: MemberStatus,
  invitedBy: id,
  invitedAt: isoDate,
  joinedAt: isoDate.optional(),
  lastSeenAt: isoDate.optional(),
  // When this person last opened their notifications here; newer events count as new
  seenAt: isoDate.optional(),
  // The latest invitation email: its state and when it was queued (resends are rate limited by it)
  invite: z.object({ state: InviteDelivery, queuedAt: isoDate, sentAt: isoDate.optional() }).optional(),
  ...versioned,
});
export type Member = z.infer<typeof Member>;


/** What someone does on a project. Roles describe; they never grant access */
export const ProjectRole = z.enum([
  "lead_engineer",
  "sponsor",
  "decision_maker",
  "tech_contact",
  "stakeholder",
  "observer",
]);
export type ProjectRole = z.infer<typeof ProjectRole>;


/** A project. `key` (FLOW-1) is its human handle; `rank` orders it within its stage column */
export const Project = z.object({
  tenantId: id,
  id: id,
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,5}-\d{1,4}$/),
  name: z.string().trim().min(1).max(120),
  summary: z.string().max(500).default(""),
  outcome: z.string().max(500).default(""),
  template: z.string().max(40).default("blank"),
  stageId: id,
  stageEnteredAt: isoDate,
  health: Health,
  rank: z.string().min(1).max(64),
  targetDate: z.string().date().optional(),
  people: z.array(z.object({ userId: id, role: ProjectRole })).max(50).default([]),
  // Sensitive data flags: neon1 doesn't touch PII, PHI, or payment data without the right agreements
  flags: z.array(z.enum(["pii", "phi", "payment"])).default([]),
  archived: z.boolean().default(false),
  // Set when moved to Trash; the project then disappears from every view
  deletedAt: isoDate.optional(),
  ...versioned,
});
export type Project = z.infer<typeof Project>;


/** Items inside a project's layers share one shape with a kind discriminator */
export const ItemKind = z.enum([
  "request", // Needs: intake from anyone in the org
  "discovery", // Needs: guided question and answer
  "asset", // Needs: systems, accounts, vendors, data (never secrets)
  "requirement", // Needs: must / should / could
  "option", // Needs: a proposal option scored on cost, quality, effort
  "decision", // Needs: immutable record of the approved option
  "file_request", // Needs: "please upload X"
  "task", // Execute
  "milestone", // Execute
  "change", // Execute: change request against the decision
  "update", // Execute: health update
  "metric", // Observe
  "check", // Observe
  "incident", // Observe
  "handoff", // Normalize: checklist item
  "runbook", // Normalize
  "training", // Normalize
  "care", // Normalize: care plan
  "retro", // Normalize
]);
export type ItemKind = z.infer<typeof ItemKind>;


/** Which layer tab each kind of item lives under */
export const KIND_LAYER: Record<ItemKind, Layer> = {
  request: "needs",
  discovery: "needs",
  asset: "needs",
  requirement: "needs",
  option: "needs",
  decision: "needs",
  file_request: "needs",
  task: "execution",
  milestone: "execution",
  change: "execution",
  update: "execution",
  metric: "observation",
  check: "observation",
  incident: "observation",
  handoff: "next",
  runbook: "next",
  training: "next",
  care: "next",
  retro: "next",
};


/** Statuses a person may set on each kind; "approved" comes only from the approve route */
export const STATUSES: Partial<Record<ItemKind, readonly string[]>> = {
  option: ["draft", "proposed", "declined"],
  decision: [],
};
// Every other kind is a simple work item
export const WORK_STATUSES = ["open", "doing", "blocked", "done"] as const;


/** May a person set `status` on an item of `kind`? */
export function settableStatus(kind: ItemKind, status: string) {
  return (STATUSES[kind] ?? WORK_STATUSES).includes(status);
}


/** A 1 to 5 score used to compare options */
export const Score = z.number().int().min(1).max(5);


/** One item in a project layer: a question, task, option, measure, and so on */
export const Item = z.object({
  tenantId: id,
  projectId: id,
  id: id,
  kind: ItemKind,
  title: z.string().trim().min(1).max(160),
  body: z.string().max(20_000).default(""),
  status: z.string().max(24).default("open"),
  rank: z.string().max(64).default("m"),
  assigneeId: id.optional(),
  dueDate: z.string().date().optional(),
  /** Kind-specific fields, validated by `itemFields` below */
  fields: z.record(z.string(), z.unknown()).default({}),
  ...versioned,
});
export type Item = z.infer<typeof Item>;


// Kind-specific fields. Unknown kinds store free-form fields
export const OptionFields = z.object({
  cost: z.string().max(80).default(""),
  costScore: Score.default(3),
  qualityScore: Score.default(3),
  effortScore: Score.default(3),
  timeline: z.string().max(80).default(""),
  recommended: z.boolean().default(false),
});


// The material terms of an option exactly as approved, copied into the decision at approval time
export const DecisionTerms = z.object({
  title: z.string().max(160),
  body: z.string().max(8000).default(""),
  cost: z.string().max(80).default(""),
  timeline: z.string().max(80).default(""),
  costScore: Score.optional(),
  qualityScore: Score.optional(),
  effortScore: Score.optional(),
  recommended: z.boolean().optional(),
});
export type DecisionTerms = z.infer<typeof DecisionTerms>;


// A decision is its own record of what was agreed: the option and version it came from, who approved
// and when (with their name and email as they were then), and a copy of the terms. Decisions made
// before terms were copied have no `terms`; their exact wording wasn't kept and is never backfilled
export const DecisionFields = z.object({
  optionId: id,
  optionVersion: z.number().int(),
  approvedBy: id,
  approvedAt: isoDate,
  conditions: z.string().max(2000).default(""),
  terms: DecisionTerms.optional(),
  approverName: z.string().max(80).optional(),
  approverEmail: z.string().max(254).optional(),
  // Earlier decisions on the same project that this one replaces; they stay readable as they were
  supersedes: z.array(id).max(50).optional(),
});


// A measure: unit, which direction is better, baseline, target, and dated readings
export const MetricFields = z.object({
  category: z
    .enum(["performance", "reliability", "cost", "security", "adoption", "sla", "delivery"])
    .default("performance"),
  unit: z.string().max(24).default(""),
  direction: z.enum(["up", "down"]).default("up"),
  baseline: z.number().optional(),
  baselineDate: z.string().date().optional(),
  target: z.number().optional(),
  targetDate: z.string().date().optional(),
  readings: z.array(z.object({ at: z.string().date(), value: z.number(), note: z.string().max(200).default("") })).max(500).default([]),
});


// Requirement priority (MoSCoW) and the health a status update reports
export const RequirementFields = z.object({ priority: z.enum(["must", "should", "could"]).default("should") });
export const UpdateFields = z.object({ health: Health });


// Which kinds validate their fields, and with which schema
export const itemFields: Partial<Record<ItemKind, z.ZodType>> = {
  option: OptionFields,
  decision: DecisionFields,
  metric: MetricFields,
  requirement: RequirementFields,
  update: UpdateFields,
};


/**
 * Where a file stands: receiving (link issued, bytes not confirmed), checking (bytes arrived, waiting
 * for the malware scan and a size check), ready (clean, the right size, downloadable), rejected (the
 * scan found a threat), or failed (bytes missing, the wrong size, or a scan that couldn't finish)
 */
export const FileState = z.enum(["receiving", "checking", "ready", "rejected", "failed"]);
export type FileState = z.infer<typeof FileState>;
/** Why a file failed, as a safe code the page turns into words */
export const FileProblem = z.enum(["missing", "size_mismatch", "scan_failed", "scan_unsupported", "timeout"]);
export type FileProblem = z.infer<typeof FileProblem>;


/**
 * File types a browser may show in a tab ("open" on a file). Only inert formats: never HTML, SVG, or
 * anything that runs script, so an uploaded file can't act as a page. Everything else downloads
 */
export const VIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"]);


/** A file's record. Bytes live in S3 under the organization's folder; `scan` gates downloads.
 * Without a project it's a general file for the organization; with `itemId` it answers a "file needed" item */
export const DocumentRecord = z.object({
  tenantId: id,
  projectId: id.optional(),
  itemId: id.optional(),
  id: id,
  name: z.string().trim().min(1).max(200),
  layer: Layer,
  contentType: z.string().max(120),
  size: z.number().int().nonnegative(),
  key: z.string().max(512),
  scan: z.enum(["pending", "clean", "infected"]),
  needsApproval: z.boolean().default(false),
  // True once the file is ready; kept for older records and callers that only ask "is it there"
  uploaded: z.boolean().default(false),
  // Missing on records from before states existed: those read as ready if uploaded, else receiving
  state: FileState.optional(),
  problem: FileProblem.optional(),
  ...versioned,
});
export type DocumentRecord = z.infer<typeof DocumentRecord>;


/** A file's state, reading older records by their `uploaded` flag */
export function fileState(x: Pick<DocumentRecord, "state" | "uploaded">): FileState {
  return x.state ?? (x.uploaded ? "ready" : "receiving");
}


/** Who did what, when. Written in the same transaction as the change it describes */
export const AuditEvent = z.object({
  tenantId: id,
  at: isoDate,
  id: id,
  actorId: id,
  action: z.string().max(40),
  target: z.string().max(160),
  summary: z.string().max(300),
});
export type AuditEvent = z.infer<typeof AuditEvent>;


/** Metric progress: (latest - baseline) / (target - baseline), clamped to 0..1 */
/** Which way is better: a target below the baseline always means lower is better, whatever was stored */
export function betterWhen(m: z.infer<typeof MetricFields>): "up" | "down" {
  if (m.baseline !== undefined && m.target !== undefined && m.target !== m.baseline) return m.target < m.baseline ? "down" : "up";
  return m.direction;
}


export function metricProgress(m: z.infer<typeof MetricFields>): number | undefined {
  const latest = m.readings.at(-1)?.value;
  if (latest === undefined || m.baseline === undefined || m.target === undefined) return undefined;
  if (m.target === m.baseline) return latest === m.target ? 1 : 0;
  const p = (latest - m.baseline) / (m.target - m.baseline);
  return Math.max(0, Math.min(1, p));
}
