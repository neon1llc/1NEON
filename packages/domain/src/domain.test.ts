// packages/domain/src/domain.test.ts - Domain rules that everything else trusts: permissions,
// ordering, IDs, and metric progress.


import { describe, expect, it } from "vitest";
import { can, type Action } from "./access.ts";
import { initialRanks, rankBetween } from "./rank.ts";
import { formatClientId, newId, slugify } from "./ids.ts";
import { metricProgress, MetricFields } from "./model.ts";


// Actors: a plain member, the same member with strong sign-in, and the operator
const member = { userId: "u1", operator: false, strongAuth: false };
const strong = { ...member, strongAuth: true };
const operator = { userId: "op", operator: true, strongAuth: true };


// The permission table, level by level
describe("can()", () => {
  // Every action, so each case checks the full table
  const all: Action[] = ["read", "comment", "write", "approve", "delete", "manage_people", "manage_settings", "manage_orgs"];

  it("refuses non-members everything", () => {
    for (const a of all) expect(can(member, a, undefined).ok).toBe(false);
  });

  it("lets viewers read, comment, and approve only", () => {
    const ok = all.filter((a) => can(member, a, "viewer").ok);
    expect(ok).toEqual(["read", "comment", "approve"]);
  });

  it("lets editors write but not manage", () => {
    const ok = all.filter((a) => can(member, a, "editor").ok);
    expect(ok).toEqual(["read", "comment", "write", "approve"]);
  });

  it("requires strong sign-in for admin actions", () => {
    expect(can(member, "manage_people", "admin")).toEqual({ ok: false, reason: "strong_auth_required" });
    expect(can(strong, "manage_people", "admin").ok).toBe(true);
    expect(can(strong, "manage_orgs", "admin").ok).toBe(false);
  });

  it("treats the operator as admin everywhere and lets only them manage orgs", () => {
    for (const a of all) expect(can(operator, a, undefined).ok).toBe(true);
  });

  it("makes the All clients view read only, even for the operator", () => {
    expect(can(operator, "read", undefined, "all").ok).toBe(true);
    for (const a of all.filter((x) => x !== "read")) {
      expect(can(operator, a, undefined, "all")).toEqual({ ok: false, reason: "read_only_view" });
    }
    expect(can(strong, "read", "admin", "all")).toEqual({ ok: false, reason: "forbidden" });
  });
});


// Ranks must keep strict order however cards are shuffled
describe("rankBetween()", () => {
  it("orders correctly under many random inserts", () => {
    let ranks = initialRanks(5);
    for (let n = 0; n < 500; n++) {
      const i = Math.floor(Math.random() * (ranks.length + 1));
      const r = rankBetween(ranks[i - 1] ?? "", ranks[i] ?? "");
      if (i > 0) expect(r > ranks[i - 1]!).toBe(true);
      if (i < ranks.length) expect(r < ranks[i]!).toBe(true);
      ranks = [...ranks.slice(0, i), r, ...ranks.slice(i)];
    }
    expect([...ranks].sort()).toEqual(ranks);
  });

  it("handles adjacent ranks", () => {
    const r = rankBetween("a", "b");
    expect(r > "a" && r < "b").toBe(true);
    const s = rankBetween("az", "b");
    expect(s > "az" && s < "b").toBe(true);
    expect(() => rankBetween("b", "a")).toThrow();
  });
});


// ID order and uniqueness, slugs, and client ID formatting
describe("ids", () => {
  it("makes sortable unique ids", () => {
    const a = newId("t_");
    expect(a).toMatch(/^t_[0-9a-z]{22}$/);
    expect(new Set(Array.from({ length: 1000 }, () => newId())).size).toBe(1000);
  });
  it("slugifies and formats client ids", () => {
    expect(slugify("Acme Dental Group, LLC")).toBe("acme-dental-group-llc");
    expect(formatClientId(7)).toBe("N1-0007");
  });
});


// Progress drives the bars on measures; direction comes from baseline vs target
describe("metricProgress()", () => {
  it("measures progress toward a lower-is-better target", () => {
    const m = MetricFields.parse({ baseline: 62, target: 4, direction: "down", readings: [{ at: "2026-11-01", value: 33 }] });
    expect(metricProgress(m)).toBeCloseTo(0.5, 2);
  });
  it("is undefined without data", () => {
    expect(metricProgress(MetricFields.parse({}))).toBeUndefined();
  });
});
