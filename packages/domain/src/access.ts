// packages/domain/src/access.ts - Who may do what: one permission table for the API and the web
// app, tested in domain.test.ts.


import type { AccessLevel } from "./model.ts";


/** Everything a person can try to do. One list, one table, fully tested */
export type Action =
  | "read"
  | "comment"
  | "write" // create and edit projects, items, documents
  | "approve" // approve options, changes, handoffs (also requires being named, see canApprove)
  | "delete" // move projects to trash, delete documents
  | "manage_people" // invite, change access, deactivate
  | "manage_settings" // stages, templates, organization profile
  | "manage_orgs"; // create and archive organizations (operator only)

// Access levels are cumulative: each level adds to the one below
const LEVEL_ACTIONS: Record<AccessLevel, ReadonlySet<Action>> = {
  viewer: new Set(["read", "comment", "approve"]),
  editor: new Set(["read", "comment", "approve", "write"]),
  admin: new Set(["read", "comment", "approve", "write", "delete", "manage_people", "manage_settings"]),
};


/** Admin-only actions also need strong sign-in (passkey or password + authenticator) */
const STRONG_AUTH: ReadonlySet<Action> = new Set(["delete", "manage_people", "manage_settings", "manage_orgs"]);


/** The caller as the API sees them after sign-in */
export interface Actor {
  userId: string;
  operator: boolean;
  // This sign-in session proved a passkey or authenticator recently (session assurance, not enrollment)
  strongSession: boolean;
}


/** A refusal carries its reason so the API can answer 403, 404, or "set up strong sign-in" */
export type Decision = { ok: true } | { ok: false; reason: "not_member" | "forbidden" | "strong_auth_required" | "read_only_view" | "not_decider" };


/**
 * May `actor` do `action` in a tenant where they hold `access` (undefined = not a member)?
 * `scope` is "tenant" for normal routes and "all" for the read-only All clients view.
 */
export function can(
  actor: Actor,
  action: Action,
  access: AccessLevel | undefined,
  scope: "tenant" | "all" = "tenant",
): Decision {
  // All clients view: operator only, and never a place to change anything
  if (scope === "all") {
    if (!actor.operator) return { ok: false, reason: "forbidden" };
    return action === "read" ? { ok: true } : { ok: false, reason: "read_only_view" };
  }
  // Creating and archiving organizations is neon1's job, not any client admin's
  if (action === "manage_orgs") {
    if (!actor.operator) return { ok: false, reason: "forbidden" };
    return actor.strongSession ? { ok: true } : { ok: false, reason: "strong_auth_required" };
  }
  // The operator acts as an admin inside every organization
  const level: AccessLevel | undefined = actor.operator ? "admin" : access;
  // Not a member: the API answers 404 so outsiders can't tell an organization exists
  if (!level) return { ok: false, reason: "not_member" };
  if (!LEVEL_ACTIONS[level].has(action)) return { ok: false, reason: "forbidden" };
  if (STRONG_AUTH.has(action) && !actor.strongSession) return { ok: false, reason: "strong_auth_required" };
  return { ok: true };
}


/** Who may approve on one project: a named decision maker; with none named, an admin member of the client */
export function canApprove(
  actor: Actor,
  access: AccessLevel | undefined,
  people: readonly { userId: string; role: string }[],
): Decision {
  const base = can(actor, "approve", access);
  if (!base.ok) return base;
  const deciders = people.filter((p) => p.role === "decision_maker").map((p) => p.userId);
  if (deciders.length) return deciders.includes(actor.userId) ? { ok: true } : { ok: false, reason: "not_decider" };
  // No one named: the organization's own admins decide; neon1 proposes, so the operator role alone never approves
  return access === "admin" && !actor.operator ? { ok: true } : { ok: false, reason: "not_decider" };
}
