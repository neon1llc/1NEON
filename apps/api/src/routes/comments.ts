// apps/api/src/routes/comments.ts - Comments and history on one item: read with its audit trail,
// add (with its audit event in the same transaction), and remove.


import { newId } from "@1neon/domain";
import { z } from "zod";
import { actorId, body, fail, need, now, who } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";


export function commentRoutes(app: App, k: Kit) {
  const { repo, project } = k;

  // Comments and history on one item. Anyone who can comment may add one; authors and admins remove them
  app.get("/t/:tid/projects/:pid/items/:iid/comments", async (c) => {
    need(c, "read");
    const p = await project(c);
    const iid = c.req.param("iid")!;
    const [comments, audit, items] = await Promise.all([repo.listComments(p.tenantId, p.id, iid), repo.listAudit(p.tenantId, 1000), repo.listItems(p.tenantId, p.id)]);
    // An option's history includes its decisions (approved, changed) as well as its own edits
    const related = new Set([iid, ...items.filter((i) => i.kind === "decision" && i.fields.optionId === iid).map((i) => i.id)]);
    return c.json({ comments, history: audit.filter((e) => e.target !== undefined && related.has(e.target)).slice(0, 40) });
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
}
