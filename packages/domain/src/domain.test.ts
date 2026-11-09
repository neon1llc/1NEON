// packages/domain/src/domain.test.ts - Domain rules that everything else trusts: permissions,
// ordering, IDs, and metric progress.


import { describe, expect, it } from "vitest";
import { can, canApprove, canNameDecider, deciderIds, type Action } from "./access.ts";
import { initialRanks, rankBetween } from "./rank.ts";
import { formatClientId, newId, slugify } from "./ids.ts";
import { betterWhen, metricProgress, MetricFields, themeOf, User } from "./model.ts";
import { LAYER_NAMES } from "./defaults.ts";


// Actors: a plain member, the same member with strong sign-in, and the operator
const member = { userId: "u1", operator: false, strongSession: false };
const strong = { ...member, strongSession: true };
const operator = { userId: "op", operator: true, strongSession: true };


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


// Awake is the default, and the old "system" value no longer means device matching
describe("themes", () => {
  it("reads stored values, with anything else as awake", () => {
    expect(themeOf("device")).toBe("device");
    expect(themeOf("matrix")).toBe("matrix");
    expect(themeOf("system")).toBe("awake");
    expect(themeOf(undefined)).toBe("awake");
  });

  it("gives a new person awake", () => {
    const t = "2026-11-06T00:00:00.000Z";
    const u = User.parse({ id: "u1", email: "a@b.co", version: 1, createdAt: t, updatedAt: t, updatedBy: "u1" });
    expect(u.theme).toBe("awake");
  });
});


// The fourth layer is shown as Normalize but keeps its stored key
describe("layer names", () => {
  it("names the layers in order", () => {
    expect(Object.values(LAYER_NAMES)).toEqual(["Needs", "Execute", "Observe", "Normalize"]);
    expect(LAYER_NAMES.next).toBe("Normalize");
  });
});



// Approval on one project: the named decision maker, else the client's own admins
describe("canApprove", () => {
  const person = (userId: string, operator = false) => ({ userId, operator, strongSession: false });
  const people = [{ userId: "u_raj", role: "decision_maker" }];

  it("lets only a named decision maker approve", () => {
    expect(canApprove(person("u_raj"), "viewer", people).ok).toBe(true);
    expect(canApprove(person("u_dana"), "admin", people)).toEqual({ ok: false, reason: "not_decider" });
  });

  it("falls back to client admins, never the operator role alone", () => {
    expect(canApprove(person("u_raj"), "admin", []).ok).toBe(true);
    expect(canApprove(person("u_dana"), "editor", []).ok).toBe(false);
    expect(canApprove(person("u_op", true), "admin", []).ok).toBe(false);
  });
});



// Naming who decides: a client admin in a confirmed session; never an editor or the operator role
describe("canNameDecider", () => {
  const actor = (operator: boolean, strongSession: boolean) => ({ userId: "u", operator, strongSession });

  it("needs a client admin who confirmed it's them", () => {
    expect(canNameDecider(actor(false, true), "admin").ok).toBe(true);
    expect(canNameDecider(actor(false, false), "admin")).toEqual({ ok: false, reason: "strong_auth_required" });
    expect(canNameDecider(actor(false, true), "editor")).toEqual({ ok: false, reason: "decider_admin_only" });
    expect(canNameDecider(actor(true, true), "admin")).toEqual({ ok: false, reason: "decider_admin_only" });
  });

  it("compares decision makers as a set", () => {
    expect(deciderIds([{ userId: "b", role: "decision_maker" }, { userId: "a", role: "decision_maker" }, { userId: "c", role: "stakeholder" }])).toEqual(["a", "b"]);
  });
});



// A measure whose target is below its baseline reads as "lower is better", even if stored as up
describe("betterWhen", () => {
  it("follows baseline and target over the stored direction", () => {
    expect(betterWhen(MetricFields.parse({ baseline: 20, target: 2, readings: [] }))).toBe("down");
    expect(betterWhen(MetricFields.parse({ baseline: 2, target: 20, direction: "down", readings: [] }))).toBe("up");
    expect(betterWhen(MetricFields.parse({ direction: "down", readings: [] }))).toBe("down");
  });
});


// Every audit action the API emits belongs to exactly the group its preference row describes
describe("notification groups", () => {
  it("files each emitted action under its intended group", async () => {
    const { groupOf, wants } = await import("./notify.ts");
    const { KIND_LAYER } = await import("./model.ts");
    const expected: Record<string, string> = {
      "comment.created": "comments", "decision.approved": "decisions", "doc.uploaded": "files", "doc.deleted": "files",
      "member.invited": "access", "member.joined": "access", "member.updated": "access", "member.signedin": "signins",
      "org.created": "updates", "org.stages": "workflow", "project.created": "workflow", "project.moved": "workflow",
      "project.trashed": "workflow", "project.updated": "updates",
    };
    for (const kind of Object.keys(KIND_LAYER)) {
      for (const verb of ["created", "updated", "deleted"]) expected[`${kind}.${verb}`] = kind === "option" ? "decisions" : "updates";
    }
    for (const [action, group] of Object.entries(expected)) expect([action, groupOf(action).id]).toEqual([action, group]);
    // Comments on, updates off: comments reach the person and item edits don't, in both channels
    const prefs = { comments: { email: true, sms: true }, updates: { email: false, sms: false } };
    expect(wants(prefs, "comment.created", "email")).toBe(true);
    expect(wants(prefs, "comment.created", "sms")).toBe(true);
    expect(wants(prefs, "task.updated", "email")).toBe(false);
    // And the inverse
    const inverse = { comments: { email: false, sms: false }, updates: { email: true, sms: true } };
    expect(wants(inverse, "comment.created", "email")).toBe(false);
    expect(wants(inverse, "comment.created", "sms")).toBe(false);
  });
});
