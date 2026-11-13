// packages/domain/src/api.ts - Request bodies for the API, shared with the web client.


import { NotifyPrefs } from "./notify.ts";
import { InvoiceLine, InvoiceType, PaymentMethod, SignInput } from "./billing.ts";
import { z } from "zod";
import { AccessLevel, CalEventKind, CalRepeat, Health, ItemKind, Layer, ProjectRole, Theme, Tour, email, id } from "./model.ts";


// Organizations (operator only)
export const CreateTenantInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/).optional(),
});


// People
export const InviteInput = z.object({
  people: z
    .array(
      z.object({
        email: email,
        name: z.string().trim().max(80).default(""),
        title: z.string().trim().max(80).default(""),
        access: AccessLevel.default("editor"),
      }),
    )
    .min(1)
    .max(50),
});


// Admins change access, title, or status; the version guards against stale edits
export const UpdateMemberInput = z.object({
  version: z.number().int(),
  access: AccessLevel.optional(),
  title: z.string().trim().max(80).optional(),
  status: z.enum(["joined", "deactivated"]).optional(),
});


// Projects. Every update carries the version the client read, for conflict checks
export const CreateProjectInput = z.object({
  // Chosen once per submit by the browser, so a retry after a lost reply returns the same project
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  name: z.string().trim().min(1).max(120),
  template: z.string().max(40).default("blank"),
  summary: z.string().max(500).default(""),
  outcome: z.string().max(500).default(""),
  example: z.string().max(2000).default(""),
  targetDate: z.string().date().optional(),
  flags: z.array(z.enum(["pii", "phi", "payment"])).default([]),
  people: z.array(z.object({ userId: id, role: ProjectRole })).max(50).default([]),
  metrics: z
    .array(z.object({ title: z.string().trim().min(1).max(160), unit: z.string().max(24).default(""), baseline: z.number().optional(), target: z.number().optional() }))
    .max(10)
    .default([]),
});


// Partial project edit; null clears the target date
export const UpdateProjectInput = z.object({
  version: z.number().int(),
  name: z.string().trim().min(1).max(120).optional(),
  summary: z.string().max(500).optional(),
  outcome: z.string().max(500).optional(),
  health: Health.optional(),
  targetDate: z.string().date().nullable().optional(),
  archived: z.boolean().optional(),
  people: z.array(z.object({ userId: id, role: ProjectRole })).max(50).optional(),
});


// A move names its neighbours; the API computes the new rank between them
export const MoveProjectInput = z.object({
  version: z.number().int(),
  stageId: id,
  before: z.string().max(64).optional(),
  after: z.string().max(64).optional(),
  reason: z.string().max(300).optional(),
});


// Items inside a layer
export const CreateItemInput = z.object({
  kind: ItemKind,
  title: z.string().trim().min(1).max(160),
  body: z.string().max(20_000).default(""),
  status: z.string().max(24).optional(),
  assigneeId: id.optional(),
  dueDate: z.string().date().optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
  // The client's name for this one logical create, kept while its draft exists. Sending it again (a retry
  // after a lost reply, or after part of a batch failed) returns the item already made instead of a
  // second one (EP-04). Scoped to the person and project on the server
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});


// Partial item edit; null clears the assignee or due date
export const UpdateItemInput = z.object({
  version: z.number().int(),
  title: z.string().trim().min(1).max(160).optional(),
  body: z.string().max(20_000).optional(),
  status: z.string().max(24).optional(),
  rank: z.string().max(64).optional(),
  assigneeId: id.nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});


// Approval pins the option version shown to the approver. Initials agree that neon1 buys the items the
// option lists for neon1 to buy, paid back at cost; they're required only when it lists any
// The decision maker signs the approval: typed name and consent. Initials are kept for older callers;
// when neon1 buys items, initials come from the signed name. Changing an earlier decision needs a reason
export const ApproveInput = z.object({ version: z.number().int(), conditions: z.string().max(2000).default(""), reason: z.string().trim().max(1000).default(""), initials: z.string().trim().max(8).optional(), signature: SignInput });

// neon1 issues the next revision of a project's proposal, saying what changed
export const IssueInput = z.object({ note: z.string().trim().max(1000).default("") });

// A decision maker agrees, by initials, that neon1 buys one item to be paid back at cost
export const AgreeInput = z.object({ version: z.number().int(), initials: z.string().trim().min(1).max(8) });

// The client accepts a handover step, with an optional note
export const AcceptInput = z.object({ version: z.number().int(), note: z.string().trim().max(500).default(""), signature: SignInput });


// --- Billing: the service agreement, invoices, and payments ---------------------------

// Signing the service agreement names the edition and hash the signer was shown, so a newer text can't be signed blind
export const SignAgreementInput = SignInput.extend({ edition: z.string().max(16), hash: z.string().regex(/^[0-9a-f]{64}$/) });

// neon1 drafts an invoice; without lines, 1NEON suggests them from the decision or the purchases
export const CreateInvoiceInput = z.object({
  type: InvoiceType,
  lines: z.array(InvoiceLine).min(1).max(100).optional(),
  decisionId: z.string().max(64).optional(),
  appliesTo: z.string().max(64).optional(),
  termsDays: z.number().int().min(0).max(90).optional(),
  note: z.string().trim().max(1000).default(""),
});

// A draft's lines, tax, terms, or note
export const UpdateInvoiceInput = z.object({
  version: z.number().int(),
  lines: z.array(InvoiceLine).min(1).max(100).optional(),
  taxCents: z.number().int().min(0).max(100_000_000).optional(),
  termsDays: z.number().int().min(0).max(90).optional(),
  note: z.string().trim().max(1000).optional(),
});

// Issue a draft, or void an issued invoice with a reason
export const IssueInvoiceInput = z.object({ version: z.number().int() });
export const VoidInvoiceInput = z.object({ version: z.number().int(), reason: z.string().trim().min(3).max(500) });

// A payment neon1 received outside Stripe (check, Zelle, wire), or a bank or card payment Stripe didn't report
export const RecordPaymentInput = z.object({
  amountCents: z.number().int().positive().max(1_000_000_000),
  method: PaymentMethod,
  ref: z.string().trim().max(120).default(""),
  receivedAt: z.string().date(),
});


// The signed-in person's own profile
export const UpdateMeInput = z.object({
  version: z.number().int(),
  name: z.string().trim().max(80).optional(),
  title: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(32).optional(),
  theme: Theme.optional(),
  menu: z.enum(["default", "mini"]).optional(),
  tour: Tour.optional(),
  notify: NotifyPrefs.optional(),
  // Yes or no to texts; the API records when
  smsConsent: z.boolean().optional(),
});


/** Every error the API returns has this shape */
export interface ApiError {
  error: string;
  message: string;
  current?: unknown;
}


/** Start an upload: the record is made first, then the browser sends the bytes straight to storage */
export const CreateDocInput = z.object({
  name: z.string().trim().min(1).max(200),
  contentType: z.string().max(120).default("application/octet-stream"),
  size: z.number().int().positive().max(100 * 1024 * 1024),
  layer: Layer,
  projectId: id.optional(),
  itemId: id.optional(),
});


// A calendar event of the organization's own (model.ts CalEvent); clearing an optional field sends null
export const CreateCalEventInput = z.object({
  title: z.string().trim().min(1).max(120),
  kind: CalEventKind,
  date: z.string().date(),
  endDate: z.string().date().optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  repeat: CalRepeat.default("none"),
  until: z.string().date().optional(),
  personId: id.optional(),
  projectId: id.optional(),
  notes: z.string().max(500).default(""),
});
export const UpdateCalEventInput = z.object({
  version: z.number().int(),
  title: z.string().trim().min(1).max(120).optional(),
  kind: CalEventKind.optional(),
  date: z.string().date().optional(),
  endDate: z.string().date().nullable().optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  repeat: CalRepeat.optional(),
  until: z.string().date().nullable().optional(),
  personId: id.nullable().optional(),
  projectId: id.nullable().optional(),
  notes: z.string().max(500).optional(),
});
