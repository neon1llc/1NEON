// apps/web/src/lib/export-disk.test.ts - The export's folder in the browser's private storage only
// lives while it's needed: cleared before an export, removed after the hand-off (not before), on a
// failed write, and as a stale leftover, but never while an export is being built. A fake folder.


import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Disk from "./export-disk.ts";


// --- A folder handle in memory ------------------------------------------------------------------

class FakeFile {
  data = new Uint8Array();
  constructor(readonly name: string) {}
  async createWritable() {
    const parts: Uint8Array[] = [];
    // Like the real one, the file only takes its content on close
    return new WritableStream<Uint8Array>({ write: (c) => void parts.push(c), close: () => void (this.data = new Uint8Array(parts.flatMap((p) => [...p]))) });
  }
  async getFile() {
    return new File([this.data], this.name);
  }
}

class FakeDir {
  entries = new Map<string, FakeDir | FakeFile>();
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    if (!this.entries.has(name) && o?.create) this.entries.set(name, new FakeDir());
    const d = this.entries.get(name);
    if (!(d instanceof FakeDir)) throw new DOMException("missing", "NotFoundError");
    return d;
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    if (!this.entries.has(name) && o?.create) this.entries.set(name, new FakeFile(name));
    return this.entries.get(name) as FakeFile;
  }
  async removeEntry(name: string) {
    if (!this.entries.delete(name)) throw new DOMException("missing", "NotFoundError");
  }
}

const bytes = (...chunks: number[][]) => new ReadableStream<Uint8Array>({
  start(c) {
    for (const x of chunks) c.enqueue(new Uint8Array(x));
    c.close();
  },
});

let disk: typeof Disk;
let root: FakeDir;
const asFolder = (d: FakeDir) => d as unknown as Disk.Folder;

// Fresh module state (building, last hand-off) for each test
beforeEach(async () => {
  vi.resetModules();
  disk = await import("./export-disk.ts");
  root = new FakeDir();
});


describe("export folder", () => {
  it("clears a leftover before an export and writes the zip to disk", async () => {
    const old = await root.getDirectoryHandle(disk.EXPORT_FOLDER, { create: true });
    await old.getFileHandle("export-1.zip", { create: true });
    const folder = (await disk.exportFolder(asFolder(root)))!;
    expect((folder as unknown as FakeDir).entries.size).toBe(0);
    const file = await disk.writeZip(asFolder(root), folder, bytes([1, 2], [3]));
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("removes the folder after the hand-off, not before", async () => {
    const folder = (await disk.exportFolder(asFolder(root)))!;
    await disk.writeZip(asFolder(root), folder, bytes([1]));
    let later: (() => void) | undefined, ms = 0;
    disk.clearAfterHandOff(asFolder(root), (run, wait) => ((later = run), (ms = wait)));
    expect(ms).toBe(disk.KEEP_MS);
    expect(root.entries.has(disk.EXPORT_FOLDER)).toBe(true);
    later!();
    await Promise.resolve();
    expect(root.entries.has(disk.EXPORT_FOLDER)).toBe(false);
  });

  it("removes the folder when the write fails, and passes the error on", async () => {
    const folder = (await disk.exportFolder(asFolder(root)))!;
    const broken = new ReadableStream<Uint8Array>({ pull: (c) => c.error(new Error("disk full")) });
    await expect(disk.writeZip(asFolder(root), folder, broken)).rejects.toThrow("disk full");
    expect(root.entries.has(disk.EXPORT_FOLDER)).toBe(false);
  });

  it("removes it on release (cancelled, or built in memory instead)", async () => {
    await disk.exportFolder(asFolder(root));
    await disk.release(asFolder(root));
    expect(root.entries.has(disk.EXPORT_FOLDER)).toBe(false);
    // Nothing there is fine too
    await expect(disk.clearExports(asFolder(root))).resolves.toBeUndefined();
  });

  it("never lets an earlier export's timer remove a later export's zip", async () => {
    await disk.writeZip(asFolder(root), (await disk.exportFolder(asFolder(root)))!, bytes([1]));
    let first: (() => void) | undefined;
    disk.clearAfterHandOff(asFolder(root), (run) => (first = run));
    await disk.exportFolder(asFolder(root));
    first!();
    await Promise.resolve();
    expect(root.entries.has(disk.EXPORT_FOLDER)).toBe(true);
  });
});


describe("stale leftovers", () => {
  it("are removed when Settings opens", async () => {
    await root.getDirectoryHandle(disk.EXPORT_FOLDER, { create: true });
    await disk.clearStaleExports(asFolder(root));
    expect(root.entries.has(disk.EXPORT_FOLDER)).toBe(false);
  });

  it("are left alone while this tab is building an export", async () => {
    await disk.exportFolder(asFolder(root));
    await disk.clearStaleExports(asFolder(root));
    expect(root.entries.has(disk.EXPORT_FOLDER)).toBe(true);
  });

  it("are left to the hand-off's own timer within its 30 minutes", async () => {
    await disk.writeZip(asFolder(root), (await disk.exportFolder(asFolder(root)))!, bytes([1]));
    disk.clearAfterHandOff(asFolder(root), () => undefined);
    await disk.clearStaleExports(asFolder(root));
    expect(root.entries.has(disk.EXPORT_FOLDER)).toBe(true);
    // Past it (a timer that never ran, say): removed
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + disk.KEEP_MS + 1);
    await disk.clearStaleExports(asFolder(root));
    vi.useRealTimers();
    expect(root.entries.has(disk.EXPORT_FOLDER)).toBe(false);
  });
});
