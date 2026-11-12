// apps/web/src/lib/handover.test.ts - The closed project's handover summary: the agreement as approved,
// finished changes only, measures with something to compare, owners by name, and an empty project says so.

import { describe, expect, it } from "vitest";
import { handoverSummary, withUnit, type HandoverItem } from "./handover.ts";


const item = (kind: string, title: string, patch: Partial<HandoverItem> = {}): HandoverItem => ({ id: `${kind}-${title}`, kind, title, status: "open", fields: {}, ...patch });
const names = new Map([["u1", "Maria Lopez"]]);


describe("handover summary", () => {
  it("names the agreement by its approved terms", () => {
    const opt = item("option", "Option title now", { status: "approved" });
    const dec = item("decision", "Approved", { fields: { optionId: opt.id, approvedAt: "2026-11-01T10:00:00Z", terms: { title: "Orders typed once" } } });
    expect(handoverSummary([opt, dec], names).agreed).toBe("Orders typed once");
  });

  it("lists finished changes only, three at most", () => {
    const items = ["A", "B", "C", "D"].map((t) => item("change", t, { status: "done" }));
    items.push(item("change", "Still open"));
    expect(handoverSummary(items, names).changes).toEqual(["A", "B", "C"]);
  });

  it("shows a measure before and now in its unit, keeping zero", () => {
    const m = item("metric", "Time to a complete intake", { fields: { unit: "hours", baseline: 62, target: 4, readings: [{ at: "2026-11-01", value: 0, note: "" }] } });
    const [r] = handoverSummary([m], names).results;
    expect(r).toMatchObject({ title: "Time to a complete intake", before: "62 hours", now: "0 hours", target: "4 hours", reached: true });
  });

  it("writes money, percentages, and large numbers the way people read them", () => {
    expect(withUnit(1450, "$")).toBe("$1,450");
    expect(withUnit(-20, "USD")).toBe("-$20");
    expect(withUnit(12.5, "%")).toBe("12.5%");
    expect(withUnit(2500, "min")).toBe("2,500 min");
  });

  it("leaves out a measure with nothing to compare", () => {
    expect(handoverSummary([item("metric", "Not measured yet", { fields: { unit: "%" } })], names).results).toEqual([]);
  });

  it("names owners of systems and accounts, or no one yet", () => {
    const s = handoverSummary([item("asset", "Google Workspace", { assigneeId: "u1" }), item("asset", "Router")], names);
    expect(s.owners).toEqual([{ title: "Google Workspace", owner: "Maria Lopez" }, { title: "Router", owner: undefined }]);
  });

  it("counts the handoff checklist and says when there's nothing to show", () => {
    expect(handoverSummary([item("handoff", "Walkthrough", { status: "done" }), item("handoff", "Runbook")], names).handoff).toEqual([1, 2]);
    expect(handoverSummary([], names).empty).toBe(true);
  });
});
