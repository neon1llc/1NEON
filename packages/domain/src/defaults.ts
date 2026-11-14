// packages/domain/src/defaults.ts - Defaults every new organization and project starts from:
// stages, names, and templates.


import type { ItemKind, Stage } from "./model.ts";


/** Default workflow: the neon1 lifecycle, each stage tied to one layer */
export const DEFAULT_STAGES: Stage[] = [
  { id: "intake", name: "Intake", layer: "needs", exit: "Fit call held", hidden: false },
  { id: "listen", name: "Listen", layer: "needs", exit: "Discovery complete, baseline metrics recorded", hidden: false },
  { id: "propose", name: "Propose", layer: "needs", exit: "Options published to the client", hidden: false },
  { id: "decide", name: "Decide", layer: "needs", exit: "An option approved", hidden: false },
  { id: "build", name: "Build", layer: "execution", exit: "All milestone tasks done", wipLimit: 3, hidden: false },
  { id: "verify", name: "Verify", layer: "observation", exit: "Checks pass, after metrics recorded", hidden: false },
  { id: "handover", name: "Hand over", layer: "next", exit: "Handover accepted", hidden: false },
  { id: "care", name: "Care", layer: "next", exit: "Ongoing care, or closed", hidden: false },
  { id: "closed", name: "Closed", layer: "next", exit: "", hidden: false },
];


// Display names. The two N layers share a letter, so badges also use color. Normalize keeps the
// key "next" from when the layer had that name, so stored records need no migration
export const LAYER_NAMES = {
  needs: "Needs",
  execution: "Execute",
  observation: "Observe",
  next: "Normalize",
} as const;


// One letter per layer for badges
export const LAYER_LETTER = { needs: "N", execution: "E", observation: "O", next: "N" } as const;


// Labels for project roles in the People list and project sidebar
export const PROJECT_ROLE_NAMES = {
  lead_engineer: "Lead engineer",
  sponsor: "Sponsor",
  decision_maker: "Decision maker",
  tech_contact: "Tech contact",
  stakeholder: "Stakeholder",
  observer: "Observer",
} as const;


/** An item a template adds to a new project */
export interface TemplateItem {
  kind: ItemKind;
  title: string;
  body?: string;
  fields?: Record<string, unknown>;
  // The status it starts in, when the kind's usual one won't do (an option starts as a draft)
  status?: string;
}


/** A project template: key prefix for project keys and the items it starts with */
export interface Template {
  id: string;
  name: string;
  keyPrefix: string;
  summary: string;
  items: TemplateItem[];
}


// Discovery questions and the handoff checklist every real project needs. The wizard already asks
// for one real example, so it isn't repeated here
const common: TemplateItem[] = [
  { kind: "discovery", title: "Who does this work, and how often?" },
  { kind: "discovery", title: "What would 'better' look like in three months?" },
  { kind: "handoff", title: "Accounts are in the client's name" },
  { kind: "handoff", title: "Admin access transferred to the client" },
  { kind: "handoff", title: "Docs delivered and walked through" },
  { kind: "handoff", title: "The people who use it are trained on it" },
  { kind: "handoff", title: "Older tools it replaces retired or merged, and leftovers cleaned up" },
  { kind: "handoff", title: "neon1 access reduced or removed" },
];


// --- Quick fix ------------------------------------------------------------------------
// A small job of a few hours on the same model as any project: one option shaped as a quote, nothing
// up front, and one handover step. The client still signs the quote (a decision with its terms copied
// in) and accepts the step, so the invoice, audit, and hashes work exactly as they do for a full project.
// Only the words and the screens are lighter. No new kinds or fields: it's a template and a label


/** The template ID that marks a project as a quick fix */
export const QUICK_FIX = "quick_fix";

/** Is this project a quick fix? (its template, set when it was made, never changes) */
export const isQuickFix = (p: { template?: string } | undefined) => p?.template === QUICK_FIX;

/** The usual range of hours a quick fix is quoted at, before neon1 changes it */
export const QUICK_FIX_HOURS = { low: 2, high: 5 } as const;

/** The most hours a quick fix may be quoted at; more than that is a project with its own proposal */
export const QUICK_FIX_MAX_HOURS = 24;

// The quick fix template, listed after the full-project ones in the gallery
const quickFix: Template = {
  id: QUICK_FIX,
  name: "Quick fix",
  keyPrefix: "FIX",
  summary: "A small job of a few hours: one quote, one signature, one invoice when it's fixed.",
  items: [
    // The quote: an hourly estimate capped at its high end until neon1 sets the rate (or a fixed price)
    // in Quote and issue. Nothing up front, so approving drafts no deposit
    {
      kind: "option",
      title: "The fix",
      status: "draft",
      fields: { pricing: "estimate", hoursLow: QUICK_FIX_HOURS.low, hoursHigh: QUICK_FIX_HOURS.high, hours: `${QUICK_FIX_HOURS.low} to ${QUICK_FIX_HOURS.high} hours`, depositPercent: 0, recommended: true },
    },
    // Accepting this one step closes the work and drafts the final invoice
    { kind: "handoff", title: "Fixed and shown working" },
  ],
};


/** The template gallery shown in the New project wizard */
export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank",
    keyPrefix: "PRJ",
    summary: "Start empty and add what you need.",
    items: [],
  },
  {
    id: "cloud_migration",
    name: "Cloud migration",
    keyPrefix: "MIG",
    summary: "Move servers, apps, and files to the cloud without a rewrite.",
    items: [
      ...common,
      { kind: "asset", title: "Servers and what runs on them" },
      { kind: "asset", title: "Where the files and backups live" },
      { kind: "requirement", title: "Daily work keeps running during the move", fields: { priority: "must" } },
      { kind: "metric", title: "Monthly infrastructure cost", fields: { category: "cost", unit: "$", direction: "down" } },
      { kind: "metric", title: "Unplanned downtime per month", fields: { category: "reliability", unit: "hours", direction: "down" } },
      { kind: "check", title: "Backups restored once as a test" },
    ],
  },
  {
    id: "workflow_automation",
    name: "Workflow automation",
    keyPrefix: "FLOW",
    summary: "Take a manual process out of the inbox and into a system.",
    items: [
      ...common,
      { kind: "asset", title: "Tools and inboxes the process touches" },
      { kind: "requirement", title: "Nothing is retyped twice", fields: { priority: "must" } },
      { kind: "metric", title: "Turnaround time", fields: { category: "performance", unit: "hours", direction: "down" } },
      { kind: "metric", title: "Minutes of staff time per item", fields: { category: "performance", unit: "min", direction: "down" } },
    ],
  },
  {
    id: "ai_assistant",
    name: "AI assistant",
    keyPrefix: "AI",
    summary: "Answers from your own approved documents, with sources.",
    items: [
      ...common,
      { kind: "asset", title: "Document sources and who may see them" },
      { kind: "requirement", title: "Answers cite their source and say when they don't know", fields: { priority: "must" } },
      { kind: "metric", title: "Median time to find an answer", fields: { category: "performance", unit: "s", direction: "down" } },
      { kind: "metric", title: "Answers judged correct", fields: { category: "performance", unit: "%", direction: "up" } },
    ],
  },
  {
    id: "security_readiness",
    name: "Security readiness",
    keyPrefix: "SEC",
    summary: "Get ready for SOC 2 or a security review.",
    items: [
      ...common,
      { kind: "asset", title: "Systems in scope" },
      { kind: "requirement", title: "MFA on every admin account", fields: { priority: "must" } },
      { kind: "metric", title: "Open findings (high and critical)", fields: { category: "security", unit: "findings", direction: "down" } },
      { kind: "check", title: "Access review" },
    ],
  },
  {
    id: "personal_tech",
    name: "Personal or home tech",
    keyPrefix: "HOME",
    summary: "Devices, accounts, network, and staying safe online.",
    items: [
      { kind: "discovery", title: "What's not working, in your own words" },
      { kind: "asset", title: "Devices and accounts involved" },
      { kind: "handoff", title: "Written steps left behind" },
    ],
  },
  quickFix,
];


/** The template with this ID, or Blank for unknown IDs */
export function templateById(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}
