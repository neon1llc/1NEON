// apps/api/src/routes/items.ts - Layer items on a project (needs, execute, observe, normalize),
// approving an option into an immutable decision, and the advisory edit markers.


import { ApproveInput, CreateItemInput, DecisionFields, Item, OptionFields, UpdateItemInput, canApprove, newId, rankBetween, settableStatus, type Project } from "@1neon/domain";
import { z } from "zod";
import { actorId, body, byRank, check, defined, fail, label, need, now, validateFields, who } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import { keys } from "../store/repo.ts";


// Edit markers last two minutes; the editor's browser renews them while the form is open
const EDIT_MS = 2 * 60 * 1000;


export function itemRoutes(app: App, k: Kit) {
  const { repo, project, activeMembers } = k;

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
}


// Registered after the comment routes, where createApp always had them
export function editRoutes(app: App, k: Kit) {
  const { repo, project } = k;

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
}
