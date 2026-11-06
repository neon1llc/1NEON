// The 1NEON API: one Hono app, mounted at /1NEON/api, run on Lambda or locally.
import {
  ApproveInput,
  CreateItemInput,
  CreateProjectInput,
  CreateTenantInput,
  DEFAULT_STAGES,
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
import { CognitoAuth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Directory, Mailer } from "./services.ts";
import { inviteEmail } from "./services.ts";
import { keys, Repo } from "./store/repo.ts";
import { ConflictError } from "./store/types.ts";

export interface Deps {
  cfg: Config;
  repo: Repo;
  directory: Directory;
  mailer: Mailer;
  auth?: CognitoAuth;
}

interface Who {
  user: User;
  actor: Actor;
}

type Env = { Variables: { who: Who; tenant: Tenant; access: AccessLevel | undefined } };

const now = () => new Date().toISOString();
const EDIT_MS = 2 * 60 * 1000;

function fail(status: 400 | 401 | 403 | 404 | 409 | 412 | 428, error: string, message: string, current?: unknown): never {
  throw new HTTPException(status, { res: Response.json({ error, message, current }, { status }) });
}

async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => fail(400, "bad_json", "The request body isn't valid JSON."));
  const r = schema.safeParse(raw);
  if (!r.success) fail(400, "invalid", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}

const REASONS = {
  not_member: [404, "not_found", "That organization doesn't exist, or you don't have access to it."],
  forbidden: [403, "forbidden", "Your access level doesn't allow that."],
  strong_auth_required: [403, "strong_auth_required", "Set up a passkey or an authenticator app first, then try again."],
  read_only_view: [403, "read_only", "All clients is read only. Open the organization to make changes."],
} as const;

export function createApp(d: Deps) {
  const { repo, cfg } = d;
  const app = new Hono<Env>().basePath("/1NEON/api");

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof ConflictError) {
      return c.json({ error: "conflict", message: err.message, current: strip(err.current) }, 409);
    }
    console.error(JSON.stringify({ level: "error", message: String(err), stack: (err as Error).stack }));
    return c.json({ error: "server_error", message: "Something went wrong on our side. Please try again." }, 500);
  });

  // CSRF: every state-changing call must carry a custom header (plus SameSite=Strict cookies).
  app.use("*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-1neon") !== "1") {
      fail(403, "csrf", "Missing request header.");
    }
    await next();
    c.header("cache-control", "no-store");
  });

  app.get("/health", (c) => c.json({ ok: true, env: cfg.env, version: process.env.APP_VERSION ?? "dev" }));

  // --- Sign-in (Cognito) -------------------------------------------------

  app.get("/auth/login", async (c) => {
    if (!d.auth) return c.redirect("/1NEON/");
    return d.auth.login(c, c.req.query("email"));
  });

  app.get("/auth/callback", async (c) => {
    if (!d.auth) return c.redirect("/1NEON/");
    const r = await d.auth.callback(c);
    if (!r || !r.emailVerified) return c.redirect("/1NEON/?signin=failed");
    const uid = await repo.userIdForEmail(r.email);
    if (!uid) return c.redirect("/1NEON/?signin=not_invited");
    await repo.linkSubject(r.sub, uid);
    const user = await repo.getUser(uid);
    if (user) {
      const strongAuth = await d.directory.hasStrongAuth(r.accessToken).catch(() => user.strongAuth);
      if (strongAuth !== user.strongAuth) await repo.saveUser({ ...user, strongAuth, version: user.version + 1, updatedAt: now() }, user.version);
    }
    return c.redirect("/1NEON/");
  });

  app.post("/auth/logout", async (c) => {
    const url = d.auth ? await d.auth.logout(c) : "/1NEON/";
    return c.json({ redirect: url });
  });

  // --- Identity: every route below needs a signed-in, invited person ------

  app.use("*", async (c, next) => {
    const user = await resolveUser(c);
    if (!user) fail(401, "signed_out", "Please sign in.");
    const operator = cfg.operatorEmails.includes(user.email);
    c.set("who", { user, actor: { userId: user.id, operator, strongAuth: user.strongAuth || (cfg.devAuth && operator) } });
    await next();
  });

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

  const who = (c: Context<Env>) => c.get("who");

  app.get("/me", async (c) => {
    const { user, actor } = who(c);
    const memberships = await repo.membershipsOf(user.id);
    // First visit after an invite: mark joined. Every visit: last seen.
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

  app.patch("/me", async (c) => {
    const { user } = who(c);
    const input = await body(c, UpdateMeInput);
    const { version, ...patch } = input;
    const next: User = { ...user, ...defined(patch), version: user.version + 1, updatedAt: now(), updatedBy: user.id };
    await repo.saveUser(next, version);
    return c.json(next);
  });

  // --- Operator: organizations and the All clients view --------------------

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

  // Any write under /all is refused outright: the aggregate is a view, never a place to edit.
  app.on(["POST", "PUT", "PATCH", "DELETE"], "/all/*", (c) => {
    check(can(who(c).actor, "write", undefined, "all"));
    return c.notFound();
  });

  // --- Inside one organization ---------------------------------------------

  app.use("/t/:tid/*", loadTenant);
  app.use("/t/:tid", loadTenant);

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

  const need = (c: Context<Env>, action: Action) => check(can(who(c).actor, action, c.get("access")));
  const actorId = (c: Context<Env>) => who(c).user.id;

  app.get("/t/:tid", (c) => {
    need(c, "read");
    return c.json({ org: c.get("tenant"), access: who(c).actor.operator ? "admin" : c.get("access") });
  });

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

  app.get("/t/:tid/workspace", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const [projects, members, activity] = await Promise.all([repo.listProjects(t.id), repo.listMembers(t.id), repo.listAudit(t.id, 12)]);
    const live = projects.filter((p) => !p.archived);
    const me = actorId(c);
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
        documents: 0,
      },
      waiting: waiting.slice(0, 10),
      activity,
    });
  });

  app.get("/t/:tid/activity", async (c) => {
    need(c, "read");
    return c.json(await repo.listAudit(c.get("tenant").id, 100));
  });

  // People

  app.get("/t/:tid/members", async (c) => {
    need(c, "read");
    const members = await repo.listMembers(c.get("tenant").id);
    const users = await Promise.all(members.map((m) => repo.getUser(m.userId)));
    return c.json(members.map((m, i) => ({ ...m, phone: users[i]?.phone ?? "", name: users[i]?.name || m.name, title: users[i]?.title || m.title })));
  });

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
        await repo.createUser({ id: uid, email: p.email, name: p.name, title: p.title, phone: "", operator: false, strongAuth: false, theme: "system", version: 1, createdAt: ts, updatedAt: ts, updatedBy: inviter.id });
      }
      const existing = await repo.getMember(t.id, uid);
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
      await d.directory.ensureUser(p.email);
      await repo.table.write([repo.memberOp(m, existing ? { version: existing.version } : { create: true }), repo.auditOp({ tenantId: t.id, actorId: inviter.id, action: "member.invited", target: uid, summary: `Invited ${p.email} as ${p.access}` })]);
      const mail = inviteEmail({ orgName: t.name, inviter: inviter.name || "neon1", url: `${cfg.publicUrl}/1NEON/api/auth/login?email=${encodeURIComponent(p.email)}` });
      await d.mailer.send(p.email, mail.subject, mail.text, mail.html);
      out.push(m);
    }
    return c.json(out, 201);
  });

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
    const push = (i: Partial<Item> & Pick<Item, "kind" | "title">) => {
      rank = rankBetween(rank, "");
      items.push(Item.parse({ ...base, id: newId("i"), rank, ...i }));
    };
    if (input.example) push({ kind: "discovery", title: "One real example of how it works today", body: input.example, status: "done" });
    for (const ti of tpl.items) push({ kind: ti.kind, title: ti.title, body: ti.body ?? "", fields: ti.fields ?? {} });
    for (const m of input.metrics) push({ kind: "metric", title: m.title, fields: { unit: m.unit, baseline: m.baseline, target: m.target, baselineDate: m.baseline !== undefined ? ts.slice(0, 10) : undefined, readings: [] } });
    // A project and its starter items land together, or not at all (in batches DynamoDB accepts).
    await repo.table.write([repo.projectOp(project, { create: true }), repo.auditOp({ tenantId: t.id, actorId: by, action: "project.created", target: project.id, summary: `Created ${project.key} ${project.name}` })]);
    for (let i = 0; i < items.length; i += 25) await repo.table.write(items.slice(i, i + 25).map((it) => repo.itemOp(it, { create: true })));
    return c.json(project, 201);
  });

  app.get("/t/:tid/projects/:pid", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const p = await project(c);
    const [items, docs, edits] = await Promise.all([repo.listItems(t.id, p.id), repo.listDocs(t.id, p.id), repo.listEdits(t.id, p.id)]);
    return c.json({ project: p, items: items.sort(byRank), docs, edits });
  });

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

  app.post("/t/:tid/projects/:pid/move", async (c) => {
    need(c, "write");
    const t = c.get("tenant");
    const p = await project(c);
    const input = await body(c, MoveProjectInput);
    const stage = t.stages.find((s) => s.id === input.stageId);
    if (!stage) fail(400, "invalid", "That stage doesn't exist.");
    const stageChanged = stage.id !== p.stageId;
    // Soft gate: entering Build or later without an approved decision is allowed, but needs a reason.
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

  // Layer items (Needs, Execution, Observation, Next)

  app.post("/t/:tid/projects/:pid/items", async (c) => {
    const p = await project(c);
    const input = await body(c, CreateItemInput);
    // Anyone who can read may submit a request (intake); everything else needs write.
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

  /** Approve an option: records an immutable decision tied to the exact option version. */
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
    const approved: Item = { ...option, status: "approved", version: option.version + 1, updatedAt: ts, updatedBy: by };
    await repo.table.write([
      repo.itemOp(approved, { version: option.version }),
      repo.itemOp(decision, { create: true }),
      repo.auditOp({ tenantId: p.tenantId, actorId: by, action: "decision.approved", target: decision.id, summary: `${p.key}: approved "${option.title}" (version ${option.version})` }),
    ]);
    return c.json({ decision, option: approved }, 201);
  });

  // Edit markers: advisory "Dana is editing" hints that expire on their own.

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

  // --- helpers ---------------------------------------------------------------

  async function project(c: Context<Env>) {
    const p = await repo.getProject(c.get("tenant").id, c.req.param("pid")!);
    if (!p || p.deletedAt) fail(404, "not_found", "That project doesn't exist or was deleted.");
    return p;
  }

  async function audit(c: Context<Env>, action: string, target: string, summary: string) {
    await repo.table.write([repo.auditOp({ tenantId: c.get("tenant").id, actorId: actorId(c), action, target, summary })]);
  }

  return app;
}

function check(d: ReturnType<typeof can>) {
  if (!d.ok) {
    const [status, error, message] = REASONS[d.reason];
    fail(status, error, message);
  }
}

function validateFields(kind: Item["kind"], fields: Record<string, unknown>) {
  const schema = itemFields[kind];
  if (!schema) return fields;
  const r = schema.safeParse(fields);
  if (!r.success) fail(400, "invalid", r.error.issues.map((i) => `fields.${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data as Record<string, unknown>;
}

const byRank = (a: { rank: string }, b: { rank: string }) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);

function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function label(kind: Item["kind"]) {
  return `${kind.replace("_", " ")} (${KIND_LAYER[kind]})`;
}

function strip(row: unknown) {
  if (!row || typeof row !== "object") return row;
  const { PK: _a, SK: _b, GSI1PK: _c, GSI1SK: _d, GSI2PK: _e, GSI2SK: _f, ttl: _g, type: _h, ...rest } = row as Record<string, unknown>;
  return rest;
}
