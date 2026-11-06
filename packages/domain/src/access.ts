// Who may do what: one permission table for the API and the web app, tested in domain.test.ts.
import type { AccessLevel } from "./model.ts";

/** Everything a person can try to do. One list, one table, fully tested. */
export type Action =
  | "read"
  | "comment"
  | "write" // create and edit projects, items, documents
  | "approve" // approve options, changes, handoffs (also requires being named, see canApprove)
  | "delete" // move projects to trash, delete documents
  | "manage_people" // invite, change access, deactivate
  | "manage_settings" // stages, templates, organization profile
  | "manage_orgs"; // create and archive organizations (operator only)

// Access levels are cumulative: each level adds to the one below.
const LEVEL_ACTIONS: Record<AccessLevel, ReadonlySet<Action>> = {
  viewer: new Set(["read", "comment", "approve"]),
  editor: new Set(["read", "comment", "approve", "write"]),
  admin: new Set(["read", "comment", "approve", "write", "delete", "manage_people", "manage_settings"]),
};

/** Admin-only actions also need strong sign-in (passkey or password + authenticator). */
const STRONG_AUTH: ReadonlySet<Action> = new Set(["delete", "manage_people", "manage_settings", "manage_orgs"]);

/** The caller as the API sees them after sign-in. */
export interface Actor {
  userId: string;
  operator: boolean;
  strongAuth: boolean;
}

/** A refusal carries its reason so the API can answer 403, 404, or "set up strong sign-in". */
export type Decision = { ok: true } | { ok: false; reason: "not_member" | "forbidden" | "strong_auth_required" | "read_only_view" };

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
  // All clients view: operator only, and never a place to change anything.
  if (scope === "all") {
    if (!actor.operator) return { ok: false, reason: "forbidden" };
    return action === "read" ? { ok: true } : { ok: false, reason: "read_only_view" };
  }
  // Creating and archiving organizations is neon1's job, not any client admin's.
  if (action === "manage_orgs") {
    if (!actor.operator) return { ok: false, reason: "forbidden" };
    return actor.strongAuth ? { ok: true } : { ok: false, reason: "strong_auth_required" };
  }
  // The operator acts as an admin inside every organization.
  const level: AccessLevel | undefined = actor.operator ? "admin" : access;
  // Not a member: the API answers 404 so outsiders can't tell an organization exists.
  if (!level) return { ok: false, reason: "not_member" };
  if (!LEVEL_ACTIONS[level].has(action)) return { ok: false, reason: "forbidden" };
  if (STRONG_AUTH.has(action) && !actor.strongAuth) return { ok: false, reason: "strong_auth_required" };
  return { ok: true };
}
