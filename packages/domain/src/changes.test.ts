// packages/domain/src/changes.test.ts - Activity wording and calendar repeats: every edit says what
// moved, a save with no change records nothing, and repeating events land on the right days.


import { describe, expect, it } from "vitest";
import { changeRecord, dayWords, itemChanges, projectChanges, stageChanges } from "./changes.ts";
import { occurrences, type Item, type Project } from "./model.ts";


const nameOf = (id: string) => ({ u1: "Maria", u2: "Raj" })[id] ?? "someone";


// Dates read the way people write them
describe("dayWords()", () => {
  it("writes a calendar date in words and leaves anything else alone", () => {
    expect(dayWords("2026-11-03")).toBe("Nov 3, 2026");
    expect(dayWords(undefined)).toBe("none");
    expect(dayWords("soon")).toBe("soon");
  });
});


// Item edits: each changed field in words, nothing for an unchanged save
describe("itemChanges()", () => {
  const before = { title: "Order flour", status: "open", assigneeId: "u1", dueDate: "2026-11-03", body: "", fields: { readings: [1] } } as unknown as Item;
  it("names status, assignee, due date, and list changes", () => {
    const after = { ...before, status: "done", assigneeId: "u2", dueDate: "2026-11-07", fields: { readings: [1, 2] } } as unknown as Item;
    expect(itemChanges(before, after, nameOf)).toEqual([
      "status To do → Done",
      "assigned to Raj (was Maria)",
      "due Nov 3, 2026 → Nov 7, 2026",
      "readings: 1 added",
    ]);
  });
  it("is empty when nothing changed", () => {
    expect(itemChanges(before, { ...before }, nameOf)).toEqual([]);
  });
});


// Project edits: health and people
describe("projectChanges()", () => {
  it("names health and who joined, and skips decision makers", () => {
    const before = { name: "Bakery", health: "at_risk", archived: false, people: [{ userId: "u1", role: "contributor" }] } as unknown as Project;
    const after = { ...before, health: "on_track", people: [...before.people, { userId: "u2", role: "decision_maker" }, { userId: "u3", role: "viewer" }] } as unknown as Project;
    expect(projectChanges(before, after, nameOf)).toEqual(["health At risk → On track", "added someone as viewer"]);
  });
});


// The summary line carries short changes inline and always keeps the full list in details
describe("changeRecord()", () => {
  it("returns nothing for no changes", () => {
    expect(changeRecord("Updated MIG-1", [])).toBeUndefined();
  });
  it("puts short changes in the summary", () => {
    expect(changeRecord("Updated MIG-1", ["health At risk → On track"])).toEqual({ summary: "Updated MIG-1: health At risk → On track", details: ["health At risk → On track"] });
  });
  it("shortens a long summary and keeps every change in details", () => {
    const many = Array.from({ length: 20 }, (_, i) => `change number ${i} with quite a few words in it`);
    const r = changeRecord("Updated MIG-1", many)!;
    expect(r.summary.length).toBeLessThanOrEqual(300);
    expect(r.summary).toContain("and 19 more");
    expect(r.details).toHaveLength(12);
  });
});


// Stage edits
describe("stageChanges()", () => {
  it("names added, renamed, and reordered stages", () => {
    const a = [{ id: "s1", name: "Listen" }, { id: "s2", name: "Build" }];
    const b = [{ id: "s2", name: "Make" }, { id: "s1", name: "Listen" }, { id: "s3", name: "Care" }];
    expect(stageChanges(a, b)).toEqual(['renamed stage "Build" → "Make"', 'added stage "Care"', "reordered stages"]);
  });
});


// Repeating events on the calendar
describe("occurrences()", () => {
  it("shows a one-off only inside the range", () => {
    expect(occurrences({ date: "2026-11-10", repeat: "none" }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-10"]);
    expect(occurrences({ date: "2026-10-10", repeat: "none" }, "2026-11-01", "2026-11-30")).toEqual([]);
  });
  it("steps weekly from the first day, never before it", () => {
    expect(occurrences({ date: "2026-11-04", repeat: "weekly" }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
    expect(occurrences({ date: "2026-10-07", repeat: "weekly" }, "2026-11-01", "2026-11-14")).toEqual(["2026-11-04", "2026-11-11"]);
  });
  it("keeps a monthly day, using the last day of a short month, and stops at until", () => {
    expect(occurrences({ date: "2026-01-31", repeat: "monthly" }, "2026-02-01", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(occurrences({ date: "2026-01-15", repeat: "monthly", until: "2026-03-01" }, "2026-01-01", "2026-06-30")).toEqual(["2026-01-15", "2026-02-15"]);
  });
});
