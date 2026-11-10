// apps/web/src/lib/reads.test.ts - Failed reads: which screen each answer gets, and replies that
// aren't what a page expects turning into a failure instead of a blank page.


import { beforeAll, describe, expect, it, vi } from "vitest";


// The API client reads the page address when it loads, so a stand-in address comes first; the
// session-ended signal goes to a plain event target standing in for the window
const events = new EventTarget();
vi.stubGlobal("location", { pathname: "/1NEON/o/acme/workspace" });
vi.stubGlobal("dispatchEvent", (e: Event) => events.dispatchEvent(e));
let reads: typeof import("./reads.ts");
let api: typeof import("./api.ts");
beforeAll(async () => {
  api = await import("./api.ts");
  reads = await import("./reads.ts");
});


/** Answer every fetch with this status and body text; each test sets its own */
function reply(status: number, text: string) {
  vi.stubGlobal("fetch", async () => new Response(text, { status }));
}


describe("failureOf", () => {
  it("sorts each answer into the screen it gets", () => {
    const http = (status: number) => new api.HttpError(status, { error: "x", message: "x" });
    expect(reads.failureOf(http(401))).toBe("session");
    // Forbidden and missing share one bucket, so the page can't hint which it was
    expect(reads.failureOf(http(403))).toBe("unavailable");
    expect(reads.failureOf(http(404))).toBe("unavailable");
    expect(reads.failureOf(http(429))).toBe("busy");
    expect(reads.failureOf(http(503))).toBe("busy");
    expect(reads.failureOf(http(500))).toBe("broken");
    expect(reads.failureOf(new TypeError("Failed to fetch"))).toBe("broken");
    expect(reads.failureOf(new reads.BadReply("/x"))).toBe("broken");
  });

  it("keeps old data only for failures that don't question access", () => {
    expect(reads.hidesData("session")).toBe(true);
    expect(reads.hidesData("unavailable")).toBe(true);
    expect(reads.hidesData("busy")).toBe(false);
    expect(reads.hidesData("broken")).toBe(false);
  });

  it("calls only a missing answer offline", () => {
    expect(reads.offline(new TypeError("Failed to fetch"))).toBe(true);
    expect(reads.offline(new api.HttpError(500, { error: "x", message: "x" }))).toBe(false);
    expect(reads.offline(new reads.BadReply("/x"))).toBe(false);
  });
});


describe("read", () => {
  const detail = { project: "object", items: "array", docs: "array", edits: "array" } as const;

  it("passes a reply of the right shape through", async () => {
    reply(200, JSON.stringify({ project: { id: "p" }, items: [], docs: [], edits: [] }));
    await expect(reads.read("/t/1/projects/p", detail)).resolves.toMatchObject({ project: { id: "p" } });
  });

  it("turns a 2xx that isn't JSON, is empty, or has the wrong shape into BadReply", async () => {
    for (const text of ["<html>gateway</html>", "", "null", "[]", JSON.stringify({ project: {}, items: {} })]) {
      reply(200, text);
      await expect(reads.read("/t/1/projects/p", detail)).rejects.toBeInstanceOf(reads.BadReply);
    }
    reply(200, JSON.stringify({ length: 0 }));
    await expect(reads.read("/t/1/projects", "array")).rejects.toBeInstanceOf(reads.BadReply);
  });

  it("keeps the status of an HTTP failure, even with a non-JSON body", async () => {
    reply(503, "<html>busy</html>");
    const e = await reads.read("/t/1/projects", "array").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(api.HttpError);
    expect(reads.failureOf(e)).toBe("busy");
  });

  it("signals an ended sign-in on a 401 from any call but the session check", async () => {
    const heard = vi.fn();
    events.addEventListener("1neon:signed-out", heard);
    reply(401, JSON.stringify({ error: "unauthenticated", message: "Sign in." }));
    await reads.read("/t/1/projects", "array").catch(() => undefined);
    expect(heard).toHaveBeenCalledTimes(1);
    // The session check's own 401 is what shows sign-in, so it doesn't signal itself
    await reads.read("/me", { user: "object", orgs: "array" }).catch(() => undefined);
    expect(heard).toHaveBeenCalledTimes(1);
    events.removeEventListener("1neon:signed-out", heard);
  });

  it("gives reads and writes a deadline", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      seen.push(init.signal);
      return new Response("[]", { status: 200 });
    });
    await reads.read("/t/1/projects", "array");
    await api.api("/t/1/projects", { method: "POST", body: {} });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[1]).toBeInstanceOf(AbortSignal);
  });
});
