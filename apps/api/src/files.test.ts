// apps/api/src/files.test.ts - A file's states from upload link to ready: a late scan finishes without
// a second upload, and missing bytes, a wrong size, refused metadata, a threat, an unreadable file, a
// provider hiccup, and a stuck scan each end where they should. Memory storage, synthetic files.


import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { sweepFiles } from "./files.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";


const OP = "pradeep@neon1.tech";
let repo: Repo;
let storage: MemoryStorage;
let app: ReturnType<typeof createApp>;
let s: Awaited<ReturnType<typeof seed>>;


// Fresh store per test; the clock is real unless a test moves it
beforeEach(async () => {
  repo = new Repo(new MemoryTable());
  storage = new MemoryStorage();
  s = await seed(repo, OP);
  app = createApp({ cfg: { env: "local", publicUrl: "https://example.invalid", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer: new MemoryMailer(), texter: new MemoryTexter(), storage });
});
afterEach(() => vi.useRealTimers());


/** Call the API as the operator */
async function call(method: string, path: string, body?: unknown) {
  const r = await app.request(`/1NEON/api${path}`, { method, headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": OP }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}

/** A "file needed" item on FLOW-1 and a 4-byte upload started for it */
async function start() {
  const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
  const ask = await call("POST", `/t/${s.acme.id}/projects/${p.id}/items`, { kind: "file_request", title: "Signed form" });
  const r = await call("POST", `/t/${s.acme.id}/docs`, { name: "form.pdf", contentType: "application/pdf", size: 4, layer: "needs", projectId: p.id, itemId: ask.json.id });
  expect(r.status).toBe(201);
  const doc = r.json.doc;
  const q = `?p=${p.id}`;
  return {
    doc,
    put: (n = 4) => storage.files.set(doc.key, { type: "application/pdf", bytes: new Uint8Array(n) }),
    done: () => call("POST", `/t/${s.acme.id}/docs/${doc.id}/done${q}`),
    download: () => call("GET", `/t/${s.acme.id}/docs/${doc.id}/download${q}`),
    item: async () => (await repo.getItem(s.acme.id, p.id, ask.json.id))!,
    audits: async () => (await repo.listAudit(s.acme.id)).filter((e) => e.action === "doc.uploaded" && e.target === doc.id),
  };
}

/** Run the scheduled sweep */
function sweep() {
  return sweepFiles({ repo, storage });
}

/** Move the clock forward */
function later(ms: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + ms);
}


describe("file states", () => {
  it("shows a file as checking while the scan runs, then makes it ready on a sweep without another upload", async () => {
    const f = await start();
    f.put();
    storage.verdicts.set(f.doc.key, "pending");
    expect((await f.done()).json.state).toBe("checking");
    expect((await f.download()).status).toBe(409);
    expect((await f.item()).status).not.toBe("done");
    // Still scanning: nothing changes
    await sweep();
    expect((await repo.getDoc(s.acme.id, f.doc.projectId, f.doc.id))!.state).toBe("checking");
    // The scan passes: the sweep finishes it, checks the item off, and records one upload
    storage.verdicts.set(f.doc.key, "clean");
    expect(await sweep()).toMatchObject({ settled: 1 });
    expect((await repo.getDoc(s.acme.id, f.doc.projectId, f.doc.id))).toMatchObject({ state: "ready", uploaded: true, scan: "clean" });
    expect((await f.item()).status).toBe("done");
    expect((await f.download()).status).toBe(200);
    // Repeats change nothing: no second audit event, no second item write
    const itemVersion = (await f.item()).version;
    await f.done();
    await sweep();
    expect(await f.audits()).toHaveLength(1);
    expect((await f.item()).version).toBe(itemVersion);
    expect(await repo.table.query("DOCWATCH")).toHaveLength(0);
  });

  it("keeps a file receiving while bytes are in flight, then marks it missing", async () => {
    const f = await start();
    expect((await f.done()).json.state).toBe("receiving");
    later(16 * 60_000);
    await sweep();
    const x = await repo.getDoc(s.acme.id, f.doc.projectId, f.doc.id);
    expect(x).toMatchObject({ state: "failed", problem: "missing" });
    const dl = await f.download();
    expect(dl.status).toBe(410);
    expect(dl.json.error).toBe("file_failed");
    expect((await f.item()).status).not.toBe("done");
  });

  it("finishes a file whose browser never reported back", async () => {
    const f = await start();
    f.put();
    await sweep();
    expect((await repo.getDoc(s.acme.id, f.doc.projectId, f.doc.id))!.state).toBe("ready");
    expect((await f.item()).status).toBe("done");
  });

  it("fails a file of the wrong size, and never checks the item off", async () => {
    const f = await start();
    f.put(7);
    expect((await f.done()).json).toMatchObject({ state: "failed", problem: "size_mismatch" });
    expect((await f.item()).status).not.toBe("done");
    expect(await f.audits()).toHaveLength(0);
  });

  it("keeps checking when metadata is refused or the provider stumbles, then finishes", async () => {
    const f = await start();
    f.put();
    storage.inspections.set(f.doc.key, { kind: "denied" });
    expect((await f.done()).json.state).toBe("checking");
    storage.inspections.set(f.doc.key, { kind: "error", code: "SlowDown" });
    await sweep();
    expect((await repo.getDoc(s.acme.id, f.doc.projectId, f.doc.id))!.state).toBe("checking");
    storage.verdicts.set(f.doc.key, "error");
    await sweep();
    expect((await repo.getDoc(s.acme.id, f.doc.projectId, f.doc.id))!.state).toBe("checking");
    storage.inspections.delete(f.doc.key);
    storage.verdicts.delete(f.doc.key);
    await sweep();
    expect((await repo.getDoc(s.acme.id, f.doc.projectId, f.doc.id))!.state).toBe("ready");
  });

  it("rejects a flagged file and fails one the scan can't read, each with its own reason", async () => {
    const bad = await start();
    bad.put();
    storage.verdicts.set(bad.doc.key, "infected");
    expect((await bad.done()).json).toMatchObject({ state: "rejected", scan: "infected" });
    expect((await bad.download()).json.error).toBe("infected");
    expect((await bad.item()).status).not.toBe("done");
    const odd = await start();
    odd.put();
    storage.verdicts.set(odd.doc.key, "unsupported");
    expect((await odd.done()).json).toMatchObject({ state: "failed", problem: "scan_unsupported" });
  });

  it("gives up on a scan that never finishes", async () => {
    const f = await start();
    f.put();
    storage.verdicts.set(f.doc.key, "pending");
    await f.done();
    later(7 * 60 * 60_000);
    await sweep();
    expect(await repo.getDoc(s.acme.id, f.doc.projectId, f.doc.id)).toMatchObject({ state: "failed", problem: "timeout" });
  });
});
