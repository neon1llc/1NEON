// apps/web/src/lib/neo.test.ts - The signed-in Neo window's logic: replies become safe pieces (links
// only inside 1NEON or to neon1's two addresses), the conversation stays within the API's limits, and
// each plan step is the same API call its page makes, with the current version read first.


import { NEO_LIMITS } from "@1neon/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";


// Every API call is recorded and answered from a small table; navigation is recorded too
const calls: { path: string; method: string; body?: unknown }[] = [];
const went: string[] = [];
vi.mock("./api.ts", () => ({
  api: async (path: string, init: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: init.method ?? "GET", body: init.body });
    if (path === "/me") return { user: { version: 7 } };
    if (path === "/t/T/members") return [{ userId: "U", version: 3 }];
    if (path === "/t/T/projects/P") return { project: { version: 4 }, items: [{ id: "I", version: 9 }] };
    return {};
  },
}));
vi.mock("./nav.ts", () => ({ navigate: (to: string) => went.push(to), refreshAll: () => undefined }));
const neo = await import("./neo.ts");

beforeEach(() => {
  calls.length = 0;
  went.length = 0;
});


describe("reply text", () => {
  it("keeps links inside 1NEON and to neon1's addresses, and drops the rest to their labels", () => {
    const p = neo.pieces("See [Board](/1NEON/o/acme/workflow), [mail](mailto:hello@neon1.tech), [x](https://evil.example), and **this**.");
    expect(p).toContainEqual({ text: "Board", href: "/1NEON/o/acme/workflow", inside: true });
    expect(p).toContainEqual({ text: "mail", href: "mailto:hello@neon1.tech", inside: false });
    expect(p).toContainEqual({ text: "x" });
    expect(p).toContainEqual({ text: "this", bold: true });
    expect(JSON.stringify(p)).not.toContain("evil.example");
  });

  it("makes paragraphs, bulleted lists, and numbered lists", () => {
    const b = neo.blocks("Here's how.\n\n1. Open the board\n2. Drag the card\n\n- one\n- two");
    expect(b.map((x) => x.kind)).toEqual(["p", "ol", "ul"]);
  });
});


describe("the conversation", () => {
  it("drops the oldest question and answer together to stay within the limits", () => {
    const long = "x".repeat(NEO_LIMITS.chars);
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: long }) as const);
    const turns = neo.fit(history, "new?");
    expect(turns.at(-1)).toEqual({ role: "user", content: "new?" });
    expect(turns[0]!.role).toBe("user");
    expect(turns.reduce((n, t) => n + t.content.length, 0)).toBeLessThanOrEqual(NEO_LIMITS.total);
    expect(neo.keep("y ".repeat(2000)).length).toBeLessThanOrEqual(NEO_LIMITS.chars);
  });
});


describe("plan steps", () => {
  it("reads the current version before each change", async () => {
    await neo.runStep({ op: "update_item", tid: "T", pid: "P", iid: "I", status: "done" });
    await neo.runStep({ op: "approve_option", tid: "T", pid: "P", iid: "I", conditions: "" });
    await neo.runStep({ op: "move_project", tid: "T", pid: "P", stageId: "S" });
    await neo.runStep({ op: "update_member", tid: "T", uid: "U", access: "viewer" });
    await neo.runStep({ op: "update_me", theme: "matrix" });
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes).toEqual([
      { path: "/t/T/projects/P/items/I", method: "PATCH", body: { version: 9, status: "done" } },
      { path: "/t/T/projects/P/items/I/approve", method: "POST", body: { version: 9, conditions: "" } },
      { path: "/t/T/projects/P/move", method: "POST", body: { version: 4, stageId: "S", reason: undefined } },
      { path: "/t/T/members/U", method: "PATCH", body: { version: 3, access: "viewer" } },
      { path: "/me", method: "PATCH", body: { version: 7, theme: "matrix" } },
    ]);
  });

  it("posts what the pages post, and only opens a page for go", async () => {
    await neo.runStep({ op: "post_update", tid: "T", pid: "P", title: "On track", health: "on_track" });
    await neo.runStep({ op: "comment", tid: "T", pid: "P", iid: "I", text: "Thanks" });
    await neo.runStep({ op: "create_project", tid: "T", name: "New", template: "blank", summary: "", outcome: "" });
    await neo.runStep({ op: "go", path: "/o/acme/people" });
    expect(calls[0]).toEqual({ path: "/t/T/projects/P/items", method: "POST", body: { kind: "update", title: "On track", fields: { health: "on_track" } } });
    expect(calls[1]).toEqual({ path: "/t/T/projects/P/items/I/comments", method: "POST", body: { body: "Thanks" } });
    expect((calls[2]!.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[a-z0-9]{8,64}$/);
    expect(calls).toHaveLength(3);
    expect(went).toEqual(["/o/acme/people"]);
  });

  it("stops when the thing to change is gone", async () => {
    await expect(neo.runStep({ op: "update_item", tid: "T", pid: "P", iid: "gone", title: "x" })).rejects.toThrow("no longer exists");
  });
});
