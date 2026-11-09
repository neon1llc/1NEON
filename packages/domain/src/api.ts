// packages/domain/src/api.ts - Request bodies for the API, shared with the web client.


import { NotifyPrefs } from "./notify.ts";
import { z } from "zod";
import { AccessLevel, Health, ItemKind, Layer, ProjectRole, Theme, Tour, email, id } from "./model.ts";


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


// Approval pins the option version shown to the approver
export const ApproveInput = z.object({ version: z.number().int(), conditions: z.string().max(2000).default("") });


// The signed-in person's own profile
export const UpdateMeInput = z.object({
  version: z.number().int(),
  name: z.string().trim().max(80).optional(),
  title: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(32).optional(),
  theme: Theme.optional(),
  menu: z.enum(["rail", "hidden"]).optional(),
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
