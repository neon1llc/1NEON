// apps/api/src/app.ts - The 1NEON API: one Hono app, mounted at /1NEON/api, run on Lambda or
// locally.


import {
  DocumentRecord,
  Item,
  Member as MemberSchema,
  Project as ProjectSchema,
  Tenant as TenantSchema,
  type User,
  Stage,
  canApprove,
  type Tenant,
  groupOf,
  InviteInput,
  UpdateMemberInput,
  newId,
  type Member,
  CreateProjectInput,
  MoveProjectInput,
  UpdateProjectInput,
  rankBetween,
  templateById,
  type Project,
  ApproveInput,
  CreateItemInput,
  DecisionFields,
  OptionFields,
  UpdateItemInput,
  settableStatus,
  CreateDocInput,
  fileState,
  type FileProblem,
} from "@1neon/domain";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ConflictError, StoreBusyError, type Row } from "./store/types.ts";
import { REASONS, fail, who, type Env, actorId, body, need, now, defined, MAX_TRANSACTION, byRank, check, label, validateFields } from "./lib/http.ts";
import { kit, type Deps } from "./lib/kit.ts";
import { installOutbox } from "./lib/transactions.ts";
import { authRoutes } from "./routes/auth.ts";
import { factorRoutes } from "./routes/factors.ts";
import { meRoutes } from "./routes/me.ts";
import { orgRoutes } from "./routes/orgs.ts";
import { e164 } from "./sms.ts";
import { z } from "zod";
import { outboxOp } from "./outbox.ts";
import { keys } from "./store/repo.ts";
import { settleFile, unwatchOp, watchOp } from "./files.ts";
import { MemoryStorage } from "./local.ts";


// The app's dependencies; defined beside the route kit, re-exported for existing importers
export type { Deps };


// Edit markers last two minutes; the editor's browser renews them while the form is open
const EDIT_MS = 2 * 60 * 1000;


// Why a failed file can't be downloaded, in words; the codes are defined in the domain model
const FILE_PROBLEM: Record<FileProblem, string> = {
  missing: "The file never arrived in storage. Upload it again.",
  size_mismatch: "The stored file isn't the size that was sent. Upload it again.",
  scan_failed: "The malware scan couldn't finish on this file. Upload it again, or send it another way.",
  scan_unsupported: "The malware scan can't read this kind of file (often a password-protected archive). Send it another way.",
  timeout: "The malware scan took too long on this file. Upload it again.",
};


/** Build the API. Order matters: errors, CSRF, public routes, identity, then tenant routes */
export function createApp(d: Deps) {
  const { repo, cfg } = d;
  const app = new Hono<Env>().basePath("/1NEON/api");

  // Notifications ride on the audit trail: from here on, every table write queues the outbox rows for
  // its audit events in the same transaction (see lib/transactions.ts)
  const drainNow = installOutbox(d);
  // Shared services and tenant guards handed to every route module
  const k = kit(d, drainNow);
  const { project, deciderChange, activeMembers, audit, allDocs } = k;

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
  const mem = d.storage instanceof MemoryStorage ? d.storage : undefined;
  if (mem && cfg.devAuth) {
    app.put("/dev-files/:key", async (c) => {
      mem.files.set(c.req.param("key"), { type: c.req.header("content-type") ?? "application/octet-stream", bytes: new Uint8Array(await c.req.arrayBuffer()) });
      return c.body(null, 200);
    });
    app.get("/dev-files/:key", (c) => {
      const f = mem.files.get(c.req.param("key"));
      return f ? new Response(new Uint8Array(f.bytes), { headers: { "content-type": f.type } }) : c.notFound();
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
  app.get("/health", (c) => c.json({ ok: true, env: cfg.env, version: (typeof process === "undefined" ? undefined : process.env.APP_VERSION) ?? "dev" }));

  // --- Sign-in (Cognito) -------------------------------------------------
  authRoutes(app, k);

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
    const access = member && member.status !== "deactivated" ? member.access : undefined;
    if (!tenant || (!access && !actor.operator)) fail(REASONS.not_member[0], REASONS.not_member[1], REASONS.not_member[2]);
    c.set("tenant", tenant);
    c.set("access", access);
    await next();
  }

  // Tenant routes, in their original order: overview, notifications, people, projects, items,
  // comments, edit markers, documents
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
    const [projects, members, activity] = await Promise.all([repo.listProjects(t.id), repo.listMembers(t.id), repo.listAudit(t.id, 16)]);
    // Members by id, to name who did what
    const names = new Map(members.map((m) => [m.userId, m.name || m.email]));
    const live = projects.filter((p) => !p.archived);
    const me = actorId(c);
    const { actor } = who(c);
    // Needs you: a choice between options you may approve, files the client is asked for, and your
    // open work. A project's proposed options are one decision, so they wait as one entry
    const waiting: { projectId: string; projectKey: string; projectName: string; itemId: string; title: string; kind: string; action: "choose" | "upload" | "do"; count?: number }[] = [];
    for (const p of live) {
      const items = await repo.listItems(t.id, p.id);
      // A project with an approved option no longer asks anyone to approve the others
      const decider = canApprove(actor, c.get("access"), p.people).ok && !items.some((i) => i.kind === "option" && i.status === "approved");
      const options = decider ? items.filter((i) => i.kind === "option" && i.status === "proposed").sort((a, b) => a.title.localeCompare(b.title)) : [];
      if (options.length) waiting.push({ projectId: p.id, projectKey: p.key, projectName: p.name, itemId: options[0]!.id, title: "Choose an option", kind: "option", action: "choose", count: options.length });
      for (const i of items) {
        const action = i.kind === "file_request" && i.status !== "done" && !actor.operator ? "upload"
          : i.kind !== "option" && i.assigneeId === me && i.status !== "done" ? "do" : undefined;
        if (action) waiting.push({ projectId: p.id, projectKey: p.key, projectName: p.name, itemId: i.id, title: i.title, kind: i.kind, action });
      }
    }
    // Choices first, then files to send, then work
    const order = { choose: 0, upload: 1, do: 2 };
    waiting.sort((a, b) => order[a.action] - order[b.action]);
    // The latest written update on each live project, newest first
    const updates: { projectKey: string; projectName: string; title: string; body: string; health: string; at: string; by: string }[] = [];
    for (const p of live) {
      const u = (await repo.listItems(t.id, p.id)).filter((i) => i.kind === "update").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (u) updates.push({ projectKey: p.key, projectName: p.name, title: u.title, body: u.body, health: String(u.fields.health ?? p.health), at: u.createdAt, by: u.updatedBy });
    }
    updates.sort((a, b) => b.at.localeCompare(a.at));
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
      updates: updates.slice(0, 5),
      // What people did: sign-ins aren't doing anything, so the feed leaves them out (the
      // notification for them still goes to whoever asked for it). Each row names who did it
      activity: activity.filter((a) => a.action !== "member.signedin").map((a) => ({ ...a, by: names.get(a.actorId) ?? (a.actorId === "system" ? "" : "neon1") })),
    });
  });

  // Coming up: dated work (due items, milestones, project targets) from two weeks back to six weeks ahead
  app.get("/t/:tid/upcoming", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const live = (await repo.listProjects(t.id)).filter((p) => !p.archived);
    const today = now().slice(0, 10);
    const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 42 * 864e5).toISOString().slice(0, 10);
    const events: { date: string; title: string; projectKey: string; kind: string; itemId?: string; overdue: boolean; mine: boolean }[] = [];
    const me = actorId(c);
    for (const p of live) {
      if (p.targetDate && p.targetDate >= from && p.targetDate <= to) events.push({ date: p.targetDate, title: `${p.name} target`, projectKey: p.key, kind: "target", overdue: p.targetDate < today, mine: false });
      for (const i of await repo.listItems(t.id, p.id)) {
        if (!i.dueDate || i.status === "done" || i.status === "approved" || i.dueDate > to) continue;
        // Overdue items stay listed however old they are; future ones only up to six weeks out
        events.push({ date: i.dueDate, title: i.title, projectKey: p.key, kind: i.kind, itemId: i.id, overdue: i.dueDate < today, mine: i.assigneeId === me });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    return c.json({ today, from, to, events });
  });

  // Insights: default charts from the organization's own data, computed on request
  app.get("/t/:tid/insights", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const projects = (await repo.listProjects(t.id)).filter((p) => !p.archived);
    const members = await repo.listMembers(t.id);
    const layerOf = new Map(t.stages.map((s) => [s.id, s.layer]));
    const byLayer = { needs: 0, execution: 0, observation: 0, next: 0 } as Record<string, number>;
    const byHealth = { on_track: 0, at_risk: 0, off_track: 0, not_started: 0 } as Record<string, number>;
    const doneByWeek = new Map<string, number>();
    let open = 0, overdue = 0, onTime = 0, late = 0, measures = 0, reached = 0;
    const decisionDays: number[] = [];
    const today = now().slice(0, 10);
    // Monday of the week a date falls in, so weeks line up
    const week = (iso: string) => { const d = new Date(iso.slice(0, 10) + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
    for (const p of projects) {
      byLayer[layerOf.get(p.stageId) ?? "needs"]!++;
      byHealth[p.health] = (byHealth[p.health] ?? 0) + 1;
      const items = await repo.listItems(t.id, p.id);
      const created = new Map(items.map((i) => [i.id, i.createdAt]));
      for (const i of items) {
        if (i.kind === "metric") {
          measures++;
          const f = i.fields as { baseline?: number; target?: number; readings?: { value: number }[] };
          const last = f.readings?.at(-1)?.value;
          if (last !== undefined && f.target !== undefined && f.baseline !== undefined && (f.target < f.baseline ? last <= f.target : last >= f.target)) reached++;
          continue;
        }
        if (i.kind === "decision") {
          const opt = created.get(String(i.fields.optionId));
          if (opt) decisionDays.push((Date.parse(String(i.fields.approvedAt)) - Date.parse(opt)) / 864e5);
          continue;
        }
        if (i.status === "done") {
          const wk = week(i.updatedAt);
          doneByWeek.set(wk, (doneByWeek.get(wk) ?? 0) + 1);
          if (i.dueDate) (i.updatedAt.slice(0, 10) <= i.dueDate ? onTime++ : late++);
        } else if (i.kind !== "update" && i.status !== "approved") {
          open++;
          if (i.dueDate && i.dueDate < today) overdue++;
        }
      }
    }
    // The last eight weeks of finished work, oldest first, zero-filled
    const weeks: { week: string; done: number }[] = [];
    for (let k = 7; k >= 0; k--) {
      const wk = week(new Date(Date.now() - k * 7 * 864e5).toISOString());
      weeks.push({ week: wk, done: doneByWeek.get(wk) ?? 0 });
    }
    return c.json({
      projects: projects.length,
      byLayer,
      byHealth,
      weeks,
      work: { open, overdue, onTime, late },
      decisions: { count: decisionDays.length, avgDays: decisionDays.length ? Math.round((decisionDays.reduce((a, b) => a + b, 0) / decisionDays.length) * 10) / 10 : null },
      measures: { count: measures, reached },
      people: { active: members.filter((m) => m.status === "joined").length, invited: members.filter((m) => m.status === "invited").length },
    });
  });

  // The audit trail, newest first
  app.get("/t/:tid/activity", async (c) => {
    need(c, "read");
    return c.json(await repo.listAudit(c.get("tenant").id, 100));
  });
  // Notifications: what others did here lately, each with its group and importance, and when the
  // caller last looked. Info-level events (sign-ins) show in the list but never count as new
  app.get("/t/:tid/notifications", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const me = actorId(c);
    const [events, member] = await Promise.all([repo.listAudit(t.id, 60), repo.getMember(t.id, me)]);
    // Never opened: only the last three days count as new, so older history doesn't all light up at once
    const seenAt = member?.seenAt ?? new Date(Date.now() - 3 * 864e5).toISOString();
    const list = events.filter((e) => e.actorId !== me).slice(0, 40).map((e) => {
      const g = groupOf(e.action);
      return { ...e, group: g.id, level: g.level, unread: e.at > seenAt && g.level !== "info" };
    });
    return c.json({ seenAt, unread: list.filter((e) => e.unread).length, events: list });
  });

  // Opening the list marks everything up to now as seen
  app.post("/t/:tid/notifications/seen", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const m = await repo.getMember(t.id, actorId(c));
    if (m) await repo.saveMember({ ...m, seenAt: now(), version: m.version + 1, updatedAt: now(), updatedBy: actorId(c) }, { version: m.version });
    return c.body(null, 204);
  });
  // Members with their current profile details
  app.get("/t/:tid/members", async (c) => {
    need(c, "read");
    const members = await repo.listMembers(c.get("tenant").id);
    const users = await Promise.all(members.map((m) => repo.getUser(m.userId)));
    // Phone numbers stay on the person's own profile; organizations they share don't see them
    return c.json(members.map((m, i) => ({ ...m, name: users[i]?.name || m.name, title: users[i]?.title || m.title })));
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
      const rev = await repo.membershipRev(t.id);
      // The membership and its invitation email are queued together; the email's state shows on People
      const invite = inviteOutbox(t, m, inviter);
      m.invite = { state: "queued", queuedAt: invite.at };
      // One transaction: membership, membership revision, invitation outbox row, and audit event
      await repo.table.write([repo.memberOp(m, existing ? { version: existing.version } : { create: true }), repo.membershipRevOp(t.id, rev), invite.op, repo.auditOp({ tenantId: t.id, actorId: inviter.id, action: "member.invited", target: uid, summary: `Invited ${p.email} as ${p.access}` })]);
      if ((d.outbox ?? "inline") === "inline") await drainNow([invite.op]);
      out.push((await repo.getMember(t.id, uid)) ?? m);
    }
    return c.json(out, 201);
  });

  /** An invitation email's outbox row; its createdAt doubles as the membership's invite.queuedAt */
  function inviteOutbox(t: Tenant, m: Member, inviter: User) {
    const op = outboxOp(`I#${newId()}`, { kind: "invite", tenantId: t.id, userId: m.userId, email: m.email, orgName: t.name, inviter: inviter.name || "neon1", url: `${cfg.publicUrl}/1NEON/?email=${encodeURIComponent(m.email)}` });
    return { op, at: String(("put" in op && op.put.createdAt) || now()) };
  }

  // Send the invitation again, for someone who hasn't joined. At most once every ten minutes per person,
  // unless the last one has already given up
  app.post("/t/:tid/members/:uid/resend", async (c) => {
    need(c, "manage_people");
    const t = c.get("tenant");
    const m = await repo.getMember(t.id, c.req.param("uid"));
    if (!m || m.status !== "invited") fail(400, "not_invited", "Only someone who hasn't joined yet can get the invitation again.");
    if (m.invite && m.invite.state !== "failed" && Date.now() - Date.parse(m.invite.queuedAt) < 10 * 60 * 1000) fail(429, "resend_soon", "The invitation was sent in the last ten minutes. Give it a little longer.");
    const invite = inviteOutbox(t, m, who(c).user);
    const next: Member = { ...m, invite: { state: "queued", queuedAt: invite.at }, version: m.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    // One transaction: the membership's invite state and the new outbox row
    await repo.table.write([repo.memberOp(next, { version: m.version }), invite.op]);
    if ((d.outbox ?? "inline") === "inline") await drainNow([invite.op]);
    return c.json((await repo.getMember(t.id, m.userId)) ?? next);
  });

  // Change access or deactivate. An organization always keeps at least one active admin: the check
  // reads the membership revision first and the write bumps it, so a concurrent change to anyone
  // else's membership makes this write fail instead of both passing the count
  app.patch("/t/:tid/members/:uid", async (c) => {
    need(c, "manage_people");
    const t = c.get("tenant");
    const rev = await repo.membershipRev(t.id);
    const m = await repo.getMember(t.id, c.req.param("uid"));
    if (!m) fail(404, "not_found", "That person isn't in this organization.");
    const input = await body(c, UpdateMemberInput);
    const next: Member = { ...m, ...defined({ access: input.access, title: input.title, status: input.status }), version: m.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    const isAdmin = (x: Member) => x.access === "admin" && x.status !== "deactivated";
    if (isAdmin(m) && !isAdmin(next)) {
      const admins = (await repo.listMembers(t.id)).filter(isAdmin);
      if (admins.length <= 1) fail(400, "last_admin", "An organization needs at least one admin.");
    }
    try {
      await repo.table.write([repo.memberOp(next, { version: input.version }), repo.membershipRevOp(t.id, rev), repo.auditOp({ tenantId: t.id, actorId: actorId(c), action: "member.updated", target: m.userId, summary: `Updated ${m.email}` })]);
    } catch (e) {
      // Someone changed this organization's people at the same moment; nothing was saved
      if (e instanceof ConflictError) fail(409, "conflict", "Someone changed this organization's people at the same time. Reload and try again.");
      throw e;
    }
    return c.json(next);
  });
  app.get("/t/:tid/projects", async (c) => {
    need(c, "read");
    return c.json(await repo.listProjects(c.get("tenant").id));
  });

  // New project: next key for the template (FLOW-3), first visible stage, top of that column
  app.post("/t/:tid/projects", async (c) => {
    need(c, "write");
    const t = c.get("tenant");
    const input = await body(c, CreateProjectInput);
    // A retry of a create that already landed returns that project instead of making another
    const replay = async () => {
      const prior = input.idempotencyKey ? await repo.idempotent(t.id, input.idempotencyKey) : undefined;
      if (!prior) return undefined;
      if (prior.userId !== actorId(c)) fail(409, "idempotency_key_reused", "That request key was already used. Reload and try again.");
      return repo.getProject(t.id, prior.projectId);
    };
    const earlier = await replay();
    if (earlier) return c.json(earlier, 201);
    await activeMembers(t.id, input.people.map((p) => p.userId));
    const named = await deciderChange(c, [], input.people);
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
    // The real example: answered in the wizard, or asked as the first discovery question
    if (input.example) push({ kind: "discovery", title: "One real example of how it works today", body: input.example, status: "done" });
    else if (input.template !== "blank") push({ kind: "discovery", title: "One real example of how it works today" });
    for (const ti of tpl.items) push({ kind: ti.kind, title: ti.title, body: ti.body ?? "", fields: ti.fields ?? {} });
    for (const m of input.metrics) push({ kind: "metric", title: m.title, fields: { unit: m.unit, baseline: m.baseline, target: m.target, direction: m.baseline !== undefined && m.target !== undefined && m.target < m.baseline ? "down" : "up", baselineDate: m.baseline !== undefined ? ts.slice(0, 10) : undefined, readings: [] } });
    // A project, its starter items, its audit event, and its request key land in one transaction or
    // not at all. The largest template (14 items) plus an example and 10 measures is 25 items, far
    // inside DynamoDB's 100-item transaction limit; the check below keeps that true if templates grow
    const ops = [
      repo.projectOp(project, { create: true }),
      ...items.map((it) => repo.itemOp(it, { create: true })),
      repo.auditOp({ tenantId: t.id, actorId: by, action: "project.created", target: project.id, summary: `Created ${project.key} ${project.name}` }),
      ...(named ? [repo.auditOp({ tenantId: t.id, actorId: by, action: "project.decider_changed", target: project.id, summary: `${project.key} decision maker: ${named}` })] : []),
      ...(input.idempotencyKey ? [repo.idempotencyOp(t.id, input.idempotencyKey, by, project.id)] : []),
    ];
    if (ops.length > MAX_TRANSACTION) fail(400, "too_large", "That template has too many starter items to create at once.");
    try {
      await repo.table.write(ops);
    } catch (e) {
      // The same key landed first from a concurrent retry: answer with that project
      const raced = e instanceof ConflictError ? await replay() : undefined;
      if (raced) return c.json(raced, 201);
      throw e;
    }
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
    const p = await project(c, { archived: true });
    const input = await body(c, UpdateProjectInput);
    // An archived project takes only its unarchive
    if (p.archived && input.archived !== false) fail(409, "archived", "This project is archived. Unarchive it to make changes.");
    if (input.people) await activeMembers(p.tenantId, input.people.map((x) => x.userId));
    const named = input.people ? await deciderChange(c, p.people, input.people) : undefined;
    const { version, targetDate, ...patch } = input;
    const next: Project = { ...p, ...defined(patch), version: p.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    if (targetDate !== undefined) next.targetDate = targetDate ?? undefined;
    // One transaction: the project, its update event, and (when who decides changed) that event too
    await repo.table.write([
      repo.projectOp(next, { version }),
      repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: "project.updated", target: p.id, summary: `Updated ${p.key}` }),
      ...(named ? [repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: "project.decider_changed", target: p.id, summary: `${p.key} decision maker: ${named}` })] : []),
    ]);
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

  // Trash a project. Typing its key confirms; it's hidden but kept, and erased only on the client's request
  app.delete("/t/:tid/projects/:pid", async (c) => {
    need(c, "delete");
    const p = await project(c, { archived: true });
    const input = await body(c, z.object({ version: z.number().int(), confirm: z.string() }));
    if (input.confirm !== p.key) fail(400, "confirm", `Type ${p.key} to confirm.`);
    const ts = now();
    const next: Project = { ...p, deletedAt: ts, archived: true, version: p.version + 1, updatedAt: ts, updatedBy: actorId(c) };
    await repo.table.write([repo.projectOp(next, { version: input.version }), repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: "project.trashed", target: p.id, summary: `Moved ${p.key} to Trash` })]);
    return c.json({ ok: true });
  });
  // Layer items (Needs, Execute, Observe, Normalize)

  app.post("/t/:tid/projects/:pid/items", async (c) => {
    const p = await project(c);
    const input = await body(c, CreateItemInput);
    // Anyone who can read may submit a request (intake); everything else needs write
    need(c, input.kind === "request" ? "comment" : "write");
    if (input.kind === "decision") fail(400, "invalid", "Decisions are recorded by approving an option.");
    // Options are neon1's proposals: neon1 writes, shares, and withdraws them; the client approves one
    if (input.kind === "option" && !who(c).actor.operator) fail(403, "neon1_only", "Options are proposed by neon1. Add a request instead, and they'll come back as options.");
    if (input.status !== undefined && !settableStatus(input.kind, input.status)) fail(400, "invalid_status", `"${input.status}" isn't a status for this kind of item.`);
    if (input.assigneeId) await activeMembers(p.tenantId, [input.assigneeId]);
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
    // A status update also sets the project's health, in the same transaction
    const health = item.kind === "update" ? (item.fields as { health?: Project["health"] }).health : undefined;
    const healthOp = health && health !== p.health ? [repo.projectOp({ ...p, health, version: p.version + 1, updatedAt: ts, updatedBy: actorId(c) }, { version: p.version })] : [];
    await repo.table.write([repo.itemOp(item, { create: true }), ...healthOp, repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: `${item.kind}.created`, target: item.id, summary: `${p.key}: added ${label(item.kind)} "${item.title}"` })]);
    return c.json(item, 201);
  });

  // Edit an item. Finishing an edit also clears the caller's edit marker
  app.patch("/t/:tid/projects/:pid/items/:iid", async (c) => {
    need(c, "write");
    const p = await project(c);
    const item = await repo.getItem(p.tenantId, p.id, c.req.param("iid"));
    if (!item) fail(404, "not_found", "That item no longer exists.");
    if (item.kind === "decision") fail(400, "immutable", "Decisions can't be edited. Approve a new option to change the decision.");
    if (item.kind === "option" && !who(c).actor.operator) fail(403, "neon1_only", "Options are proposed by neon1. Comment on the option to ask for a change.");
    const input = await body(c, UpdateItemInput);
    // An approved option is part of a decision's record: its terms and status don't change. A revised
    // proposal is a new option, approved on its own
    if (item.status === "approved" && (input.title !== undefined || input.body !== undefined || input.fields !== undefined)) fail(400, "immutable", "This option is approved. Propose a new option to change its terms.");
    // Statuses follow each kind's list; an approval is final and only the approve route grants it
    if (input.status !== undefined && input.status !== item.status) {
      if (item.status === "approved") fail(400, "immutable", "This option is approved. Propose a new option to change course.");
      if (!settableStatus(item.kind, input.status)) fail(400, "invalid_status", `"${input.status}" isn't a status for this kind of item.`);
    }
    if (input.assigneeId) await activeMembers(p.tenantId, [input.assigneeId]);
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
    if (item.status === "approved") fail(400, "immutable", "An approved option is part of a decision's record and stays.");
    if (item.kind === "option" && !who(c).actor.operator) fail(403, "neon1_only", "Options are proposed by neon1. Comment on the option to ask for a change.");
    const version = Number(c.req.query("version"));
    if (!Number.isInteger(version)) fail(400, "invalid", "Send the version you last saw.");
    await repo.table.write([
      { delete: keys.item(p.tenantId, p.id, item.id), guard: { version } },
      repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: `${item.kind}.deleted`, target: item.id, summary: `${p.key}: removed ${label(item.kind)} "${item.title}"` }),
    ]);
    return c.json({ ok: true });
  });

  /** Approve an option: records an immutable decision tied to the exact option version */
  app.post("/t/:tid/projects/:pid/items/:iid/approve", async (c) => {
    const p = await project(c);
    // Only a named decision maker approves (or, with none named, the client's own admins)
    check(canApprove(who(c).actor, c.get("access"), p.people));
    const option = await repo.getItem(p.tenantId, p.id, c.req.param("iid"));
    if (!option || option.kind !== "option") fail(404, "not_found", "That option no longer exists.");
    if (option.status !== "proposed") fail(409, "not_proposed", option.status === "approved" ? "This option is already approved." : "Only an option shared for approval can be approved.");
    const input = await body(c, ApproveInput);
    if (input.version !== option.version) fail(409, "conflict", "The option changed since you read it. Review it again before approving.", option);
    const ts = now();
    const by = actorId(c);
    const approver = who(c).user;
    // The terms exactly as approved travel with the decision, so it never depends on the option later
    const of = OptionFields.parse(option.fields);
    const terms = { title: option.title, body: option.body, cost: of.cost, timeline: of.timeline, costScore: of.costScore, qualityScore: of.qualityScore, effortScore: of.effortScore, recommended: of.recommended };
    const earlier = (await repo.listItems(p.tenantId, p.id)).filter((i) => i.kind === "decision").map((i) => i.id);
    const decision = Item.parse({
      tenantId: p.tenantId,
      projectId: p.id,
      id: newId("i"),
      kind: "decision",
      title: `Approved: ${option.title}`,
      body: input.conditions,
      status: "approved",
      rank: ts,
      fields: DecisionFields.parse({ optionId: option.id, optionVersion: option.version, approvedBy: by, approvedAt: ts, conditions: input.conditions, terms, approverName: approver.name || undefined, approverEmail: approver.email, supersedes: earlier.length ? earlier : undefined }),
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
  // Comments and history on one item. Anyone who can comment may add one; authors and admins remove them
  app.get("/t/:tid/projects/:pid/items/:iid/comments", async (c) => {
    need(c, "read");
    const p = await project(c);
    const iid = c.req.param("iid")!;
    const [comments, audit] = await Promise.all([repo.listComments(p.tenantId, p.id, iid), repo.listAudit(p.tenantId, 300)]);
    return c.json({ comments, history: audit.filter((e) => e.target === iid).slice(0, 30) });
  });

  app.post("/t/:tid/projects/:pid/items/:iid/comments", async (c) => {
    need(c, "comment");
    const p = await project(c);
    const item = await repo.getItem(p.tenantId, p.id, c.req.param("iid")!);
    if (!item) fail(404, "not_found", "That item no longer exists.");
    const { body: text } = await body(c, z.object({ body: z.string().trim().min(1).max(4000) }));
    const u = who(c).user;
    const comment = { tenantId: p.tenantId, projectId: p.id, itemId: item.id, id: newId("c"), at: now(), authorId: u.id, authorName: u.name || u.email, body: text };
    // The comment and its audit event land in one transaction
    await repo.table.write([repo.commentOp(comment), repo.auditOp({ tenantId: p.tenantId, actorId: u.id, action: "comment.created", target: item.id, summary: `${p.key}: ${u.name || u.email} commented on "${item.title}"` })]);
    return c.json(comment, 201);
  });

  app.delete("/t/:tid/projects/:pid/items/:iid/comments/:cid", async (c) => {
    const p = await project(c);
    const list = await repo.listComments(p.tenantId, p.id, c.req.param("iid")!);
    const cm = list.find((x) => x.id === c.req.param("cid"));
    if (!cm) fail(404, "not_found", "That comment no longer exists.");
    if (cm.authorId !== actorId(c)) need(c, "delete");
    await repo.deleteComment(cm);
    return c.json({ ok: true });
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

  /** The record named by :did, in the project given as ?p= (none for general files); a trashed project's files are gone too */
  async function doc(c: Context<Env>) {
    const tid = c.get("tenant").id, pid = c.req.query("p") || undefined;
    const [x, p] = await Promise.all([repo.getDoc(tid, pid, c.req.param("did")!), pid ? repo.getProject(tid, pid) : undefined]);
    if (!x || (pid && (!p || p.deletedAt))) fail(404, "not_found", "That file no longer exists.");
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
    if (input.projectId) {
      const p = await repo.getProject(t.id, input.projectId);
      if (!p || p.deletedAt) fail(404, "not_found", "That project doesn't exist.");
      if (p.archived) fail(409, "archived", "This project is archived. Unarchive it to add files.");
    }
    if (input.itemId) {
      const item = input.projectId ? await repo.getItem(t.id, input.projectId, input.itemId) : undefined;
      if (!item || item.kind !== "file_request") fail(400, "invalid", "Files can only answer a \"file needed\" item in the same project.");
    }
    const ts = now();
    const x = DocumentRecord.parse({ ...input, tenantId: t.id, id: newId("d"), key: "", scan: "pending", uploaded: false, version: 1, createdAt: ts, updatedAt: ts, updatedBy: actorId(c) });
    x.key = docKey(x);
    x.state = "receiving";
    // The watch row lets the sweep finish this file even if the browser never reports back
    await repo.table.write([repo.docOp(x, { create: true }), watchOp(x)]);
    return c.json({ doc: x, upload: await d.storage.putUrl(x.key, x.contentType, x.size) }, 201);
  });

  // The browser finished sending the bytes. The file becomes ready once the scan passes and the size
  // matches, now or on a later sweep; until then it shows as checking. Calling again is harmless
  app.post("/t/:tid/docs/:did/done", async (c) => {
    need(c, "comment");
    const x = await doc(c);
    return c.json(await settleFile({ repo, storage: d.storage }, x, { confirmed: true }));
  });

  // A download link, once the malware scan has passed
  app.get("/t/:tid/docs/:did/download", async (c) => {
    need(c, "read");
    const x = await doc(c);
    // Only a ready file downloads; anything else gets a check now, then a plain reason
    const cur = await settleFile({ repo, storage: d.storage }, x);
    const state = fileState(cur);
    if (state === "rejected") fail(410, "infected", "This file was flagged by the malware scan and can't be downloaded.");
    if (state === "failed") fail(410, "file_failed", FILE_PROBLEM[cur.problem ?? "missing"]);
    if (state !== "ready" || cur.scan !== "clean") fail(409, "scanning", "This file is still being checked. Try again in a minute.");
    return c.json({ url: await d.storage.getUrl(cur.key, cur.name) });
  });

  // Remove a file: the person who uploaded it, or an admin
  app.delete("/t/:tid/docs/:did", async (c) => {
    const x = await doc(c);
    if (x.updatedBy !== actorId(c)) need(c, "delete");
    else need(c, "comment");
    await d.storage.remove(x.key);
    // One transaction: the record, its sweep watch, and the audit event
    await repo.table.write([{ delete: keys.doc(x.tenantId, x.projectId, x.id) }, unwatchOp(x), repo.auditOp({ tenantId: x.tenantId, actorId: actorId(c), action: "doc.deleted", target: x.id, summary: `Removed "${x.name}"` })]);
    return c.json({ ok: true });
  });

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
