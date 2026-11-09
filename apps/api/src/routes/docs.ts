// apps/api/src/routes/docs.ts - Documents: general and project files, uploaded through signed links,
// scanned before download, and the in-memory file links local dev uses instead of S3.


import { CreateDocInput, DocumentRecord, fileState, newId, VIEWABLE, type FileProblem } from "@1neon/domain";
import type { Context } from "hono";
import { settleFile, unwatchOp, watchOp } from "../files.ts";
import { actorId, body, fail, need, now, type Env } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import { MemoryStorage } from "../local.ts";
import { keys } from "../store/repo.ts";


// Why a failed file can't be downloaded, in words; the codes are defined in the domain model
const FILE_PROBLEM: Record<FileProblem, string> = {
  missing: "The file never arrived in storage. Upload it again.",
  size_mismatch: "The stored file isn't the size that was sent. Upload it again.",
  scan_failed: "The malware scan couldn't finish on this file. Upload it again, or send it another way.",
  scan_unsupported: "The malware scan can't read this kind of file (often a password-protected archive). Send it another way.",
  timeout: "The malware scan took too long on this file. Upload it again.",
};


/** Local dev only, registered ahead of the CSRF check: the in-memory store's upload and download links */
export function devFileRoutes(app: App, k: Kit) {
  const { d, cfg } = k;
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
}


export function docRoutes(app: App, k: Kit) {
  const { d, repo, allDocs } = k;

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
    // ?view=1 opens a viewable file in the browser; other types (and every plain request) download
    const view = c.req.query("view") === "1" && VIEWABLE.has(cur.contentType) ? cur.contentType : undefined;
    return c.json({ url: await d.storage.getUrl(cur.key, cur.name, view), inline: Boolean(view) });
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
}
