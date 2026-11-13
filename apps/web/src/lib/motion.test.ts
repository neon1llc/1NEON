// apps/web/src/lib/motion.test.ts - The check that keeps the page drawn with the address: after a
// view transition, a page that isn't the router's place sends the router there again.


import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drew, keepPageWithAddress, quietSkippedTransitions } from "./motion.ts";


// A stand-in for the browser's transition: runs the change at once and ends right away
const transition = (cb: () => void) => {
  cb();
  return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve() };
};

describe("keepPageWithAddress", () => {
  // The router's place, and how many times it was sent there again
  let place = { key: "a", idle: true };
  let again = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { startViewTransition: transition });
    quietSkippedTransitions();
    place = { key: "a", idle: true };
    again = 0;
    keepPageWithAddress(() => place, () => { again++; });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // One transition, then long enough for both of its checks to run
  const slide = async (change: () => void) => {
    (document as unknown as { startViewTransition: typeof transition }).startViewTransition(change);
    await vi.advanceTimersByTimeAsync(200);
  };

  it("leaves a page that matches the address alone", async () => {
    drew("a");
    await slide(() => { place = { key: "b", idle: true }; drew("b"); });
    expect(again).toBe(0);
  });

  it("goes to the address again when a transition drew an older page over it", async () => {
    drew("c");
    // The router is already at c; the transition's late change draws b
    place = { key: "c", idle: true };
    await slide(() => drew("b"));
    expect(again).toBeGreaterThan(0);
  });

  it("waits while the router is still on its way somewhere", async () => {
    drew("a");
    place = { key: "b", idle: false };
    await slide(() => undefined);
    expect(again).toBe(0);
  });
});
