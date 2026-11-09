// apps/api/src/routes/projects.ts - Projects in one organization: list, create from a template with
// its starter items, read, edit (including who decides), move between stages, and trash.


import { CreateProjectInput, Item, MoveProjectInput, UpdateProjectInput, newId, rankBetween, templateById, type Project } from "@1neon/domain";
import { z } from "zod";
import { MAX_TRANSACTION, actorId, body, byRank, defined, fail, need, now } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import { ConflictError } from "../store/types.ts";


export function projectRoutes(app: App, k: Kit) {
  const { repo, project, deciderChange, activeMembers } = k;

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
    // Soft gate: moving on past Decide without an approved decision is allowed, but needs a reason.
    // Only crossing it forward asks: a project already past Decide (one being reopened from Closed,
    // say) moves among the later stages freely
    const order = t.stages.findIndex((s) => s.id === stage.id);
    const from = t.stages.findIndex((s) => s.id === p.stageId);
    const decideAt = t.stages.findIndex((s) => s.id === "decide");
    if (stageChanged && decideAt >= 0 && order > decideAt && from <= decideAt) {
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
}
