// apps/api/src/routes/export.ts - Reads for the admin's "Download everything" export only, so it can
// hold everything the organization has: Trash (which every other route treats as gone) and its files,
// and the full history (every comment, and the whole audit trail where Activity shows the latest).
// Read only, admins only.


import type { Context } from "hono";
import { byRank, fail, need, who, type Env } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import { downloadLink } from "./docs.ts";


export function exportRoutes(app: App, k: Kit) {
  const { repo } = k;

  /** The trashed project in :pid; a live project (or none) isn't on these routes */
  async function trashed(c: Context<Env>) {
    const p = await repo.getProject(c.get("tenant").id, c.req.param("pid")!);
    if (!p || !p.deletedAt) fail(404, "not_found", "That project isn't in Trash.");
    return p;
  }

  // Every trashed project with its items and files, as the project read gives a live one. Admins only:
  // the same check as Settings, so it also needs a confirmed (strong) sign-in
  app.get("/t/:tid/export/trash", async (c) => {
    need(c, "manage_settings");
    const t = c.get("tenant");
    const operator = who(c).actor.operator;
    const projects = await Promise.all((await repo.listTrashedProjects(t.id)).map(async (project) => {
      const [items, docs] = await Promise.all([repo.listItems(t.id, project.id), repo.listDocs(t.id, project.id)]);
      // Invoice drafts are neon1's working copies, hidden from clients here as on a live project
      const shown = operator ? items : items.filter((i) => !(i.kind === "invoice" && i.status === "draft"));
      return { project, items: shown.sort(byRank), docs };
    }));
    return c.json({ projects });
  });

  // Every comment on every item (live and trashed projects), and the whole audit trail, oldest first
  app.get("/t/:tid/export/history", async (c) => {
    need(c, "manage_settings");
    const t = c.get("tenant");
    const operator = who(c).actor.operator;
    const all = [...(await repo.listProjects(t.id)), ...(await repo.listTrashedProjects(t.id))];
    // Comments on an invoice draft stay with neon1, like the draft itself
    const onProject = async (pid: string) => {
      const [list, items] = await Promise.all([repo.listProjectComments(t.id, pid), operator ? [] : repo.listItems(t.id, pid)]);
      const hidden = new Set(items.filter((i) => i.kind === "invoice" && i.status === "draft").map((i) => i.id));
      return list.filter((x) => !hidden.has(x.itemId));
    };
    const [comments, audit] = await Promise.all([
      Promise.all(all.map((p) => onProject(p.id))).then((x) => x.flat().sort((a, b) => a.at.localeCompare(b.at))),
      repo.listAllAudit(t.id),
    ]);
    return c.json({ comments, audit });
  });

  // A file in a trashed project: the same signed link and malware checks as any download
  app.get("/t/:tid/export/trash/:pid/docs/:did/download", async (c) => {
    need(c, "manage_settings");
    const p = await trashed(c);
    const x = await repo.getDoc(p.tenantId, p.id, c.req.param("did")!);
    if (!x) fail(404, "not_found", "That file no longer exists.");
    return c.json(await downloadLink(k, x));
  });
}
