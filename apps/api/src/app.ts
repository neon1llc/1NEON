// apps/api/src/app.ts - The 1NEON API: one Hono app, mounted at /1NEON/api, run on Lambda or
// locally.


import {
  ApproveInput,
  CreateDocInput,
  CreateItemInput,
  CreateProjectInput,
  CreateTenantInput,
  DEFAULT_STAGES,
  DocumentRecord,
  InviteInput,
  Item,
  KIND_LAYER,
  MoveProjectInput,
  Stage,
  UpdateItemInput,
  UpdateMeInput,
  UpdateMemberInput,
  UpdateProjectInput,
  can,
  formatClientId,
  itemFields,
  newId,
  rankBetween,
  slugify,
  templateById,
  type AccessLevel,
  type Action,
  type Actor,
  type Member,
  type Project,
  type Tenant,
  type User,
} from "@1neon/domain";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { CognitoAuth, type Verified } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Directory, Mailer, Storage } from "./services.ts";
import { inviteEmail, MemoryStorage } from "./services.ts";
import { keys, Repo } from "./store/repo.ts";
import { ConflictError } from "./store/types.ts";


/** Everything the app needs from outside; tests and local dev pass in-memory versions */
export interface Deps {
  cfg: Config;
  repo: Repo;
  directory: Directory;
  mailer: Mailer;
  storage: Storage;
  auth?: CognitoAuth;
}


/** The signed-in person and the actor that permission checks use */
interface Who {
  user: User;
  actor: Actor;
}


// Per-request values set by middleware: who is calling, and the tenant a /t/:tid route resolved
type Env = { Variables: { who: Who; tenant: Tenant; access: AccessLevel | undefined } };


// Timestamps are ISO strings in UTC, as the schemas expect
const now = () => new Date().toISOString();
// Edit markers last two minutes; the editor's browser renews them while the form is open
const EDIT_MS = 2 * 60 * 1000;


/** Stop the request with a JSON error the web app can show as written */
function fail(status: 400 | 401 | 403 | 404 | 409 | 410 | 412 | 428, error: string, message: string, current?: unknown): never {
  throw new HTTPException(status, { res: Response.json({ error, message, current }, { status }) });
}


/** Parse and validate a JSON body; validation messages name the field that failed */
async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => fail(400, "bad_json", "The request body isn't valid JSON."));
  const r = schema.safeParse(raw);
  if (!r.success) fail(400, "invalid", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}


// Status and wording for each permission refusal from can()
const REASONS = {
  not_member: [404, "not_found", "That organization doesn't exist, or you don't have access to it."],
  forbidden: [403, "forbidden", "Your access level doesn't allow that."],
  strong_auth_required: [403, "strong_auth_required", "Set up a passkey or an authenticator app first, then try again."],
  read_only_view: [403, "read_only", "All clients is read only. Open the organization to make changes."],
} as const;


/** Build the API. Order matters: errors, CSRF, public routes, identity, then tenant routes */
export function createApp(d: Deps) {
  const { repo, cfg } = d;
  const app = new Hono<Env>().basePath("/1NEON/api");

  // Known errors keep their status; a version conflict returns the current record for the conflict dialog
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof ConflictError) {
      return c.json({ error: "conflict", message: err.message, current: strip(err.current) }, 409);
    }
    // Anything else is logged in full for us and shown to people as a plain apology
    console.error(JSON.stringify({ level: "error", message: String(err), stack: (err as Error).stack }));
    return c.json({ error: "server_error", message: "Something went wrong on our side. Please try again." }, 500);
  });

  // Local dev only: the in-memory file store's upload and download links (S3 links in production)
  const mem = d.storage instanceof MemoryStorage ? d.storage : undefined;
  if (mem && cfg.devAuth) {
    app.put("/dev-files/:key", async (c) => {
      mem.files.set(c.req.param("key"), { type: c.req.header("content-type") ?? "application/octet-stream", bytes: new Uint8Array(await c.req.arrayBuffer()) });
      return c.body(null, 200);
    });
    app.get("/dev-files/:key", (c) => {
      const f = mem.files.get(c.req.param("key"));
      return f ? new Response(f.bytes, { headers: { "content-type": f.type } }) : c.notFound();
    });
  }

  // CSRF: every state-changing call must carry a custom header (plus SameSite=Strict cookies)
  app.use("*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-1neon") !== "1") {
      fail(403, "csrf", "Missing request header.");
    }
    await next();
    c.header("cache-control", "no-store");
  });

  // Liveness for checks and deploys; no identity needed
  app.get("/health", (c) => c.json({ ok: true, env: cfg.env, version: process.env.APP_VERSION ?? "dev" }));

  // --- Sign-in (Cognito) -------------------------------------------------

  /** After any sign-in: invite check, link the Cognito identity, refresh strong sign-in */
  async function admit(r: Verified | undefined): Promise<"ok" | "failed" | "not_invited"> {
    if (!r || !r.emailVerified) return "failed";
    // Invite only: a verified email must already belong to an invited person
    const uid = await repo.userIdForEmail(r.email);
    if (!uid) return "not_invited";
    // Remember which Cognito identity (email code, passkey, or Google) maps to this person
    await repo.linkSubject(r.sub, uid);
    const user = await repo.getUser(uid);
    if (user) {
      // Refresh strong sign-in on every sign-in, so removing a passkey or authenticator takes effect
      const strongAuth = await d.directory.hasStrongAuth(r.accessToken).catch(() => user.strongAuth);
      if (strongAuth !== user.strongAuth) await repo.saveUser({ ...user, strongAuth, version: user.version + 1, updatedAt: now() }, user.version);
    }
    return "ok";
  }

  // Managed Login: Google goes straight to Google; anything else is the auth.neon1.tech fallback
  app.get("/auth/login", async (c) => {
    // Local dev has no Cognito; the demo account buttons stand in for sign-in
    if (!d.auth) return c.redirect("/1NEON/");
    const provider = c.req.query("provider") === "google" ? "Google" : undefined;
    return d.auth.login(c, c.req.query("email"), provider);
  });

  app.get("/auth/callback", async (c) => {
    if (!d.auth) return c.redirect("/1NEON/");
    const result = await admit(await d.auth.callback(c));
    return c.redirect(result === "ok" ? "/1NEON/" : `/1NEON/?signin=${result}`);
  });

  // On-page sign-in: each call returns the next step; "done" means the cookies are set
  const SignInBody = z.discriminatedUnion("op", [
    z.object({ op: z.literal("start"), email: z.string().trim().toLowerCase().email().max(254), remember: z.boolean().default(true) }),
    z.object({ op: z.literal("choose"), method: z.enum(["code", "passkey"]) }),
    z.object({ op: z.literal("answer"), kind: z.enum(["code", "totp", "passkey"]), value: z.string().min(1).max(20000) }),
  ]);
  app.post("/auth/step", async (c) => {
    if (!d.auth) fail(404, "not_found", "Sign-in runs through the demo accounts locally.");
    const b = SignInBody.parse(await c.req.json());
    const r = b.op === "start" ? await d.auth.start(c, b.email, b.remember) : b.op === "choose" ? await d.auth.choose(c, b.method) : await d.auth.answer(c, b.kind, b.value);
    if (r.next.step !== "done") return c.json({ ...r.next, wrong: "wrong" in r ? r.wrong : undefined });
    const result = await admit("verified" in r ? r.verified : undefined);
    // Not invited: drop the cookies Cognito's tokens just set
    if (result !== "ok") await d.auth.logout(c);
    return c.json(result === "ok" ? { step: "done" } : { step: result });
  });

  // Revoke the refresh token, clear cookies, and send the browser to Cognito's logout
  app.post("/auth/logout", async (c) => {
    const url = d.auth ? await d.auth.logout(c) : "/1NEON/";
    return c.json({ redirect: url });
  });

  // --- Identity: every route below needs a signed-in, invited person ------

  app.use("*", async (c, next) => {
    const user = await resolveUser(c);
    if (!user) fail(401, "signed_out", "Please sign in.");
    // The operator role comes from configuration, never from the database, so no data edit can grant it
    const operator = cfg.operatorEmails.includes(user.email);
    c.set("who", { user, actor: { userId: user.id, operator, strongAuth: user.strongAuth || (cfg.devAuth && operator) } });
    await next();
  });

  /** Who is calling: the dev header locally, otherwise the Cognito cookie mapped to our user record */
  async function resolveUser(c: Context): Promise<User | undefined> {
    if (cfg.devAuth) {
      const email = c.req.header("x-dev-user")?.toLowerCase();
      if (!email) return undefined;
      const uid = await repo.userIdForEmail(email);
      return uid ? repo.getUser(uid) : undefined;
    }
    const ident = d.auth ? await d.auth.identify(c) : undefined;
    if (!ident) return undefined;
    const uid = await repo.userIdForSubject(ident.sub);
    return uid ? repo.getUser(uid) : undefined;
  }

  // The caller set by the identity middleware
  const who = (c: Context<Env>) => c.get("who");

  // Me: the person, their organizations (all of them for the operator), and the join bookkeeping
  app.get("/me", async (c) => {
    const { user, actor } = who(c);
    const memberships = await repo.membershipsOf(user.id);
    // First visit after an invite: mark joined. Every visit: last seen
    const t = now();
    for (const m of memberships) {
      if (m.status === "deactivated") continue;
      const joined = m.status === "invited";
      const stale = !m.lastSeenAt || Date.parse(t) - Date.parse(m.lastSeenAt) > 5 * 60 * 1000;
      if (joined || stale) {
        const next: Member = { ...m, status: "joined", joinedAt: m.joinedAt ?? t, lastSeenAt: t, version: m.version + 1, updatedAt: t, updatedBy: user.id };
        await repo.saveMember(next, { version: m.version }).catch(() => undefined);
        if (joined) await repo.table.write([repo.auditOp({ tenantId: m.tenantId, actorId: user.id, action: "member.joined", target: user.id, summary: `${user.name || user.email} joined` })]);
      }
    }
    const active = memberships.filter((m) => m.status !== "deactivated");
    // The operator sees every active organization; everyone else sees their own
    const tenants = actor.operator ? await repo.listTenants() : (await Promise.all(active.map((m) => repo.getTenant(m.tenantId)))).filter(Boolean) as Tenant[];
    const accessBy = new Map(active.map((m) => [m.tenantId, m.access] as const));
    return c.json({
      user,
      operator: actor.operator,
      orgs: tenants
        .filter((t) => t.status === "active")
        .map((t) => ({ id: t.id, slug: t.slug, name: t.name, clientId: t.clientId, access: actor.operator ? "admin" : accessBy.get(t.id) }))
        .sort((a, b) => a.clientId.localeCompare(b.clientId)),
    });
  });

  // People edit only their own profile; operator and strong sign-in can't be set here
  app.patch("/me", async (c) => {
    const { user } = who(c);
    const input = await body(c, UpdateMeInput);
    const { version, ...patch } = input;
    const next: User = { ...user, ...defined(patch), version: user.version + 1, updatedAt: now(), updatedBy: user.id };
    await repo.saveUser(next, version);
    return c.json(next);
  });

  // --- Operator: organizations and the All clients view --------------------

  // Create an organization with the default stages and the next client ID
  app.post("/orgs", async (c) => {
    const { actor, user } = who(c);
    check(can(actor, "manage_orgs", undefined));
    const input = await body(c, CreateTenantInput);
    const n = await repo.nextClientNumber();
    const t = now();
    const tenant: Tenant = {
      id: newId("t"),
      slug: input.slug ?? slugify(input.name),
      clientId: formatClientId(n),
      name: input.name,
      status: "active",
      stages: DEFAULT_STAGES,
      version: 1,
      createdAt: t,
      updatedAt: t,
      updatedBy: user.id,
    };
    try {
      await repo.createTenant(tenant);
    } catch (e) {
      if (e instanceof ConflictError) fail(409, "slug_taken", `The address "${tenant.slug}" is taken. Choose another.`);
      throw e;
    }
    await repo.table.write([repo.auditOp({ tenantId: tenant.id, actorId: user.id, action: "org.created", target: tenant.id, summary: `Created ${tenant.name} (${tenant.clientId})` })]);
    return c.json(tenant, 201);
  });

  // All clients: every active project across organizations, read only
  app.get("/all/projects", async (c) => {
    check(can(who(c).actor, "read", undefined, "all"));
    const [tenants, projects] = await Promise.all([repo.listTenants(), repo.listAllProjects()]);
    const byId = new Map(tenants.map((t) => [t.id, t]));
    return c.json({
      orgs: tenants.map((t) => ({ id: t.id, slug: t.slug, name: t.name, clientId: t.clientId, stages: t.stages })),
      projects: projects.filter((p) => byId.get(p.tenantId)?.status === "active" && !p.archived),
      stages: DEFAULT_STAGES,
    });
  });

  // Any write under /all is refused outright: the aggregate is a view, never a place to edit
  app.on(["POST", "PUT", "PATCH", "DELETE"], "/all/*", (c) => {
    check(can(who(c).actor, "write", undefined, "all"));
    return c.notFound();
  });

  // --- Inside one organization ---------------------------------------------

  app.use("/t/:tid/*", loadTenant);
  app.use("/t/:tid", loadTenant);

  /** Resolve :tid and the caller's access, or answer 404 for non-members (the operator may enter any) */
  async function loadTenant(c: Context<Env>, next: () => Promise<void>) {
    const tid = c.req.param("tid")!;
    const { actor, user } = who(c);
    const [tenant, member] = await Promise.all([repo.getTenant(tid), repo.getMember(tid, user.id)]);
    const access = member && member.status !== "deactivated" ? member.access : undefined;
    if (!tenant || (!access && !actor.operator)) fail(REASONS.not_member[0], REASONS.not_member[1], REASONS.not_member[2]);
    c.set("tenant", tenant);
    c.set("access", access);
    await next();
  }

  // Shorthand for a permission check inside a tenant route
  const need = (c: Context<Env>, action: Action) => check(can(who(c).actor, action, c.get("access")));
  // Who to record in updatedBy and the audit log
  const actorId = (c: Context<Env>) => who(c).user.id;

  // The organization and the caller's access, for the web app's frame
  app.get("/t/:tid", (c) => {
    need(c, "read");
    return c.json({ org: c.get("tenant"), access: who(c).actor.operator ? "admin" : c.get("access") });
  });

  // Workflow stages: admins only, and never remove a stage that still holds a project
  app.put("/t/:tid/stages", async (c) => {
    need(c, "manage_settings");
    const input = await body(c, z.object({ version: z.number().int(), stages: z.array(Stage).min(1).max(20) }));
    const ids = new Set(input.stages.map((s) => s.id));
    if (ids.size !== input.stages.length) fail(400, "invalid", "Stage IDs must be unique.");
    const t = c.get("tenant");
    const projects = await repo.listProjects(t.id);
    const orphan = projects.find((p) => !ids.has(p.stageId));
    if (orphan) fail(400, "stage_in_use", `Move ${orphan.key} out of that stage before removing it.`);
    const next: Tenant = { ...t, stages: input.stages, version: t.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    await repo.saveTenant(next, input.version);
    await audit(c, "org.stages", t.id, "Updated workflow stages");
    return c.json(next);
  });

  // Workspace landing: hub counts, what's waiting on the caller, and recent activity
  app.get("/t/:tid/workspace", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const [projects, members, activity] = await Promise.all([repo.listProjects(t.id), repo.listMembers(t.id), repo.listAudit(t.id, 12)]);
    const live = projects.filter((p) => !p.archived);
    const me = actorId(c);
    // Waiting on you: open items assigned to the caller, and options shared for approval
    const waiting: { projectId: string; projectKey: string; itemId: string; title: string; kind: string }[] = [];
    for (const p of live) {
      const items = await repo.listItems(t.id, p.id);
      for (const i of items) {
        const mine = i.assigneeId === me && i.status !== "done";
        const approval = i.kind === "option" && i.status === "proposed";
        if (mine || approval) waiting.push({ projectId: p.id, projectKey: p.key, itemId: i.id, title: i.title, kind: i.kind });
      }
    }
    const stageName = new Map(t.stages.map((s) => [s.id, s]));
    return c.json({
      counts: {
        projects: live.length,
        deciding: live.filter((p) => stageName.get(p.stageId)?.id === "decide").length,
        building: live.filter((p) => stageName.get(p.stageId)?.layer === "execution").length,
        people: members.filter((m) => m.status !== "deactivated").length,
        invited: members.filter((m) => m.status === "invited").length,
        documents: (await allDocs(t.id, live.map((p) => p.id))).length,
      },
      waiting: waiting.slice(0, 10),
      activity,
    });
  });

  // The audit trail, newest first
  app.get("/t/:tid/activity", async (c) => {
    need(c, "read");
    return c.json(await repo.listAudit(c.get("tenant").id, 100));
  });

  // People

  // Members with their current profile details
  app.get("/t/:tid/members", async (c) => {
    need(c, "read");
    const members = await repo.listMembers(c.get("tenant").id);
    const users = await Promise.all(members.map((m) => repo.getUser(m.userId)));
    return c.json(members.map((m, i) => ({ ...m, phone: users[i]?.phone ?? "", name: users[i]?.name || m.name, title: users[i]?.title || m.title })));
  });

  // Invite: create the person if new, add the membership, create the Cognito user, and email the link
  app.post("/t/:tid/members/invite", async (c) => {
    need(c, "manage_people");
    const t = c.get("tenant");
    const { people } = await body(c, InviteInput);
    const inviter = who(c).user;
    const out: Member[] = [];
    for (const p of people) {
      let uid = await repo.userIdForEmail(p.email);
      const ts = now();
      if (!uid) {
        uid = newId("u");
        await repo.createUser({ id: uid, email: p.email, name: p.name, title: p.title, phone: "", operator: false, strongAuth: false, theme: "awake", menu: "rail", version: 1, createdAt: ts, updatedAt: ts, updatedBy: inviter.id });
      }
      const existing = await repo.getMember(t.id, uid);
      // Already a member: nothing to do. A deactivated member is re-invited
      if (existing && existing.status !== "deactivated") {
        out.push(existing);
        continue;
      }
      const m: Member = {
        tenantId: t.id,
        userId: uid,
        email: p.email,
        name: p.name,
        title: p.title,
        access: p.access,
        status: "invited",
        invitedBy: inviter.id,
        invitedAt: ts,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
        updatedBy: inviter.id,
      };
      // The Cognito user exists before the email goes out, so the link works on first click
      await d.directory.ensureUser(p.email);
      await repo.table.write([repo.memberOp(m, existing ? { version: existing.version } : { create: true }), repo.auditOp({ tenantId: t.id, actorId: inviter.id, action: "member.invited", target: uid, summary: `Invited ${p.email} as ${p.access}` })]);
      const mail = inviteEmail({ orgName: t.name, inviter: inviter.name || "neon1", url: `${cfg.publicUrl}/1NEON/?email=${encodeURIComponent(p.email)}` });
      await d.mailer.send(p.email, mail.subject, mail.text, mail.html);
      out.push(m);
    }
    return c.json(out, 201);
  });

  // Change access or deactivate. An organization always keeps at least one active admin
  app.patch("/t/:tid/members/:uid", async (c) => {
    need(c, "manage_people");
    const t = c.get("tenant");
    const m = await repo.getMember(t.id, c.req.param("uid"));
    if (!m) fail(404, "not_found", "That person isn't in this organization.");
    const input = await body(c, UpdateMemberInput);
    const next: Member = { ...m, ...defined({ access: input.access, title: input.title, status: input.status }), version: m.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    if (m.access === "admin" && next.access !== "admin" || next.status === "deactivated" && m.access === "admin") {
      const admins = (await repo.listMembers(t.id)).filter((x) => x.access === "admin" && x.status !== "deactivated");
      if (admins.length <= 1) fail(400, "last_admin", "An organization needs at least one admin.");
    }
    await repo.saveMember(next, { version: input.version });
    await audit(c, "member.updated", m.userId, `Updated ${m.email}`);
    return c.json(next);
  });

  // Projects

  app.get("/t/:tid/projects", async (c) => {
    need(c, "read");
    return c.json(await repo.listProjects(c.get("tenant").id));
  });

  // New project: next key for the template (FLOW-3), first visible stage, top of that column
  app.post("/t/:tid/projects", async (c) => {
    need(c, "write");
    const t = c.get("tenant");
    const input = await body(c, CreateProjectInput);
    const tpl = templateById(input.template);
    const n = await repo.nextProjectNumber(t.id, tpl.keyPrefix);
    const first = t.stages.find((s) => !s.hidden) ?? t.stages[0]!;
    const siblings = (await repo.listProjects(t.id)).filter((p) => p.stageId === first.id).sort(byRank);
    const ts = now();
    const by = actorId(c);
    const project: Project = {
      tenantId: t.id,
      id: newId("p"),
      key: `${tpl.keyPrefix}-${n}`,
      name: input.name,
      summary: input.summary,
      outcome: input.outcome,
      template: tpl.id,
      stageId: first.id,
      stageEnteredAt: ts,
      health: "not_started",
      rank: rankBetween("", siblings[0]?.rank ?? ""),
      targetDate: input.targetDate,
      people: input.people,
      flags: input.flags,
      archived: false,
      version: 1,
      createdAt: ts,
      updatedAt: ts,
      updatedBy: by,
    };
    const base = { tenantId: t.id, projectId: project.id, status: "open", body: "", fields: {}, version: 1, createdAt: ts, updatedAt: ts, updatedBy: by };
    const items: Item[] = [];
    let rank = "";
    // Starter items: the real example, the template's items, and the measures from the wizard
    const push = (i: Partial<Item> & Pick<Item, "kind" | "title">) => {
      rank = rankBetween(rank, "");
      items.push(Item.parse({ ...base, id: newId("i"), rank, ...i }));
    };
    if (input.example) push({ kind: "discovery", title: "One real example of how it works today", body: input.example, status: "done" });
    for (const ti of tpl.items) push({ kind: ti.kind, title: ti.title, body: ti.body ?? "", fields: ti.fields ?? {} });
    for (const m of input.metrics) push({ kind: "metric", title: m.title, fields: { unit: m.unit, baseline: m.baseline, target: m.target, baselineDate: m.baseline !== undefined ? ts.slice(0, 10) : undefined, readings: [] } });
    // A project and its starter items land together, or not at all (in batches DynamoDB accepts)
    await repo.table.write([repo.projectOp(project, { create: true }), repo.auditOp({ tenantId: t.id, actorId: by, action: "project.created", target: project.id, summary: `Created ${project.key} ${project.name}` })]);
    for (let i = 0; i < items.length; i += 25) await repo.table.write(items.slice(i, i + 25).map((it) => repo.itemOp(it, { create: true })));
    return c.json(project, 201);
  });

  // One project with its items, documents, and who is editing what
  app.get("/t/:tid/projects/:pid", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const p = await project(c);
    const [items, docs, edits] = await Promise.all([repo.listItems(t.id, p.id), repo.listDocs(t.id, p.id), repo.listEdits(t.id, p.id)]);
    return c.json({ project: p, items: items.sort(byRank), docs, edits });
  });

  // Edit project fields; `targetDate: null` clears the date
  app.patch("/t/:tid/projects/:pid", async (c) => {
    need(c, "write");
    const p = await project(c);
    const input = await body(c, UpdateProjectInput);
    const { version, targetDate, ...patch } = input;
    const next: Project = { ...p, ...defined(patch), version: p.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    if (targetDate !== undefined) next.targetDate = targetDate ?? undefined;
    await repo.table.write([repo.projectOp(next, { version }), repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: "project.updated", target: p.id, summary: `Updated ${p.key}` })]);
    return c.json(next);
  });

  // Move between stages or reorder within one; the client sends the neighbours, the API picks the rank
  app.post("/t/:tid/projects/:pid/move", async (c) => {
    need(c, "write");
    const t = c.get("tenant");
    const p = await project(c);
    const input = await body(c, MoveProjectInput);
    const stage = t.stages.find((s) => s.id === input.stageId);
    if (!stage) fail(400, "invalid", "That stage doesn't exist.");
    const stageChanged = stage.id !== p.stageId;
    // Soft gate: entering Build or later without an approved decision is allowed, but needs a reason
    const order = t.stages.findIndex((s) => s.id === stage.id);
    const decideAt = t.stages.findIndex((s) => s.id === "decide");
    if (stageChanged && decideAt >= 0 && order > decideAt) {
      const decided = (await repo.listItems(t.id, p.id)).some((i) => i.kind === "decision");
      if (!decided && !input.reason) fail(428, "reason_required", "No option has been approved yet. Add a reason to move on anyway.");
    }
    const ts = now();
    const next: Project = { ...p, stageId: stage.id, rank: rankBetween(input.after ?? "", input.before ?? ""), stageEnteredAt: stageChanged ? ts : p.stageEnteredAt, version: p.version + 1, updatedAt: ts, updatedBy: actorId(c) };
    const summary = stageChanged ? `Moved ${p.key} to ${stage.name}${input.reason ? ` (${input.reason})` : ""}` : `Reordered ${p.key}`;
    await repo.table.write([repo.projectOp(next, { version: input.version }), repo.auditOp({ tenantId: t.id, actorId: actorId(c), action: "project.moved", target: p.id, summary })]);
    return c.json(next);
  });

  // Trash a project. Typing its key confirms; nothing is erased here
  app.delete("/t/:tid/projects/:pid", async (c) => {
    need(c, "delete");
    const p = await project(c);
    const input = await body(c, z.object({ version: z.number().int(), confirm: z.string() }));
    if (input.confirm !== p.key) fail(400, "confirm", `Type ${p.key} to confirm.`);
    const ts = now();
    const next: Project = { ...p, deletedAt: ts, archived: true, version: p.version + 1, updatedAt: ts, updatedBy: actorId(c) };
    await repo.table.write([repo.projectOp(next, { version: input.version }), repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: "project.trashed", target: p.id, summary: `Moved ${p.key} to Trash (30 days)` })]);
    return c.json({ ok: true });
  });

  // Layer items (Needs, Execute, Observe, Normalize)

  app.post("/t/:tid/projects/:pid/items", async (c) => {
    const p = await project(c);
    const input = await body(c, CreateItemInput);
    // Anyone who can read may submit a request (intake); everything else needs write
    need(c, input.kind === "request" ? "comment" : "write");
    if (input.kind === "decision") fail(400, "invalid", "Decisions are recorded by approving an option.");
    const fields = validateFields(input.kind, input.fields);
    const items = (await repo.listItems(p.tenantId, p.id)).filter((i) => i.kind === input.kind).sort(byRank);
    const ts = now();
    const item = Item.parse({
      ...input,
      fields,
      tenantId: p.tenantId,
      projectId: p.id,
      id: newId("i"),
      status: input.status ?? (input.kind === "option" ? "draft" : "open"),
      rank: rankBetween(items.at(-1)?.rank ?? "", ""),
      version: 1,
      createdAt: ts,
      updatedAt: ts,
      updatedBy: actorId(c),
    });
    await repo.table.write([repo.itemOp(item, { create: true }), repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: `${item.kind}.created`, target: item.id, summary: `${p.key}: added ${label(item.kind)} "${item.title}"` })]);
    return c.json(item, 201);
  });

  // Edit an item. Finishing an edit also clears the caller's edit marker
  app.patch("/t/:tid/projects/:pid/items/:iid", async (c) => {
    need(c, "write");
    const p = await project(c);
    const item = await repo.getItem(p.tenantId, p.id, c.req.param("iid"));
    if (!item) fail(404, "not_found", "That item no longer exists.");
    if (item.kind === "decision") fail(400, "immutable", "Decisions can't be edited. Approve a new option to change the decision.");
    const input = await body(c, UpdateItemInput);
    const { version, assigneeId, dueDate, fields, ...patch } = input;
    const next: Item = { ...item, ...defined(patch), version: item.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    if (assigneeId !== undefined) next.assigneeId = assigneeId ?? undefined;
    if (dueDate !== undefined) next.dueDate = dueDate ?? undefined;
    if (fields) next.fields = validateFields(item.kind, { ...item.fields, ...fields });
    await repo.table.write([repo.itemOp(next, { version }), repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: `${item.kind}.updated`, target: item.id, summary: `${p.key}: updated ${label(item.kind)} "${next.title}"` })]);
    await repo.clearEditing(p.tenantId, p.id, item.id, actorId(c));
    return c.json(next);
  });

  // Remove an item, guarded by the version the person last saw
  app.delete("/t/:tid/projects/:pid/items/:iid", async (c) => {
    need(c, "write");
    const p = await project(c);
    const item = await repo.getItem(p.tenantId, p.id, c.req.param("iid"));
    if (!item) fail(404, "not_found", "That item no longer exists.");
    if (item.kind === "decision") fail(400, "immutable", "Decisions are kept as a permanent record.");
    const version = Number(c.req.query("version"));
    await repo.table.write([
      { delete: keys.item(p.tenantId, p.id, item.id), guard: { version } },
      repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: `${item.kind}.deleted`, target: item.id, summary: `${p.key}: removed ${label(item.kind)} "${item.title}"` }),
    ]);
    return c.json({ ok: true });
  });

  /** Approve an option: records an immutable decision tied to the exact option version */
  app.post("/t/:tid/projects/:pid/items/:iid/approve", async (c) => {
    need(c, "approve");
    const p = await project(c);
    const option = await repo.getItem(p.tenantId, p.id, c.req.param("iid"));
    if (!option || option.kind !== "option") fail(404, "not_found", "That option no longer exists.");
    const input = await body(c, ApproveInput);
    if (input.version !== option.version) fail(409, "conflict", "The option changed since you read it. Review it again before approving.", option);
    const ts = now();
    const by = actorId(c);
    const decision = Item.parse({
      tenantId: p.tenantId,
      projectId: p.id,
      id: newId("i"),
      kind: "decision",
      title: `Approved: ${option.title}`,
      body: input.conditions,
      status: "approved",
      rank: ts,
      fields: { optionId: option.id, optionVersion: option.version, approvedBy: by, approvedAt: ts, conditions: input.conditions },
      version: 1,
      createdAt: ts,
      updatedAt: ts,
      updatedBy: by,
    });
    // The option and its decision are written in one transaction, so neither exists without the other
    const approved: Item = { ...option, status: "approved", version: option.version + 1, updatedAt: ts, updatedBy: by };
    await repo.table.write([
      repo.itemOp(approved, { version: option.version }),
      repo.itemOp(decision, { create: true }),
      repo.auditOp({ tenantId: p.tenantId, actorId: by, action: "decision.approved", target: decision.id, summary: `${p.key}: approved "${option.title}" (version ${option.version})` }),
    ]);
    return c.json({ decision, option: approved }, 201);
  });

  // Edit markers: advisory "Dana is editing" hints that expire on their own

  app.post("/t/:tid/projects/:pid/edits", async (c) => {
    need(c, "write");
    const p = await project(c);
    const { recordId } = await body(c, z.object({ recordId: z.string().min(1).max(64) }));
    const u = who(c).user;
    const holder = await repo.markEditing(p.tenantId, p.id, { recordId, userId: u.id, name: u.name || u.email, expiresAt: new Date(Date.now() + EDIT_MS).toISOString() });
    return c.json({ ok: !holder, holder });
  });

  app.delete("/t/:tid/projects/:pid/edits/:recordId", async (c) => {
    need(c, "read");
    const p = await project(c);
    await repo.clearEditing(p.tenantId, p.id, c.req.param("recordId"), actorId(c));
    return c.json({ ok: true });
  });

  // --- Documents: general files and project files, filed by layer -------------

  // Where a file's bytes live: the organization's folder, then the project (or "_"), then the record
  const docKey = (x: DocumentRecord) => `t/${x.tenantId}/${x.projectId ?? "_"}/${x.id}/${x.name.replace(/[^\w.\- ]+/g, "_")}`;

  /** Every finished upload in the organization: the general files and each live project's */
  async function allDocs(tid: string, pids: string[]) {
    const lists = await Promise.all([repo.listDocs(tid, undefined), ...pids.map((pid) => repo.listDocs(tid, pid))]);
    return lists.flat().filter((x) => x.uploaded).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The record named by :did, in the project given as ?p= (none for general files) */
  async function doc(c: Context<Env>) {
    const x = await repo.getDoc(c.get("tenant").id, c.req.query("p") || undefined, c.req.param("did")!);
    if (!x) fail(404, "not_found", "That file no longer exists.");
    return x;
  }

  app.get("/t/:tid/docs", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const projects = (await repo.listProjects(t.id)).filter((p) => !p.deletedAt);
    return c.json({ docs: await allDocs(t.id, projects.map((p) => p.id)), projects: projects.map((p) => ({ id: p.id, key: p.key, name: p.name })) });
  });

  // Start an upload. Anyone who can comment may upload, so clients can send the files that are needed
  app.post("/t/:tid/docs", async (c) => {
    need(c, "comment");
    const t = c.get("tenant");
    const input = await body(c, CreateDocInput);
    if (input.projectId) await repo.getProject(t.id, input.projectId).then((p) => (!p || p.deletedAt) && fail(404, "not_found", "That project doesn't exist."));
    if (input.itemId) {
      const item = input.projectId ? await repo.getItem(t.id, input.projectId, input.itemId) : undefined;
      if (!item || item.kind !== "file_request") fail(400, "invalid", "Files can only answer a \"file needed\" item in the same project.");
    }
    const ts = now();
    const x = DocumentRecord.parse({ ...input, tenantId: t.id, id: newId("d"), key: "", scan: "pending", uploaded: false, version: 1, createdAt: ts, updatedAt: ts, updatedBy: actorId(c) });
    x.key = docKey(x);
    await repo.saveDoc(x, { create: true });
    return c.json({ doc: x, upload: await d.storage.putUrl(x.key, x.contentType) }, 201);
  });

  // The browser finished sending the bytes: show the file, and check off the item it answers
  app.post("/t/:tid/docs/:did/done", async (c) => {
    need(c, "comment");
    const x = await doc(c);
    if (x.uploaded) return c.json(x);
    const ts = now();
    const next: DocumentRecord = { ...x, uploaded: true, version: x.version + 1, updatedAt: ts };
    const ops = [repo.docOp(next, { version: x.version }), repo.auditOp({ tenantId: x.tenantId, actorId: actorId(c), action: "doc.uploaded", target: x.id, summary: `Uploaded "${x.name}"` })];
    const item = x.projectId && x.itemId ? await repo.getItem(x.tenantId, x.projectId, x.itemId) : undefined;
    if (item && item.status !== "done") ops.push(repo.itemOp({ ...item, status: "done", version: item.version + 1, updatedAt: ts, updatedBy: actorId(c) }, { version: item.version }));
    await repo.table.write(ops);
    return c.json(next);
  });

  // A download link, once the malware scan has passed
  app.get("/t/:tid/docs/:did/download", async (c) => {
    need(c, "read");
    const x = await doc(c);
    const scan = x.scan === "clean" ? "clean" : await d.storage.scan(x.key);
    if (scan !== x.scan) await repo.saveDoc({ ...x, scan, version: x.version + 1, updatedAt: now() }, { version: x.version }).catch(() => undefined);
    if (scan === "infected") fail(410, "infected", "This file was flagged by the malware scan and can't be downloaded.");
    if (scan === "pending") fail(409, "scanning", "This file is still being scanned. Try again in a minute.");
    return c.json({ url: await d.storage.getUrl(x.key, x.name) });
  });

  // Remove a file: the person who uploaded it, or an admin
  app.delete("/t/:tid/docs/:did", async (c) => {
    const x = await doc(c);
    if (x.updatedBy !== actorId(c)) need(c, "delete");
    else need(c, "comment");
    await d.storage.remove(x.key);
    await repo.table.write([{ delete: keys.doc(x.tenantId, x.projectId, x.id) }, repo.auditOp({ tenantId: x.tenantId, actorId: actorId(c), action: "doc.deleted", target: x.id, summary: `Removed "${x.name}"` })]);
    return c.json({ ok: true });
  });

  // --- helpers ---------------------------------------------------------------

  /** The project in :pid within this tenant; trashed projects are gone as far as routes are concerned */
  async function project(c: Context<Env>) {
    const p = await repo.getProject(c.get("tenant").id, c.req.param("pid")!);
    if (!p || p.deletedAt) fail(404, "not_found", "That project doesn't exist or was deleted.");
    return p;
  }

  /** Record an audit event on its own (most writes add theirs to the same transaction instead) */
  async function audit(c: Context<Env>, action: string, target: string, summary: string) {
    await repo.table.write([repo.auditOp({ tenantId: c.get("tenant").id, actorId: actorId(c), action, target, summary })]);
  }

  return app;
}


/** Turn a permission refusal into the matching HTTP error */
function check(d: ReturnType<typeof can>) {
  if (!d.ok) {
    const [status, error, message] = REASONS[d.reason];
    fail(status, error, message);
  }
}


/** Validate kind-specific fields; kinds without a schema keep free-form fields */
function validateFields(kind: Item["kind"], fields: Record<string, unknown>) {
  const schema = itemFields[kind];
  if (!schema) return fields;
  const r = schema.safeParse(fields);
  if (!r.success) fail(400, "invalid", r.error.issues.map((i) => `fields.${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data as Record<string, unknown>;
}


// Board and list order
const byRank = (a: { rank: string }, b: { rank: string }) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);


/** Drop undefined values so a partial update never blanks a field */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}


/** Readable item kind for audit summaries, such as "file request (needs)" */
function label(kind: Item["kind"]) {
  return `${kind.replace("_", " ")} (${KIND_LAYER[kind]})`;
}


/** Remove storage keys before a record leaves the API */
function strip(row: unknown) {
  if (!row || typeof row !== "object") return row;
  const { PK: _a, SK: _b, GSI1PK: _c, GSI1SK: _d, GSI2PK: _e, GSI2SK: _f, ttl: _g, type: _h, ...rest } = row as Record<string, unknown>;
  return rest;
}
