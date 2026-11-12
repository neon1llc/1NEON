// apps/web/src/lib/head.test.ts - The route intent map: what each kind of route asks of search
// engines, checked route by route.


import { describe, expect, it } from "vitest";
import { headFor } from "./head.ts";


describe("headFor", () => {
  it.each([
    "/1NEON/", "/1NEON", "/1NEON/me", "/1NEON/o/acme/workspace", "/1NEON/o/acme/projects/PRJ-1/needs", "/1NEON/all/workflow",
    "/1NEON/demo/", "/1NEON/demo/o/acme-dental/projects", "/1NEON/live", "/1NEON/live/o/maple-street/workspace",
  ])("keeps %s out of search", (path) => {
    expect(headFor(path).noindex).toBe(true);
    expect(headFor(path).canonical).toBeUndefined();
  });

  it("lets the sample project be indexed under its own address", () => {
    const h = headFor("/1NEON/example");
    expect(h.noindex).toBeUndefined();
    expect(h.canonical).toBe("https://neon1.tech/1NEON/example");
  });

  it("credits the knowledge center's copy of the FAQs", () => {
    const h = headFor("/1NEON/faqs");
    expect(h.noindex).toBeUndefined();
    expect(h.canonical).toBe("https://neon1.tech/knowledge/faq/1neon-help/");
  });

  it("gives every route its own title and a description", () => {
    const paths = ["/1NEON/", "/1NEON/example", "/1NEON/faqs", "/1NEON/privacy", "/1NEON/terms", "/1NEON/cookies", "/1NEON/demo/", "/1NEON/live", "/1NEON/o/a/insights"];
    const titles = paths.map((p) => headFor(p).title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const p of paths) expect(headFor(p).description.length).toBeGreaterThan(20);
  });

  it("credits the knowledge center's copy of each policy", () => {
    for (const p of ["privacy", "terms", "cookies"]) expect(headFor(`/1NEON/${p}`).canonical).toBe(`https://neon1.tech/knowledge/policies/${p}/`);
  });

  it("never canonicalizes unrelated routes to the home page", () => {
    for (const p of ["/1NEON/privacy", "/1NEON/o/a/workspace", "/1NEON/demo/"]) expect(headFor(p).canonical ?? "").not.toMatch(/^https:\/\/neon1\.tech\/?$/);
  });
});
