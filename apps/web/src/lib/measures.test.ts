// apps/web/src/lib/measures.test.ts - New-project measures: invalid numbers are errors rather than
// silent drops, blank differs from zero, the API's limits hold, and the values reviewed are the ones sent.


import { describe, expect, it } from "vitest";
import { checkMeasures, optionalNumber, numberWords, MEASURE_TITLE_MAX, MEASURE_UNIT_MAX } from "./measures.ts";


const row = (patch: Partial<{ title: string; unit: string; baseline: string; target: string }>) => ({ title: "Hours on scheduling", unit: "hours", baseline: "", target: "", ...patch });


describe("measure values", () => {
  it("keeps zero, negatives, and decimals, and blank as unset", () => {
    expect(optionalNumber("0")).toEqual({ ok: true, value: 0 });
    expect(optionalNumber("-3")).toEqual({ ok: true, value: -3 });
    expect(optionalNumber("4.5")).toEqual({ ok: true, value: 4.5 });
    expect(optionalNumber(".5")).toEqual({ ok: true, value: 0.5 });
    expect(optionalNumber("  ")).toEqual({ ok: true });
    expect(numberWords(0)).toBe("0");
    expect(numberWords(undefined)).toBe("not set");
  });

  it("refuses anything that isn't one finite number instead of dropping it", () => {
    for (const bad of ["1..2", "-", ".", "1-2", "--1", "1e999", "Infinity", "12abc"]) expect(optionalNumber(bad)).toEqual({ ok: false });
    const r = checkMeasures([row({ baseline: "1..2", target: "4" })]);
    expect(r.ok).toBe(false);
    expect(r.first).toBe("baseline:0");
    expect(r.values).toHaveLength(0);
  });

  it("matches the API's name and unit limits, and needs a name for a started row", () => {
    expect(checkMeasures([row({ title: "x".repeat(MEASURE_TITLE_MAX + 1) })]).first).toBe("title:0");
    expect(checkMeasures([row({ unit: "u".repeat(MEASURE_UNIT_MAX + 1) })]).first).toBe("unit:0");
    expect(checkMeasures([row({ title: "", target: "5" })]).first).toBe("title:0");
    // An untouched row is simply left out
    expect(checkMeasures([row({ title: "", unit: "" })])).toMatchObject({ ok: true, values: [] });
  });

  it("gives the exact values to review and send, and points at the first invalid field", () => {
    const r = checkMeasures([row({ baseline: " 62 ", target: "0" }), row({ title: "Second", target: "abc" })]);
    expect(r.first).toBe("target:1");
    const ok = checkMeasures([row({ baseline: " 62 ", target: "0" }), row({ title: " Cost ", unit: " $ ", baseline: "", target: "-1.5" })]);
    expect(ok.values).toEqual([
      { title: "Hours on scheduling", unit: "hours", baseline: 62, target: 0 },
      { title: "Cost", unit: "$", baseline: undefined, target: -1.5 },
    ]);
  });
});


// Review 2026-11-11, EP-08: one number rule for every measure entry point
import { numberProblem as _np } from "./measures.ts";
describe("numberProblem", () => {
  it("accepts blank, zero, negatives, and decimals, and refuses what it can't read without guessing", () => {
    expect(_np("")).toBeUndefined();
    expect(_np("0")).toBeUndefined();
    expect(_np("-3.5")).toBeUndefined();
    expect(_np("1..2")).toMatch(/number/);
    expect(_np("1,5")).toMatch(/point/);
    expect(_np("1e3")).toMatch(/number/);
    expect(_np("", { required: true })).toMatch(/number/);
  });
});
