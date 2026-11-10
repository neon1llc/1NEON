// apps/api/src/semantics.test.ts - Business meaning of dashboard numbers: completion time apart from
// edit time, health apart from activity, relative request timing anchored to a date, and honest totals
// beside bounded previews. Synthetic data on the memory table with dev auth; no network.


import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";


const OP = "pradeep@neon1.tech";
const RAJ = "raj@acmedental.example";
let app: ReturnType<typeof createApp>;
let repo: Repo;
let s: Awaited<ReturnType<typeof seed>>;


// Fresh store, seed, and app for every test
beforeEach(async () => {
  repo = new Repo(new MemoryTable());
  s = await seed(repo, OP);
  app = createApp({ cfg: { env: "local", publicUrl: "https://synthetic.invalid", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer: new MemoryMailer(), storage: new MemoryStorage() });
});
afterEach(() => vi.useRealTimers());


/** Call the API as a seeded person and parse the reply */
async function call(method: string, path: string, body?: unknown, as = OP) {
  const r = await app.request(`/1NEON/api${path}`, { method, headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}

/** A new blank project in Acme */
async function newProject(extra: Record<string, unknown> = {}) {
  const r = await call("POST", `/t/${s.acme.id}/projects`, { name: "Synthetic metrics review", template: "blank", ...extra });
  expect(r.status).toBe(201);
  return r.json.project ?? r.json;
}

const base = () => `/t/${s.acme.id}`;


// --- PS-03: completion time ---------------------------------------------------------------------------

describe("completion time", () => {
  it("keeps the completion week and on-time verdict when a done item is edited", async () => {
    const p = await newProject();
    const made = await call("POST", `${base()}/projects/${p.id}/items`, { kind: "task", title: "Synthetic task", dueDate: "2099-01-01" });
    const done = await call("PATCH", `${base()}/projects/${p.id}/items/${made.json.id}`, { version: made.json.version, status: "done" });
    expect(done.json.completedAt).toBeTruthy();
    const before = (await call("GET", `${base()}/insights`)).json;
    // Later, only the wording changes
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 9 * 864e5);
    const edited = await call("PATCH", `${base()}/projects/${p.id}/items/${made.json.id}`, { version: done.json.version, body: "A harmless wording clarification." });
    expect(edited.json.completedAt).toBe(done.json.completedAt);
    const after = (await call("GET", `${base()}/insights`)).json;
    expect(after.work.onTime).toBe(before.work.onTime);
    expect(after.work.late).toBe(before.work.late);
    const inWeek = (d: { weeks: { week: string; done: number }[] }) => Object.fromEntries(d.weeks.map((w) => [w.week, w.done]));
    const wk = Object.entries(inWeek(before)).find(([, n]) => n > 0)![0];
    expect(inWeek(after)[wk]).toBe(inWeek(before)[wk]);
  });

  it("clears on reopen and takes the latest completion when done again", async () => {
    const p = await newProject();
    const made = await call("POST", `${base()}/projects/${p.id}/items`, { kind: "task", title: "Reopened" });
    const first = await call("PATCH", `${base()}/projects/${p.id}/items/${made.json.id}`, { version: made.json.version, status: "done" });
    const reopened = await call("PATCH", `${base()}/projects/${p.id}/items/${made.json.id}`, { version: first.json.version, status: "doing" });
    expect(reopened.json.completedAt).toBeUndefined();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 864e5);
    const again = await call("PATCH", `${base()}/projects/${p.id}/items/${made.json.id}`, { version: reopened.json.version, status: "done" });
    expect(Date.parse(again.json.completedAt)).toBeGreaterThan(Date.parse(first.json.completedAt));
  });

  it("counts legacy done items without a completion time as unknown, not by their last edit", async () => {
    const p = await newProject();
    const made = await call("POST", `${base()}/projects/${p.id}/items`, { kind: "task", title: "Legacy", dueDate: "2026-11-02" });
    const stored = (await repo.getItem(s.acme.id, p.id, made.json.id))!;
    // As written before completedAt existed: done, finished date lost, edited since
    await repo.saveItem({ ...stored, status: "done", completedAt: undefined, updatedAt: new Date().toISOString(), version: stored.version + 1 }, { version: stored.version });
    const before = (await call("GET", `${base()}/insights`)).json;
    expect(before.work.doneUnknown).toBeGreaterThanOrEqual(1);
    // Editing it doesn't invent a date
    const edited = await call("PATCH", `${base()}/projects/${p.id}/items/${made.json.id}`, { version: stored.version + 1, body: "edit" });
    expect(edited.json.completedAt).toBeUndefined();
    const after = (await call("GET", `${base()}/insights`)).json;
    expect(after.work).toEqual(before.work);
    expect(after.weeks).toEqual(before.weeks);
  });
});
