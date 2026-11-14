// apps/api/src/export.test.ts - The export's admin routes: an admin reads trashed projects with their
// items and files and downloads those files through the usual malware checks, and reads every comment
// and the whole audit trail; members who aren't admins, other organizations, and live projects are
// all refused. Memory store, synthetic files.


import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";


const OP = "pradeep@neon1.tech";
const RAJ = "raj@acmedental.example"; // Acme admin, strong sign-in
const DANA = "dana@acmedental.example"; // Acme editor
let repo: Repo;
let storage: MemoryStorage;
let app: ReturnType<typeof createApp>;
let s: Awaited<ReturnType<typeof seed>>;


beforeEach(async () => {
  repo = new Repo(new MemoryTable());
  storage = new MemoryStorage();
  s = await seed(repo, OP);
  app = createApp({ cfg: { env: "local", publicUrl: "https://example.invalid", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer: new MemoryMailer(), texter: new MemoryTexter(), storage });
});


/** Call the API as `who` */
async function call(who: string, method: string, path: string, body?: unknown) {
  const r = await app.request(`/1NEON/api${path}`, { method, headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": who }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}

/** FLOW-1 with one ready 4-byte file, then moved to Trash; returns the project and the file */
async function trashWithFile(bytes = 4) {
  const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
  const up = await call(RAJ, "POST", `/t/${s.acme.id}/docs`, { name: "form.pdf", contentType: "application/pdf", size: bytes, layer: "needs", projectId: p.id });
  expect(up.status).toBe(201);
  const doc = up.json.doc;
  storage.files.set(doc.key, { type: "application/pdf", bytes: new Uint8Array(bytes) });
  expect((await call(RAJ, "POST", `/t/${s.acme.id}/docs/${doc.id}/done?p=${p.id}`)).json.state).toBe("ready");
  const cur = (await repo.getProject(s.acme.id, p.id))!;
  expect((await call(RAJ, "DELETE", `/t/${s.acme.id}/projects/${p.id}`, { version: cur.version, confirm: p.key })).status).toBe(200);
  return { p, doc };
}


describe("export: trashed projects", () => {
  it("gives an admin every trashed project with its items and files", async () => {
    const { p, doc } = await trashWithFile();
    const r = await call(RAJ, "GET", `/t/${s.acme.id}/export/trash`);
    expect(r.status).toBe(200);
    expect(r.json.projects).toHaveLength(1);
    const [t] = r.json.projects;
    expect(t.project.id).toBe(p.id);
    expect(t.project.deletedAt).toBeTruthy();
    expect(t.items.length).toBeGreaterThan(0);
    expect(t.docs.map((d: { id: string }) => d.id)).toEqual([doc.id]);
    // The normal reads still treat it as gone
    expect((await call(RAJ, "GET", `/t/${s.acme.id}/projects/${p.id}`)).status).toBe(404);
  });

  it("answers an empty list when nothing is in Trash", async () => {
    const r = await call(RAJ, "GET", `/t/${s.acme.id}/export/trash`);
    expect(r.status).toBe(200);
    expect(r.json.projects).toEqual([]);
  });

  it("refuses a member who isn't an admin", async () => {
    await trashWithFile();
    expect((await call(DANA, "GET", `/t/${s.acme.id}/export/trash`)).status).toBe(403);
  });

  it("refuses another organization's id", async () => {
    // Raj isn't a member of Harbor: 404, so outsiders can't tell it exists
    const r = await call(RAJ, "GET", `/t/${s.harbor.id}/export/trash`);
    expect(r.status).toBe(404);
  });
});


describe("export: files in trashed projects", () => {
  it("downloads for an admin through the usual signed link", async () => {
    const { p, doc } = await trashWithFile();
    const r = await call(RAJ, "GET", `/t/${s.acme.id}/export/trash/${p.id}/docs/${doc.id}/download`);
    expect(r.status).toBe(200);
    expect(r.json.url).toContain("/dev-files/");
    // The normal download still refuses: the project is gone as far as it's concerned
    expect((await call(RAJ, "GET", `/t/${s.acme.id}/docs/${doc.id}/download?p=${p.id}`)).status).toBe(404);
  });

  it("refuses a member who isn't an admin", async () => {
    const { p, doc } = await trashWithFile();
    expect((await call(DANA, "GET", `/t/${s.acme.id}/export/trash/${p.id}/docs/${doc.id}/download`)).status).toBe(403);
  });

  it("keeps the malware checks: a file still being scanned isn't handed out", async () => {
    const { p, doc } = await trashWithFile();
    // A file whose scan hadn't finished when the project was trashed: re-marking it stands in for one
    const x = (await repo.getDoc(s.acme.id, p.id, doc.id))!;
    await repo.saveDoc({ ...x, state: "checking", scan: "pending", uploaded: false }, { always: true });
    storage.verdicts.set(x.key, "pending");
    expect((await call(RAJ, "GET", `/t/${s.acme.id}/export/trash/${p.id}/docs/${doc.id}/download`)).status).toBe(409);
    storage.verdicts.set(x.key, "infected");
    expect((await call(RAJ, "GET", `/t/${s.acme.id}/export/trash/${p.id}/docs/${doc.id}/download`)).status).toBe(410);
  });

  it("refuses a live project on the trash routes", async () => {
    const live = (await repo.listProjects(s.acme.id)).find((x) => x.key !== "FLOW-1")!;
    const up = await call(RAJ, "POST", `/t/${s.acme.id}/docs`, { name: "a.pdf", contentType: "application/pdf", size: 4, layer: "needs", projectId: live.id });
    storage.files.set(up.json.doc.key, { type: "application/pdf", bytes: new Uint8Array(4) });
    await call(RAJ, "POST", `/t/${s.acme.id}/docs/${up.json.doc.id}/done?p=${live.id}`);
    const r = await call(RAJ, "GET", `/t/${s.acme.id}/export/trash/${live.id}/docs/${up.json.doc.id}/download`);
    expect(r.status).toBe(404);
  });
});


describe("export: comments and the audit trail", () => {
  it("gives an admin every comment, trashed projects included, and the whole audit trail", async () => {
    const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "SEC-1")!;
    const [item] = await repo.listItems(s.acme.id, p.id);
    expect((await call(RAJ, "POST", `/t/${s.acme.id}/projects/${p.id}/items/${item!.id}/comments`, { body: "Live comment" })).status).toBe(201);
    const { p: gone } = await trashWithFile();
    const goneItem = (await repo.listItems(s.acme.id, gone.id))[0]!;
    await repo.table.write([repo.commentOp({ tenantId: s.acme.id, projectId: gone.id, itemId: goneItem.id, id: "c-old", at: new Date().toISOString(), authorId: "u", authorName: "Dana Kim", body: "Before the trash" })]);
    // More events than the Activity page's 100
    for (let i = 0; i < 120; i++) await repo.table.write([repo.auditOp({ tenantId: s.acme.id, actorId: "u", action: "test.event", target: `x${i}`, summary: `Event ${i}` })]);
    const r = await call(RAJ, "GET", `/t/${s.acme.id}/export/history`);
    expect(r.status).toBe(200);
    expect(r.json.comments.map((x: { body: string }) => x.body)).toEqual(expect.arrayContaining(["Live comment", "Before the trash"]));
    expect(r.json.audit.length).toBeGreaterThan(120);
    // Oldest first
    const ats = r.json.audit.map((e: { at: string }) => e.at);
    expect([...ats].sort()).toEqual(ats);
  });

  it("refuses a member who isn't an admin, and another organization", async () => {
    expect((await call(DANA, "GET", `/t/${s.acme.id}/export/history`)).status).toBe(403);
    expect((await call(RAJ, "GET", `/t/${s.harbor.id}/export/history`)).status).toBe(404);
  });
});
