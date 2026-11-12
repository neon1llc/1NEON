// apps/api/src/routes/members.ts - People in one organization: the member list, invitations (queued
// through the outbox with the membership), resends, and access changes.


import { InviteInput, UpdateMemberInput, changeRecord, isActiveMember, newId, type Member, type Tenant, type User } from "@1neon/domain";
import { actorId, body, defined, fail, need, now, who } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import { outboxOp } from "../outbox.ts";
import { ConflictError } from "../store/types.ts";


// A person's access, title, or status change, in words ("access Member → Admin")
function memberRecord(m: Member, next: Member) {
  const who = m.name || m.email;
  const status: Record<string, string> = { invited: "Invited", joined: "Active", deactivated: "Deactivated", on_file: "On file" };
  const changes: string[] = [];
  if (m.access !== next.access) changes.push(`access ${cap(m.access)} → ${cap(next.access)}`);
  if ((m.title ?? "") !== (next.title ?? "")) changes.push(next.title ? `title "${m.title || "none"}" → "${next.title}"` : "title cleared");
  if (m.status !== next.status) changes.push(next.status === "deactivated" ? "deactivated" : m.status === "deactivated" ? "reactivated" : `status ${status[m.status] ?? m.status} → ${status[next.status] ?? next.status}`);
  return changeRecord(`Updated ${who}`, changes);
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);


export function memberRoutes(app: App, k: Kit) {
  const { d, repo, cfg, drainNow } = k;

  // Members with their current profile details
  app.get("/t/:tid/members", async (c) => {
    need(c, "read");
    const members = await repo.listMembers(c.get("tenant").id);
    const users = await Promise.all(members.map((m) => repo.getUser(m.userId)));
    // Phone numbers stay on the person's own profile; organizations they share don't see them
    // neon1's own people are marked, so the page can show their access as neon1's to change
    return c.json(members.map((m, i) => ({ ...m, name: users[i]?.name || m.name, title: users[i]?.title || m.title, neon1: cfg.operatorEmails.includes(m.email.toLowerCase()) })));
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
        await repo.createUser({ id: uid, email: p.email, name: p.name, title: p.title, phone: "", operator: false, strongAuth: false, theme: "awake", menu: "default", version: 1, createdAt: ts, updatedAt: ts, updatedBy: inviter.id });
      } else {
        // Someone kept on file only is being invited on purpose: they may now make an account
        const u = await repo.getUser(uid);
        if (u?.recordOnly) await repo.saveUser({ ...u, recordOnly: undefined, version: u.version + 1, updatedAt: ts, updatedBy: inviter.id }, u.version);
      }
      const existing = await repo.getMember(t.id, uid);
      // Already a member: nothing to do. A deactivated or on-file member is invited
      if (existing && isActiveMember(existing)) {
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

  // Change access or deactivate (never neon1's own membership, unless neon1 does it). An organization always keeps at least one active admin: the check
  // reads the membership revision first and the write bumps it, so a concurrent change to anyone
  // else's membership makes this write fail instead of both passing the count
  app.patch("/t/:tid/members/:uid", async (c) => {
    need(c, "manage_people");
    const t = c.get("tenant");
    const rev = await repo.membershipRev(t.id);
    const m = await repo.getMember(t.id, c.req.param("uid"));
    if (!m) fail(404, "not_found", "That person isn't in this organization.");
    // Client admins manage their own people; neon1's access stays neon1's to change (Pradeep, 2026-11-09)
    if (cfg.operatorEmails.includes(m.email.toLowerCase()) && !who(c).actor.operator) fail(403, "neon1_only", "neon1's access is managed by neon1. Write to hello@neon1.tech to change it.");
    const input = await body(c, UpdateMemberInput);
    // A record on file changes only by inviting the person, never by switching them on here
    if (m.status === "on_file" && input.status) fail(400, "on_file", "This person is on file only. Invite them to give them access.");
    const next: Member = { ...m, ...defined({ access: input.access, title: input.title, status: input.status }), version: m.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    const isAdmin = (x: Member) => x.access === "admin" && isActiveMember(x);
    if (isAdmin(m) && !isAdmin(next)) {
      const admins = (await repo.listMembers(t.id)).filter(isAdmin);
      if (admins.length <= 1) fail(400, "last_admin", "An organization needs at least one admin.");
    }
    try {
      await repo.table.write([repo.memberOp(next, { version: input.version }), repo.membershipRevOp(t.id, rev), repo.auditOp({ tenantId: t.id, actorId: actorId(c), action: "member.updated", target: m.userId, ...(memberRecord(m, next) ?? { summary: `Updated ${m.email}` }) })]);
    } catch (e) {
      // Someone changed this organization's people at the same moment; nothing was saved
      if (e instanceof ConflictError) fail(409, "conflict", "Someone changed this organization's people at the same time. Reload and try again.");
      throw e;
    }
    return c.json(next);
  });
}
