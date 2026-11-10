// apps/web/src/lib/devuser.test.ts - The demo's chosen person with browser storage refused: picking
// still works for the tab, and the page learns that nothing will survive a reload.


import { beforeEach, describe, expect, it, vi } from "vitest";


// A localStorage whose every call throws, as a browser that denies storage does
const denied = {
  getItem: () => { throw new DOMException("denied", "SecurityError"); },
  setItem: () => { throw new DOMException("denied", "SecurityError"); },
  removeItem: () => { throw new DOMException("denied", "SecurityError"); },
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("location", { pathname: "/1NEON/demo/" });
});


describe("devUser with storage denied", () => {
  it("keeps the chosen person in memory and reports that saving failed", async () => {
    vi.stubGlobal("localStorage", denied);
    const { devUser } = await import("./devuser.ts");
    const persist = await import("./persist.ts");
    expect(devUser.get()).toBe("");
    devUser.set("dana@acmedental.example");
    expect(devUser.get()).toBe("dana@acmedental.example");
    expect(persist.persisting()).toBe(false);
    devUser.set("");
    expect(devUser.get()).toBe("");
  });

  it("uses storage when it works, and reports nothing", async () => {
    const box = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => box.set(k, v), removeItem: (k: string) => box.delete(k) });
    const { devUser } = await import("./devuser.ts");
    const persist = await import("./persist.ts");
    devUser.set("raj@acmedental.example");
    expect(box.get("1neon.devUser")).toBe("raj@acmedental.example");
    expect(persist.persisting()).toBe(true);
  });

  it("keeps the live playback's person apart from the demo's", async () => {
    const box = new Map<string, string>();
    vi.stubGlobal("location", { pathname: "/1NEON/live" });
    vi.stubGlobal("localStorage", { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => box.set(k, v), removeItem: (k: string) => box.delete(k) });
    const { devUser } = await import("./devuser.ts");
    devUser.set("maria@maplestreetbakery.example");
    expect([...box.keys()]).toEqual(["1neon.liveUser"]);
  });

  it("sends the chosen person with API calls even when storage is denied", async () => {
    vi.stubGlobal("localStorage", denied);
    vi.stubGlobal("location", { pathname: "/1NEON/o/acme/workspace" });
    const seen: Headers[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => { seen.push(new Headers(init.headers)); return new Response("{}", { status: 200 }); });
    const api = await import("./api.ts");
    api.devUser.set("dana@acmedental.example");
    await api.api("/me");
    // Local development counts as picking a person (import.meta.env.DEV under vitest)
    expect(seen[0]!.get("x-dev-user")).toBe(api.pickPerson ? "dana@acmedental.example" : null);
  });
});
