// apps/web/src/lib/export-build.test.ts - The export end to end against a fake API: the real zip
// writer (client-zip) builds the file, JSZip reads it back, and manifest.json must match what's in it,
// byte counts and checksums included. Covers retries, files left out, Trash, comments and the activity
// history, an older API without the export's routes, an empty organization, and 2,000 files past the
// in-memory limit.


import type { DocumentRecord, Item, Project, Tenant } from "@1neon/domain";
import { makeZip } from "client-zip";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { entries, gather, type Source } from "./export-build.ts";
import { MEMORY_LIMIT_BYTES, memoryWarning, sha256, zipName, type Manifest } from "./export-plan.ts";


// --- A fake organization behind a fake API -------------------------------------------------------

const org = { id: "t1", slug: "acme", clientId: "N1-0002", name: "Acme Dental", stages: [{ id: "s1", name: "Decide" }] } as unknown as Tenant;
const at = "2026-10-01T00:00:00.000Z";
const project = (key: string, deletedAt?: string) => ({ id: `p-${key}`, key, name: `Project ${key}`, stageId: "s1", health: "on_track", createdAt: at, updatedAt: at, deletedAt }) as unknown as Project;
const item = (pid: string, kind: string, extra: Partial<Item> = {}) => ({ id: `i-${pid}-${kind}`, projectId: pid, kind, title: kind, body: "", status: "open", fields: {}, createdAt: at, updatedAt: at, ...extra }) as unknown as Item;
let seq = 0;
const doc = (name: string, projectId?: string, extra: Partial<DocumentRecord> = {}) => ({ id: `d${++seq}`, name, projectId, size: 4, uploaded: true, state: "ready", createdAt: at, updatedAt: at, ...extra }) as DocumentRecord;

type Org = { live: { project: Project; items: Item[]; docs: DocumentRecord[] }[]; trash?: { project: Project; items: Item[]; docs: DocumentRecord[] }[]; history?: { comments: unknown[]; audit: unknown[] }; orgDocs: DocumentRecord[]; members?: number };
/** How a file's download goes: bytes, or failures in order (then bytes) */
type Plan = { bytes?: Uint8Array; fail?: unknown[] };

/** A Source over the fake organization; `plans` decides each file's download by doc id */
function fake(o: Org, plans: Record<string, Plan> = {}) {
  const calls: Record<string, number> = {};
  const routes: Record<string, unknown> = {
    [`/t/${org.id}/projects`]: o.live.map((d) => d.project),
    [`/t/${org.id}/members`]: Array.from({ length: o.members ?? 2 }, (_, i) => ({ userId: `u${i}`, name: `M${i}`, email: `m${i}@x.example`, access: "admin", status: "joined", invitedAt: at })),
    [`/t/${org.id}/docs`]: { docs: [...o.orgDocs, ...o.live.flatMap((d) => d.docs.filter((x) => x.state !== "receiving"))] },
    ...Object.fromEntries(o.live.map((d) => [`/t/${org.id}/projects/${d.project.id}`, d])),
  };
  // An API with the export's routes answers both; an older one (no trash given) answers neither
  if (o.trash) routes[`/t/${org.id}/export/trash`] = { projects: o.trash };
  if (o.trash) routes[`/t/${org.id}/export/history`] = o.history ?? { comments: [], audit: [] };
  const src: Source = {
    async get<T>(path: string) {
      if (!(path in routes)) throw { status: 404, body: { error: "http", message: "Not Found" } };
      return structuredClone(routes[path]) as T;
    },
    async file(path: string) {
      const id = /\/docs\/([^/?]+)\/download/.exec(path)![1]!;
      calls[id] = (calls[id] ?? 0) + 1;
      const p = plans[id] ?? {};
      const failure = p.fail?.[calls[id]! - 1];
      if (failure) throw failure;
      const b = p.bytes ?? new TextEncoder().encode(`bytes of ${id}`);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
  };
  return { src, calls };
}

/** Run the whole export into a real zip; returns the manifest and the zip read back */
async function run(o: Org, plans?: Record<string, Plan>) {
  const { src, calls } = fake(o, plans);
  const said: string[] = [];
  const g = await gather(org, src, (s) => said.push(s));
  let m: Manifest | undefined;
  const bytes = new Uint8Array(await new Response(makeZip(entries(org, g, src, (s) => said.push(s), (x) => (m = x)))).arrayBuffer());
  const zip = await JSZip.loadAsync(bytes);
  return { g, m: m!, zip, calls, said };
}

/** Every file path in the zip, folders left out */
const paths = (zip: JSZip) => Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort();

/** The manifest agrees with the zip: every included file is there with its size and checksum, no
 * omitted one is, the records are listed, and the counts add up */
async function agrees(m: Manifest, zip: JSZip) {
  const inZip = paths(zip);
  for (const f of m.files) {
    if (f.status === "omitted") {
      expect(inZip).not.toContain(f.path);
      expect(f.reason).toBeTruthy();
      continue;
    }
    const b = await zip.file(f.path)!.async("uint8array");
    expect(b.byteLength).toBe(f.bytes);
    expect(await sha256(b)).toBe(f.sha256);
  }
  for (const r of m.records) expect(await sha256(await zip.file(r.path)!.async("uint8array"))).toBe(r.sha256);
  const listed = [...m.records.map((r) => r.path), ...m.files.filter((f) => f.status === "included").map((f) => f.path), "manifest.json", "README.txt"].sort();
  expect(inZip).toEqual(listed);
  expect(m.counts.files.included + m.counts.files.omitted).toBe(m.counts.files.expected);
  expect(m.counts.files.expected).toBe(m.files.length);
  expect(JSON.parse(await zip.file("manifest.json")!.async("string"))).toEqual(m);
}


// --- The cases ------------------------------------------------------------------------------------

describe("export end to end", () => {
  it("is complete when every file arrives, and the manifest matches the zip", async () => {
    const a = project("FLOW-1");
    const { m, zip } = await run({ live: [{ project: a, items: [item(a.id, "task")], docs: [doc("plan.pdf", a.id)] }], trash: [], orgDocs: [doc("logo.png")] });
    expect(m.complete).toBe(true);
    expect(m.counts).toMatchObject({ projects: 1, trashedProjects: 0, members: 2, files: { expected: 2, included: 2, omitted: 0 } });
    expect(m.records.map((r) => r.path)).toContain("FLOW-1/project.json");
    expect((await zip.file("README.txt")!.async("string")).split("\n")[0]).toBe("This export is complete.");
    await agrees(m, zip);
  });

  it("retries a failed download once, and leaves out one that fails twice, with the reason", async () => {
    const a = project("FLOW-1");
    const flaky = doc("flaky.pdf", a.id), lost = doc("lost.pdf", a.id), bad = doc("bad.exe", a.id);
    const { m, zip, calls } = await run({ live: [{ project: a, items: [], docs: [flaky, lost, bad] }], trash: [], orgDocs: [] }, {
      [flaky.id]: { fail: [new TypeError("Failed to fetch")] },
      [lost.id]: { fail: [{ status: 403 }, { status: 403 }] },
      [bad.id]: { fail: [{ status: 410, body: { error: "infected" } }] },
    });
    expect(calls).toMatchObject({ [flaky.id]: 2, [lost.id]: 2, [bad.id]: 1 });
    expect(m.complete).toBe(false);
    expect(m.files.find((f) => f.id === flaky.id)?.status).toBe("included");
    expect(m.files.find((f) => f.id === lost.id)).toMatchObject({ status: "omitted", reason: "download failed: 403" });
    expect(m.files.find((f) => f.id === bad.id)).toMatchObject({ status: "omitted", reason: "flagged by the malware scan, so it can't be downloaded" });
    expect((await zip.file("README.txt")!.async("string")).split("\n")[0]).toBe("This export is partial: 2 files are not included (listed below and in manifest.json).");
    expect(zipName(org.slug, m.exportedAt, m.complete)).toMatch(/-partial\.zip$/);
    await agrees(m, zip);
  });

  it("lists a file whose upload never finished as omitted, not silently skipped", async () => {
    const a = project("FLOW-1");
    const half = doc("half.pdf", a.id, { state: "receiving", uploaded: false });
    const { m, zip } = await run({ live: [{ project: a, items: [], docs: [half] }], trash: [], orgDocs: [] }, { [half.id]: { fail: [{ status: 409, body: { error: "scanning" } }, { status: 409, body: { error: "scanning" } }] } });
    expect(m.files).toEqual([expect.objectContaining({ path: "FLOW-1/files/half.pdf", status: "omitted", reason: "the upload never finished" })]);
    await agrees(m, zip);
  });

  it("includes a trashed project under trash/, flagged in projects.csv, with its files", async () => {
    const a = project("FLOW-1"), gone = project("FLOW-2", "2026-10-20T09:00:00.000Z");
    const old = doc("old.pdf", gone.id);
    const { m, zip } = await run({ live: [{ project: a, items: [], docs: [] }], trash: [{ project: gone, items: [item(gone.id, "decision", { title: "Approved: A" })], docs: [old] }], orgDocs: [] });
    expect(m.complete).toBe(true);
    expect(m.counts).toMatchObject({ projects: 1, trashedProjects: 1, decisions: 1 });
    expect(m.files[0]).toMatchObject({ path: "trash/FLOW-2/files/old.pdf", trashed: true, status: "included" });
    expect(JSON.parse(await zip.file("trash/FLOW-2/project.json")!.async("string")).trashedAt).toBe("2026-10-20T09:00:00.000Z");
    const rows = (await zip.file("projects.csv")!.async("string")).trim().split("\r\n");
    expect(rows[0]).toContain(",trashed,");
    expect(rows.find((r) => r.startsWith("FLOW-2"))).toContain("2026-10-20T09:00:00.000Z");
    expect(rows.find((r) => r.startsWith("FLOW-1"))).not.toContain("2026-10-20");
    await agrees(m, zip);
  });

  it("says plainly when an older API can't read Trash, comments, or the history", async () => {
    const { m, zip } = await run({ live: [], orgDocs: [] });
    expect(m).toMatchObject({ trash: "unavailable", history: "unavailable", complete: false });
    const text = await zip.file("README.txt")!.async("string");
    expect(text.split("\n")[0]).toBe("This export is partial: projects in Trash are not included (this version of 1NEON can't export them); comments and the activity history are not included (this version of 1NEON can't export them).");
    expect(text).toContain("- Projects in Trash: this version of 1NEON can't export them; ask neon1 for them.");
    expect(paths(zip)).not.toContain("comments.csv");
    await agrees(m, zip);
  });

  it("includes every comment (in its project and comments.csv) and the activity history", async () => {
    const a = project("FLOW-1"), gone = project("FLOW-2", "2026-10-20T09:00:00.000Z");
    const t = item(a.id, "task", { title: "Send the form" }), old = item(gone.id, "task", { title: "Old task" });
    const comments = [
      { projectId: a.id, itemId: t.id, id: "c1", at, authorId: "u0", authorName: "M0", body: "Sent, see the file" },
      { projectId: gone.id, itemId: old.id, id: "c2", at, authorId: "u1", authorName: "M1", body: "=not a formula" },
    ];
    const audit = [{ tenantId: org.id, at, id: "e1", actorId: "u0", action: "project.trashed", target: gone.id, summary: "Moved FLOW-2 to Trash" }];
    const { m, zip } = await run({ live: [{ project: a, items: [t], docs: [] }], trash: [{ project: gone, items: [old], docs: [] }], history: { comments, audit }, orgDocs: [] });
    expect(m.complete).toBe(true);
    expect(m.counts).toMatchObject({ comments: 2, activity: 1 });
    expect(JSON.parse(await zip.file("FLOW-1/project.json")!.async("string")).comments.map((c: { id: string }) => c.id)).toEqual(["c1"]);
    expect(JSON.parse(await zip.file("trash/FLOW-2/project.json")!.async("string")).comments.map((c: { id: string }) => c.id)).toEqual(["c2"]);
    const rows = (await zip.file("comments.csv")!.async("string")).trim().split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain("FLOW-1,Send the form");
    expect(rows[2]).toContain("'=not a formula");
    expect(await zip.file("activity.csv")!.async("string")).toContain(`${at},M0,project.trashed,Moved FLOW-2 to Trash`);
    expect(JSON.parse(await zip.file("activity.json")!.async("string")).activity).toEqual(audit);
    await agrees(m, zip);
  });

  it("exports an empty organization as complete, records only", async () => {
    const { m, zip } = await run({ live: [], trash: [], orgDocs: [], members: 0 });
    expect(m.complete).toBe(true);
    expect(m.files).toEqual([]);
    expect(paths(zip)).toEqual(["README.txt", "activity.csv", "activity.json", "comments.csv", "decisions.csv", "invoices.csv", "items.csv", "manifest.json", "members.csv", "organization.json", "payments.csv", "projects.csv"]);
    await agrees(m, zip);
  });

  it("keeps duplicate names apart in the zip and the manifest", async () => {
    const a = project("FLOW-1");
    const { m, zip } = await run({ live: [{ project: a, items: [], docs: [doc("x.pdf", a.id), doc("x.pdf", a.id), doc("X.pdf", a.id)] }], trash: [], orgDocs: [doc("x.pdf")] });
    expect(m.files.map((f) => f.path)).toEqual(["files/x.pdf", "FLOW-1/files/x.pdf", "FLOW-1/files/x (2).pdf", "FLOW-1/files/X (3).pdf"]);
    await agrees(m, zip);
  });

  it("warns before 2,000 files past the in-memory limit, and the counts still add up", async () => {
    // Records claim 1 MB each (2,000 MB in all); the fake API sends a few bytes, so the test stays small
    const a = project("FLOW-1");
    const docs = Array.from({ length: 2000 }, (_, i) => doc(`scan-${i % 500}.pdf`, a.id, { size: 1024 ** 2 }));
    const failing = Object.fromEntries(docs.slice(0, 3).map((d) => [d.id, { fail: [{ status: 500 }, { status: 500 }] }]));
    const { g, m, zip } = await run({ live: [{ project: a, items: [], docs }], trash: [], orgDocs: [] }, failing);
    expect(g.expected).toBe(2000 * 1024 ** 2);
    expect(g.expected).toBeGreaterThan(MEMORY_LIMIT_BYTES);
    expect(memoryWarning(g.expected)).toMatch(/^This export is about 2\.0 GB\./);
    expect(m.counts.files).toEqual({ expected: 2000, included: 1997, omitted: 3 });
    expect(new Set(m.files.map((f) => f.path.toLowerCase())).size).toBe(2000);
    await agrees(m, zip);
  }, 60_000);
});
