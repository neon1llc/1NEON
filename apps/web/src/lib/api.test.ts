// apps/web/src/lib/api.test.ts - Every request ends: reads and writes both carry a deadline, and a
// write with no answer becomes Unconfirmed, is announced for a re-read, and is never sent twice.


import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";


// The API client reads the page address when it loads; events go to a stand-in for the window
const events = new EventTarget();
vi.stubGlobal("location", { pathname: "/1NEON/o/acme/workspace" });
vi.stubGlobal("dispatchEvent", (e: Event) => events.dispatchEvent(e));
let api: typeof import("./api.ts");
beforeAll(async () => {
  api = await import("./api.ts");
});
afterEach(() => vi.restoreAllMocks());


/** A server that never answers: the request settles only when its signal aborts */
function silentServer() {
  const calls: RequestInit[] = [];
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    calls.push(init);
    return new Promise((_, fail) => init.signal?.addEventListener("abort", () => fail(init.signal!.reason)));
  });
  return calls;
}

/** Deadlines the test fires by hand, recording how long each one was set for */
function manualDeadlines() {
  const set: { ms: number; ctl: AbortController }[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const ctl = new AbortController();
    set.push({ ms, ctl });
    return ctl.signal;
  });
  return set;
}


describe("api deadlines", () => {
  it("gives a write its own bounded deadline", async () => {
    const calls = silentServer();
    const deadlines = manualDeadlines();
    const pending = api.api("/t/1/projects", { method: "POST", body: { name: "x" } });
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.signal).toBeDefined();
    expect(deadlines.map((d) => d.ms)).toEqual([api.WRITE_DEADLINE]);
    deadlines[0]!.ctl.abort(new DOMException("timed out", "TimeoutError"));
    await expect(pending).rejects.toBeInstanceOf(api.Unconfirmed);
  });

  it("announces an unconfirmed write once and never sends it again", async () => {
    const calls = silentServer();
    const deadlines = manualDeadlines();
    const heard: unknown[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent).detail);
    events.addEventListener("1neon:unconfirmed", listen);
    const pending = api.api("/t/1/items/9/approve", { method: "POST", body: { version: 1 } });
    await Promise.resolve();
    deadlines[0]!.ctl.abort(new DOMException("timed out", "TimeoutError"));
    await pending.catch(() => undefined);
    events.removeEventListener("1neon:unconfirmed", listen);
    expect(heard).toEqual([{ method: "POST", path: "/t/1/items/9/approve" }]);
    expect(calls).toHaveLength(1);
  });

  it("treats a dropped connection on a write as unconfirmed too", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    await expect(api.api("/t/1/members/invite", { method: "POST", body: {} })).rejects.toBeInstanceOf(api.Unconfirmed);
  });

  it("keeps reads as ordinary failures the page can retry", async () => {
    silentServer();
    const deadlines = manualDeadlines();
    const pending = api.api("/me");
    await Promise.resolve();
    expect(deadlines.map((d) => d.ms)).toEqual([20_000]);
    deadlines[0]!.ctl.abort(new DOMException("timed out", "TimeoutError"));
    const e = await pending.catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(api.Unconfirmed);
  });

  it("still returns answered writes normally", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "p1" }), { status: 200 }));
    await expect(api.api("/t/1/projects", { method: "POST", body: {} })).resolves.toEqual({ id: "p1" });
  });
});
