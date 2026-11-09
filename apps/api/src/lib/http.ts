// apps/api/src/lib/http.ts - Request plumbing every route shares: per-request values, JSON errors,
// body parsing, permission checks, and small pure helpers.


import { KIND_LAYER, can, itemFields, type AccessLevel, type Action, type Actor, type Item, type Tenant, type User } from "@1neon/domain";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";


/** The signed-in person and the actor that permission checks use */
export interface Who {
  user: User;
  actor: Actor;
  // The sign-in session, for marking it strong after a passkey or authenticator check
  jti?: string;
}


// Per-request values set by middleware: who is calling, and the tenant a /t/:tid route resolved
export type Env = { Variables: { who: Who; tenant: Tenant; access: AccessLevel | undefined } };


// Timestamps are ISO strings in UTC, as the schemas expect
export const now = () => new Date().toISOString();


/** Stop the request with a JSON error the web app can show as written */
export function fail(status: 400 | 401 | 403 | 404 | 409 | 410 | 412 | 428 | 429 | 503, error: string, message: string, current?: unknown): never {
  throw new HTTPException(status, { res: Response.json({ error, message, current }, { status }) });
}


/** Parse and validate a JSON body; validation messages name the field that failed */
export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => fail(400, "bad_json", "The request body isn't valid JSON."));
  const r = schema.safeParse(raw);
  if (!r.success) fail(400, "invalid", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}


// Status and wording for each permission refusal from can()
export const REASONS = {
  not_member: [404, "not_found", "That organization doesn't exist, or you don't have access to it."],
  forbidden: [403, "forbidden", "Your access level doesn't allow that."],
  strong_auth_required: [403, "strong_auth_required", "Confirm it's you with your passkey, authenticator app, or a texted code (or set one up on your profile), then try again."],
  read_only_view: [403, "read_only", "All clients is read only. Open the organization to make changes."],
  not_decider: [403, "not_decider", "Only this project's decision maker can approve. An admin can name one on the project."],
  decider_admin_only: [403, "decider_admin_only", "Only an admin of this organization can name or change the decision maker."],
} as const;


/** Turn a permission refusal into the matching HTTP error */
export function check(d: ReturnType<typeof can>) {
  if (!d.ok) {
    const [status, error, message] = REASONS[d.reason];
    fail(status, error, message);
  }
}


// --- Caller shorthands (valid once the identity middleware has run) ----------

// The caller set by the identity middleware
export const who = (c: Context<Env>) => c.get("who");
// Shorthand for a permission check inside a tenant route
export const need = (c: Context<Env>, action: Action) => check(can(who(c).actor, action, c.get("access")));
// Who to record in updatedBy and the audit log
export const actorId = (c: Context<Env>) => who(c).user.id;


// --- Pure helpers --------------------------------------------------------------

/** Validate kind-specific fields; kinds without a schema keep free-form fields */
export function validateFields(kind: Item["kind"], fields: Record<string, unknown>) {
  const schema = itemFields[kind];
  if (!schema) return fields;
  const r = schema.safeParse(fields);
  if (!r.success) fail(400, "invalid", r.error.issues.map((i) => `fields.${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data as Record<string, unknown>;
}


// Board and list order
export const byRank = (a: { rank: string }, b: { rank: string }) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);


/** Drop undefined values so a partial update never blanks a field */
export function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}


/** Readable item kind for audit summaries, such as "file request (needs)" */
export function label(kind: Item["kind"]) {
  return `${kind.replace("_", " ")} (${KIND_LAYER[kind]})`;
}


// DynamoDB's limit on writes in one transaction
export const MAX_TRANSACTION = 100;
