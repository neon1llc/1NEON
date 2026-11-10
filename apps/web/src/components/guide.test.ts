// apps/web/src/components/guide.test.ts - Request timing in the request form: "this month" and "this
// quarter" become the absolute date shown before sending, ranges keep their end, and no rush has none.


import { describe, expect, it } from "vitest";
import { draftOf, dueOf, type Need } from "./Guide.tsx";


const need = (patch: Partial<Need>): Need => ({ goals: ["time"], who: "synthetic orders", now: "manual", often: "weekly", due: "", from: "", to: "", ...patch });
// 15:00 UTC on Nov 10, 2026: still Nov 10 in New York
const NOW = new Date("2026-11-10T15:00:00Z");


describe("request timing", () => {
  it("resolves this month and this quarter to an absolute due date with the words kept", () => {
    const month = draftOf(need({ due: "soon" }), NOW);
    expect(month.dueDate).toBe("2026-11-30");
    expect(month.body).toContain("Due this month (by Nov 30, 2026).");
    const quarter = draftOf(need({ due: "quarter" }), NOW);
    expect(quarter.dueDate).toBe("2026-12-31");
    expect(quarter.fields.due).toBe("quarter");
  });

  it("uses the organization's calendar at a month boundary", () => {
    // 03:00 UTC on Dec 1 is still Nov 30 in New York, but Dec 1 in Tokyo
    const edge = new Date("2026-12-01T03:00:00Z");
    expect(dueOf({ due: "soon", from: "", to: "" }, edge)).toBe("2026-11-30");
    expect(dueOf({ due: "soon", from: "", to: "" }, edge, "Asia/Tokyo")).toBe("2026-12-31");
    // Quarter ends: March, June, September, December
    expect(dueOf({ due: "quarter", from: "", to: "" }, new Date("2027-02-28T12:00:00Z"))).toBe("2027-03-31");
    expect(dueOf({ due: "quarter", from: "", to: "" }, new Date("2028-04-01T12:00:00Z"))).toBe("2028-06-30");
    // February in a leap year
    expect(dueOf({ due: "soon", from: "", to: "" }, new Date("2028-02-10T12:00:00Z"))).toBe("2028-02-29");
  });

  it("keeps picked dates and ranges, including a range with no start", () => {
    expect(draftOf(need({ due: "date", from: "2026-11-30" }), NOW).dueDate).toBe("2026-11-30");
    expect(draftOf(need({ due: "date", from: "2026-11-20", to: "2026-12-05" }), NOW).dueDate).toBe("2026-12-05");
    const endOnly = draftOf(need({ due: "date", to: "2026-12-05" }), NOW);
    expect(endOnly.dueDate).toBe("2026-12-05");
    expect(endOnly.body).toContain("Due by 2026-12-05.");
    expect(draftOf(need({ due: "later" }), NOW).dueDate).toBeUndefined();
  });
});
