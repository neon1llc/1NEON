// apps/web/src/lib/export-plan.test.ts - What the export holds, decided offline: unique paths (without
// case), Trash under trash/, plain reasons for missing files, the complete/partial line and file name,
// what's never in it and why, the in-memory size warning, and manifest counts that add up.


import type { DocumentRecord, Item, Project, Tenant } from "@1neon/domain";
import { describe, expect, it } from "vitest";
import { manifest, MEMORY_LIMIT_BYTES, memoryWarning, Paths, plan, readme, reason, sha256, verdict, zipName, type FileEntry } from "./export-plan.ts";


// --- Small records, only the fields the plan reads ----------------------------------------------

const org = { id: "t1", slug: "acme", clientId: "N1-0002", name: "Acme Dental", stages: [] } as unknown as Tenant;
const project = (key: string, deletedAt?: string) => ({ id: `p-${key}`, key, name: key, deletedAt }) as unknown as Project;
const doc = (name: string, projectId?: string, extra: Partial<DocumentRecord> = {}) => ({ id: `d-${name}-${projectId ?? "org"}-${Math.random()}`, name, projectId, size: 10, uploaded: true, state: "ready", ...extra }) as DocumentRecord;
const item = (kind: string, status = "open") => ({ id: `i-${Math.random()}`, kind, status }) as unknown as Item;
const included = (path: string, bytes = 10): FileEntry => ({ path, name: path, id: path, bytes, sha256: "x", status: "included" });


describe("paths", () => {
  it("gives repeated names their own paths, ignoring case, before the extension", () => {
    const p = new Paths();
    expect(["a.pdf", "A.pdf", "a.pdf", "notes", "notes"].map((x) => p.claim(x))).toEqual(["a.pdf", "A (2).pdf", "a (3).pdf", "notes", "notes (2)"]);
  });

  it("keeps project folders off the export's own names", () => {
    const p = new Paths(["files", "trash"]);
    expect(p.claim("files", true)).toBe("files (2)");
  });

  it("files the same name in two projects, and twice in one, without clashing", () => {
    const a = project("FLOW-1"), b = project("FLOW-2");
    const { files } = plan([
      { project: a, items: [], docs: [doc("scan.pdf", a.id), doc("scan.pdf", a.id), doc("Scan.PDF", a.id)], trashed: false },
      { project: b, items: [], docs: [doc("scan.pdf", b.id)], trashed: false },
    ], [doc("scan.pdf")]);
    expect(files.map((f) => f.path)).toEqual(["files/scan.pdf", "FLOW-1/files/scan.pdf", "FLOW-1/files/scan (2).pdf", "FLOW-1/files/Scan (3).PDF", "FLOW-2/files/scan.pdf"]);
  });

  it("puts a trashed project, and its files, under trash/", () => {
    const t = project("FLOW-9", "2026-10-01T00:00:00.000Z");
    const { held, files } = plan([{ project: t, items: [], docs: [doc("old.pdf", t.id)], trashed: true }], []);
    expect(held[0]!.folder).toBe("trash/FLOW-9");
    expect(files[0]).toMatchObject({ path: "trash/FLOW-9/files/old.pdf", trashed: true, projectKey: "FLOW-9" });
  });
});


describe("reasons", () => {
  it("says why a file is missing, in plain words", () => {
    expect(reason("checking", { status: 409, body: { error: "scanning" } })).toBe("still being checked for malware");
    expect(reason("receiving", { status: 409, body: { error: "scanning" } })).toBe("the upload never finished");
    expect(reason("rejected", { status: 410, body: { error: "infected" } })).toBe("flagged by the malware scan, so it can't be downloaded");
    expect(reason("failed", { status: 410, body: { error: "file_failed", message: "Upload it again." } })).toBe("the upload failed: Upload it again.");
    expect(reason("ready", { status: 404, body: { error: "not_found" } })).toBe("it was deleted while the export ran");
    expect(reason("ready", { status: 403 })).toBe("download failed: 403");
    expect(reason("ready", new TypeError("Failed to fetch"))).toBe("download failed: Failed to fetch");
  });
});


describe("complete or partial", () => {
  const base = { org, at: "2026-11-14T10:00:00.000Z", members: 2, comments: 3, activity: 7, records: [] };
  const all = { trash: "included", history: "included" } as const;

  it("calls an export with every file and Trash read complete", () => {
    const m = manifest({ ...base, held: [], reads: all, files: [included("files/a.pdf")] });
    expect(m.complete).toBe(true);
    expect(verdict(m)).toBe("This export is complete.");
    expect(readme(m).split("\n")[0]).toBe("This export is complete.");
    expect(zipName("acme", m.exportedAt, m.complete)).toBe("acme-1neon-export-2026-11-14-complete.zip");
  });

  it("calls one missing file partial, and lists it with its reason", () => {
    const m = manifest({ ...base, held: [], reads: all, files: [included("files/a.pdf"), { path: "files/b.pdf", name: "b.pdf", id: "b", bytes: 5, status: "omitted", reason: "download failed: 403" }] });
    expect(m.complete).toBe(false);
    expect(verdict(m)).toBe("This export is partial: 1 file is not included (listed below and in manifest.json).");
    expect(readme(m)).toContain("- files/b.pdf: download failed: 403");
    expect(zipName("acme", m.exportedAt, m.complete)).toMatch(/-partial\.zip$/);
  });

  it("calls an export partial when the API can't read Trash, and says so", () => {
    const m = manifest({ ...base, held: [], reads: { ...all, trash: "unavailable" }, files: [] });
    expect(m.complete).toBe(false);
    expect(m.counts.trashedProjects).toBeNull();
    expect(verdict(m)).toBe("This export is partial: projects in Trash are not included (this version of 1NEON can't export them).");
    expect(readme(m)).toContain("- Projects in Trash: this version of 1NEON can't export them; ask neon1 for them.");
    expect(readme(m)).not.toContain("trash/<project key>/");
  });

  it("calls an export partial when the API can't read comments and the history, and leaves their counts unknown", () => {
    const m = manifest({ ...base, held: [], reads: { ...all, history: "unavailable" }, files: [] });
    expect(m.complete).toBe(false);
    expect(m.counts).toMatchObject({ comments: null, activity: null });
    expect(verdict(m)).toBe("This export is partial: comments and the activity history are not included (this version of 1NEON can't export them).");
    expect(readme(m)).not.toContain("comments.csv");
  });

  it("says what's never in the export, without calling it partial", () => {
    const m = manifest({ ...base, held: [], reads: all, files: [] });
    expect(m.complete).toBe(true);
    expect(m.counts).toMatchObject({ comments: 3, activity: 7 });
    expect(m.notInExport.every((n) => !n.partial)).toBe(true);
    expect(m.notInExport.map((n) => n.what)).toEqual(expect.arrayContaining(["Who is editing what at the moment", expect.stringMatching(/^Invoice drafts/), expect.stringMatching(/^Each person's notifications/)]));
    const text = readme(m);
    expect(text).toContain("Not in this export\n- ");
    expect(text).toContain("comments.csv");
    expect(text).toContain("activity.csv and activity.json");
  });

  it("calls an empty organization complete, with zero counts", () => {
    const m = manifest({ ...base, members: 0, comments: 0, activity: 0, held: [], reads: all, files: [] });
    expect(m.complete).toBe(true);
    expect(m.counts).toMatchObject({ projects: 0, trashedProjects: 0, members: 0, items: {}, decisions: 0, invoices: 0, payments: 0, comments: 0, activity: 0, files: { expected: 0, included: 0, omitted: 0 } });
  });

  it("counts records by kind, live and trashed, leaving invoice drafts out of invoices", () => {
    const live = { project: project("FLOW-1"), items: [item("decision", "approved"), item("invoice", "draft"), item("invoice", "issued"), item("payment", "done"), item("task")], docs: [], trashed: false, folder: "FLOW-1" };
    const gone = { project: project("FLOW-2", "2026-10-01T00:00:00.000Z"), items: [item("task")], docs: [], trashed: true, folder: "trash/FLOW-2" };
    const m = manifest({ ...base, held: [live, gone], reads: all, files: [] });
    expect(m.counts).toMatchObject({ projects: 1, trashedProjects: 1, decisions: 1, invoices: 1, payments: 1, items: { decision: 1, invoice: 2, payment: 1, task: 2 } });
  });
});


describe("size", () => {
  it("warns only above the in-memory limit", () => {
    expect(memoryWarning(MEMORY_LIMIT_BYTES)).toBeUndefined();
    expect(memoryWarning(MEMORY_LIMIT_BYTES + 1)).toMatch(/Chrome, Edge, or Firefox on a computer/);
  });

  it("checksums with SHA-256", async () => {
    expect(await sha256(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
