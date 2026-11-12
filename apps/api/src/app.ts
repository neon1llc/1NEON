// apps/api/src/app.ts - The 1NEON API: one Hono app, mounted at /1NEON/api, run on Lambda or
// locally. This is the composition root: error mapping, CSRF, identity, and tenant middleware, then
// each feature's routes from routes/, registered in the order that decides which handler runs.


import {
  DocumentRecord,
  Item,
  isActiveMember,
  Member as MemberSchema,
  Project as ProjectSchema,
  Tenant as TenantSchema,
  type User,
} from "@1neon/domain";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ConflictError, StoreBusyError, type Row } from "./store/types.ts";
import { REASONS, fail, who, type Env } from "./lib/http.ts";
import { kit, type Deps } from "./lib/kit.ts";
import { installOutbox } from "./lib/transactions.ts";
import { authRoutes } from "./routes/auth.ts";
import { commentRoutes } from "./routes/comments.ts";
import { contactRoutes } from "./routes/contact.ts";
import { devFileRoutes, docRoutes } from "./routes/docs.ts";
import { factorRoutes } from "./routes/factors.ts";
import { editRoutes, itemRoutes } from "./routes/items.ts";
import { memberRoutes } from "./routes/members.ts";
import { meRoutes } from "./routes/me.ts";
import { neoRoutes } from "./routes/neo.ts";
import { notificationRoutes } from "./routes/notifications.ts";
import { orgRoutes } from "./routes/orgs.ts";
import { projectRoutes } from "./routes/projects.ts";
import { workspaceRoutes } from "./routes/workspace.ts";
import { calendarRoutes } from "./routes/calendar.ts";
import { e164 } from "./sms.ts";


// The app's dependencies; defined beside the route kit, re-exported for existing importers
export type { Deps };


/** Build the API. Order matters: errors, CSRF, public routes, identity, then tenant routes */
export function createApp(d: Deps) {
  const { repo, cfg } = d;
  const app = new Hono<Env>().basePath("/1NEON/api");

  // Notifications ride on the audit trail: from here on, every table write queues the outbox rows for
  // its audit events in the same transaction (see lib/transactions.ts)
  const drainNow = installOutbox(d);
  // Shared services and tenant guards handed to every route module
  const k = kit(d, drainNow);

  // Known errors keep their status. A version conflict returns the newer record only when the public
  // conflict policy allows that kind of record, and only its schema's fields; anything else (sign-in
  // and security rows above all) answers without it
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof ConflictError) {
      const current = publicConflict(err.current);
      return c.json(current === undefined ? { error: "conflict", message: err.message } : { error: "conflict", message: err.message, current }, 409);
    }
    // A busy table wrote nothing; say so plainly instead of calling it a conflict
    if (err instanceof StoreBusyError || BUSY_ERRORS.has((err as Error).name)) {
      console.error(JSON.stringify({ level: "warn", message: "store busy", reason: err instanceof StoreBusyError ? err.reason : (err as Error).name }));
      c.header("retry-after", "2");
      return c.json({ error: "busy", message: "1NEON is busy for a moment. Nothing was saved; please try again." }, 503);
    }
    // Anything else is logged in full for us and shown to people as a plain apology
    console.error(JSON.stringify({ level: "error", message: String(err), stack: (err as Error).stack }));
    return c.json({ error: "server_error", message: "Something went wrong on our side. Please try again." }, 500);
  });

  // Local dev only: the in-memory file store's upload and download links (S3 links in production)
  devFileRoutes(app, k);

  // CSRF: every state-changing call must carry a custom header (plus SameSite=Strict cookies)
  app.use("*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-1neon") !== "1") {
      fail(403, "csrf", "Missing request header.");
    }
    await next();
    c.header("cache-control", "no-store");
  });

  // Liveness for checks and deploys; no identity needed
  app.get("/health", (c) => c.json({ ok: true, env: cfg.env, version: (typeof process === "undefined" ? undefined : process.env.APP_VERSION) ?? "dev" }));

  // --- Sign-in (Cognito) -------------------------------------------------
  authRoutes(app, k);

  // --- The contact form on neon1.tech, public and rate limited -----------
  contactRoutes(app, k);

  // --- Identity: every route below needs a signed-in, invited person ------

  app.use("*", async (c, next) => {
    const found = await resolveUser(c);
    if (!found) fail(401, "signed_out", "Please sign in.");
    const { user, jti } = found;
    // The operator role comes from configuration, never from the database, so no data edit can grant it
    const operator = cfg.operatorEmails.includes(user.email);
    // Strong means this session proved a passkey, authenticator, or texted code within the step-up
    // window; a failed lookup throws and fails the request rather than granting anything. Locally the
    // seeded flag stands in, unless the caller names a dev session (the browser demo does, to show
    // "Confirm it's you" for real)
    const strongSession = cfg.devAuth && !jti ? user.strongAuth || operator : await repo.sessionStrong(jti, user.id);
    c.set("who", { user, actor: { userId: user.id, operator, strongSession }, jti });
    await next();
  });

  /** Who is calling: the dev header locally, otherwise the Cognito cookie mapped to our user record */
  async function resolveUser(c: Context): Promise<{ user: User; jti?: string } | undefined> {
    if (cfg.devAuth) {
      const email = c.req.header("x-dev-user")?.toLowerCase();
      if (!email) return undefined;
      const uid = await repo.userIdForEmail(email);
      const user = uid ? await repo.getUser(uid) : undefined;
      // A dev session ID is optional; without one, session strength comes from the seeded flag
      return user && { user, jti: c.req.header("x-dev-session") || undefined };
    }
    const ident = d.auth ? await d.auth.identify(c) : undefined;
    if (!ident) return undefined;
    const uid = await repo.userIdForSubject(ident.sub);
    const user = uid ? await repo.getUser(uid) : undefined;
    return user && { user, jti: ident.jti };
  }

  // --- The signed-in person: profile, number check, and second steps -------
  meRoutes(app, k);
  factorRoutes(app, k);

  // --- Neo for signed-in people: reads as the caller through this same app --
  neoRoutes(app, k);

  // --- Operator: organizations and the All clients view --------------------
  orgRoutes(app, k);

  // --- Inside one organization ---------------------------------------------

  app.use("/t/:tid/*", loadTenant);
  app.use("/t/:tid", loadTenant);

  /** Resolve :tid and the caller's access, or answer 404 for non-members (the operator may enter any) */
  async function loadTenant(c: Context<Env>, next: () => Promise<void>) {
    const tid = c.req.param("tid")!;
    const { actor, user } = who(c);
    const [tenant, member] = await Promise.all([repo.getTenant(tid), repo.getMember(tid, user.id)]);
    const access = member && isActiveMember(member) ? member.access : undefined;
    if (!tenant || (!access && !actor.operator)) fail(REASONS.not_member[0], REASONS.not_member[1], REASONS.not_member[2]);
    c.set("tenant", tenant);
    c.set("access", access);
    await next();
  }

  // Tenant routes, in their original order: overview, calendar, notifications, people, projects, items,
  // comments, edit markers, documents
  workspaceRoutes(app, k);
  calendarRoutes(app, k);
  notificationRoutes(app, k);
  memberRoutes(app, k);
  projectRoutes(app, k);
  itemRoutes(app, k);
  commentRoutes(app, k);
  editRoutes(app, k);
  docRoutes(app, k);

  return app;
}


// Phone numbers are read as E.164 by the text rules; re-exported for existing importers
export { e164 };


// AWS SDK error names that mean "throttled or temporarily unavailable", not a failed guard
const BUSY_ERRORS = new Set(["ProvisionedThroughputExceededException", "ThrottlingException", "RequestLimitExceeded", "TransactionInProgressException", "InternalServerError"]);


// The public conflict policy: the only record kinds whose newer copy may go back to the browser, each
// projected through its own schema so only declared fields leave (zod drops everything else). A new
// kind, or a new field that isn't in the schema, stays private until it's added here on purpose
const CONFLICT_VIEWS: Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }> = {
  project: ProjectSchema,
  item: Item,
  doc: DocumentRecord,
  member: MemberSchema,
  tenant: TenantSchema,
};


/** The newer record for a conflict dialog, or undefined when this kind of row never leaves the API */
function publicConflict(row: Row | undefined) {
  const view = typeof row?.type === "string" ? CONFLICT_VIEWS[row.type] : undefined;
  if (!view) return undefined;
  const r = view.safeParse(row);
  return r.success ? r.data : undefined;
}
