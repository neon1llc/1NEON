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


// --- PS-05: relative request timing ---------------------------------------------------------------

describe("request timing", () => {
  it("resolves an old tab's this-month request to a due date that shows in Coming up and turns overdue", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
    const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
    // What a browser tab from before this change sends: the words' key and no date
    const r = await call("POST", `${base()}/projects/${p.id}/items`, { kind: "request", title: "Save time for synthetic orders", fields: { due: "soon" } }, RAJ);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ dueDate: "2026-11-30", requestedTiming: "this month" });
    const up = (await call("GET", `${base()}/upcoming`)).json;
    expect(up.events.find((e: { itemId?: string }) => e.itemId === r.json.id)).toMatchObject({ date: "2026-11-30", overdue: false, requestedTiming: "this month" });
    // A later month doesn't change what was asked: it's now overdue on the same date
    vi.setSystemTime(new Date("2027-01-05T15:00:00Z"));
    const later = (await call("GET", `${base()}/upcoming`)).json;
    expect(later.events.find((e: { itemId?: string }) => e.itemId === r.json.id)).toMatchObject({ date: "2026-11-30", overdue: true });
  });

  it("keeps the date the form showed, and resolves a quarter at its boundary in the organization's zone", async () => {
    const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
    const shown = await call("POST", `${base()}/projects/${p.id}/items`, { kind: "request", title: "Shown date", dueDate: "2026-12-31", fields: { due: "quarter" } }, RAJ);
    expect(shown.json).toMatchObject({ dueDate: "2026-12-31", requestedTiming: "this quarter" });
    // 03:00 UTC on Jan 1 is still Dec 31 in New York, so this quarter is the one ending Dec 31
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-01T03:00:00Z"));
    const edge = await call("POST", `${base()}/projects/${p.id}/items`, { kind: "request", title: "Edge", fields: { due: "quarter" } }, RAJ);
    expect(edge.json.dueDate).toBe("2026-12-31");
    // No rush stays undated
    const rush = await call("POST", `${base()}/projects/${p.id}/items`, { kind: "request", title: "No rush", fields: { due: "later" } }, RAJ);
    expect(rush.json.dueDate).toBeUndefined();
    expect(rush.json.requestedTiming).toBeUndefined();
  });
});


// --- PS-06: totals beside bounded previews ---------------------------------------------------------

describe("needs you and coming up", () => {
  it("returns the true total beside a preview of ten, and every action behind View all", async () => {
    const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "FLOW-1")!;
    const raj = (await repo.userIdForEmail(RAJ))!;
    const before = (await call("GET", `${base()}/workspace`, undefined, RAJ)).json.waitingTotal as number;
    for (let k = 0; k < 12; k++) await call("POST", `${base()}/projects/${p.id}/items`, { kind: "task", title: `Synthetic pending ${k + 1}`, assigneeId: raj, dueDate: `2099-01-${String(28 - k).padStart(2, "0")}` });
    const ws = (await call("GET", `${base()}/workspace`, undefined, RAJ)).json;
    expect(ws.waiting).toHaveLength(10);
    expect(ws.waitingTotal).toBe(before + 12);
    const all = (await call("GET", `${base()}/workspace?waiting=all`, undefined, RAJ)).json;
    expect(all.waiting).toHaveLength(all.waitingTotal);
    expect(all.waiting.filter((w: { title: string }) => w.title.startsWith("Synthetic pending"))).toHaveLength(12);
    // Within the same action, earlier due dates come first
    const mine = all.waiting.filter((w: { title: string }) => w.title.startsWith("Synthetic pending")).map((w: { dueDate: string }) => w.dueDate);
    expect(mine).toEqual([...mine].sort());
  });

  it("keeps an unresolved project target listed as overdue after two weeks", async () => {
    const p = (await repo.listProjects(s.acme.id)).find((x) => x.key === "SEC-1")!;
    const old = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    await call("PATCH", `${base()}/projects/${p.id}`, { version: p.version, targetDate: old });
    const up = (await call("GET", `${base()}/upcoming`)).json;
    expect(up.events.find((e: { kind: string; projectKey: string }) => e.kind === "target" && e.projectKey === "SEC-1")).toMatchObject({ date: old, overdue: true });
    // Once the project is closed, an old target has been dealt with
    const cur = (await repo.getProject(s.acme.id, p.id))!;
    await call("POST", `${base()}/projects/${p.id}/move`, { version: cur.version, stageId: "closed" });
    const after = (await call("GET", `${base()}/upcoming`)).json;
    expect(after.events.find((e: { kind: string; projectKey: string }) => e.kind === "target" && e.projectKey === "SEC-1")).toBeUndefined();
  });
});


// --- Review 2026-11-11: AUTH-P01 organization calendar, AUTH-P03 one measure rule ---------------------

describe("organization calendar", () => {
  it("reads Today, overdue, and on time in the organization's zone, not UTC (AUTH-P01)", async () => {
    const p = await newProject();
    const due = await call("POST", `${base()}/projects/${p.id}/items`, { kind: "task", title: "Synthetic due today", dueDate: "2026-11-10" });
    const late = await call("POST", `${base()}/projects/${p.id}/items`, { kind: "task", title: "Synthetic finished late", dueDate: "2026-11-10" });
    vi.useFakeTimers({ toFake: ["Date"] });
    // 01:30 UTC on the 11th is still the evening of the 10th in New York (the default zone)
    vi.setSystemTime(new Date("2026-11-11T01:30:00Z"));
    const up = (await call("GET", `${base()}/upcoming`)).json;
    expect(up.today).toBe("2026-11-10");
    expect(up.events.find((e: { itemId?: string }) => e.itemId === due.json.id)?.overdue).toBe(false);
    // Done at 04:30 UTC is 23:30 on the 10th in New York: on time. Done at 05:30 UTC is the 11th: late
    vi.setSystemTime(new Date("2026-11-11T04:30:00Z"));
    await call("PATCH", `${base()}/projects/${p.id}/items/${due.json.id}`, { version: due.json.version, status: "done" });
    vi.setSystemTime(new Date("2026-11-11T05:30:00Z"));
    await call("PATCH", `${base()}/projects/${p.id}/items/${late.json.id}`, { version: late.json.version, status: "done" });
    const work = (await call("GET", `${base()}/insights`)).json.work;
    expect(work.onTime).toBeGreaterThanOrEqual(1);
    expect(work.late).toBeGreaterThanOrEqual(1);
  });

  it("counts a measure at target in Insights by the same rule as its card (AUTH-P03)", async () => {
    const p = await newProject();
    const before = (await call("GET", `${base()}/insights`)).json.measures.reached;
    // Baseline already at target and higher is better: 11 is past the target, so reached
    await call("POST", `${base()}/projects/${p.id}/items`, { kind: "metric", title: "Synthetic at target", fields: { unit: "x", baseline: 10, target: 10, direction: "up", readings: [{ at: "2026-11-01", value: 11, note: "" }] } });
    // Lower is better with the same numbers: 11 is worse, so not reached
    await call("POST", `${base()}/projects/${p.id}/items`, { kind: "metric", title: "Synthetic lower", fields: { unit: "x", baseline: 10, target: 10, direction: "down", readings: [{ at: "2026-11-01", value: 11, note: "" }] } });
    expect((await call("GET", `${base()}/insights`)).json.measures.reached).toBe(before + 1);
  });
});


// --- Review 2026-11-11: EP-04 a create retried with its requestId makes one item ----------------------

// --- Home calendar: the organization's own events, by month, with worded activity --------------------

describe("calendar events", () => {
  it("adds leave and a monthly call, shows them by month, and records each change in words", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
    const leave = await call("POST", `${base()}/events`, { title: "Dana out", kind: "leave", personId: s.dana.id, date: "2026-11-30", endDate: "2026-12-02", repeat: "none" });
    expect(leave.status).toBe(201);
    const monthly = await call("POST", `${base()}/events`, { title: "Care check-in", kind: "care", date: "2026-11-20", time: "16:00", repeat: "monthly" });
    expect(monthly.status).toBe(201);
    // December shows the leave that started in November, and the next monthly call
    const dec = (await call("GET", `${base()}/calendar?month=2026-12`)).json;
    expect(dec.entries.find((e: { eventId?: string }) => e.eventId === leave.json.id)).toMatchObject({ date: "2026-11-30", endDate: "2026-12-02" });
    expect(dec.entries.filter((e: { eventId?: string }) => e.eventId === monthly.json.id).map((e: { date: string }) => e.date)).toEqual(["2026-12-20"]);
    expect(dec.repeating.map((e: { id: string }) => e.id)).toContain(monthly.json.id);
    // A change says what moved; a save with no change records nothing
    const moved = await call("PATCH", `${base()}/events/${monthly.json.id}`, { version: 1, time: "17:00" });
    expect(moved.status).toBe(200);
    const same = await call("PATCH", `${base()}/events/${monthly.json.id}`, { version: 2, time: "17:00" });
    expect(same.status).toBe(200);
    const log = (await call("GET", `${base()}/activity`)).json.filter((a: { target: string }) => a.target === monthly.json.id);
    expect(log.map((a: { summary: string }) => a.summary)).toContain('Updated care plan date "Care check-in": time 16:00 → 17:00');
    expect(log.filter((a: { action: string }) => a.action === "calendar.updated")).toHaveLength(1);
    // Removing it needs the version last seen, and is recorded too
    expect((await call("DELETE", `${base()}/events/${monthly.json.id}?version=1`)).status).toBe(409);
    expect((await call("DELETE", `${base()}/events/${monthly.json.id}?version=3`)).status).toBe(204);
    expect((await call("GET", `${base()}/activity`)).json.some((a: { action: string; target: string }) => a.action === "calendar.deleted" && a.target === monthly.json.id)).toBe(true);
  });

  it("refuses dates that don't make sense", async () => {
    expect((await call("POST", `${base()}/events`, { title: "Backwards", kind: "office", date: "2026-11-10", endDate: "2026-11-09", repeat: "none" })).status).toBe(400);
    expect((await call("POST", `${base()}/events`, { title: "Bad month", kind: "office", date: "2026-11-10", repeat: "monthly", until: "2026-10-01" })).status).toBe(400);
  });

  it("words item edits in the activity record", async () => {
    const p = await newProject();
    const i = await call("POST", `${base()}/projects/${p.id}/items`, { kind: "task", title: "Synthetic task" });
    await call("PATCH", `${base()}/projects/${p.id}/items/${i.json.id}`, { version: i.json.version, status: "done", dueDate: "2026-11-20" });
    const a = (await call("GET", `${base()}/activity`)).json.find((e: { target: string; action: string }) => e.target === i.json.id && e.action !== "item.created");
    expect(a.summary).toContain("status To do → Done");
    expect(a.details).toContain("due none → Nov 20, 2026");
  });
});


describe("retry-safe creates", () => {
  it("answers a repeated request with the item already made, for that person only (EP-04)", async () => {
    const p = await newProject();
    const body = { kind: "request", title: "Synthetic need", requestId: "synthetic-0001-abc" };
    const first = await call("POST", `${base()}/projects/${p.id}/items`, body);
    const again = await call("POST", `${base()}/projects/${p.id}/items`, body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.json.id).toBe(first.json.id);
    const items = (await call("GET", `${base()}/projects/${p.id}`)).json.items.filter((i: { title: string }) => i.title === "Synthetic need");
    expect(items).toHaveLength(1);
    expect(first.json.requestId).toBeUndefined();
    // No requestId: every create is its own item, as before
    await call("POST", `${base()}/projects/${p.id}/items`, { kind: "request", title: "Synthetic plain" });
    await call("POST", `${base()}/projects/${p.id}/items`, { kind: "request", title: "Synthetic plain" });
    expect((await call("GET", `${base()}/projects/${p.id}`)).json.items.filter((i: { title: string }) => i.title === "Synthetic plain")).toHaveLength(2);
  });
});
