// apps/web/src/lib/cost.test.ts - Prices split into one-time and recurring parts, a first year
// added up only when both are known, and anything ambiguous left alone.


import { describe, expect, it } from "vitest";
import { firstYear, money, parseCost } from "./cost.ts";


describe("parseCost", () => {
  it("splits one-time and monthly parts and adds a first year", () => {
    const c = parseCost("$6,500 fixed + ~$15/mo")!;
    expect(c.oneTime).toEqual({ amount: 6500, approx: false });
    expect(c.recurring).toEqual([{ amount: 15, per: "month", approx: true }]);
    expect(firstYear(c)).toEqual({ amount: 6680, approx: true });
    expect(money(firstYear(c)!)).toBe("about $6,680");
  });

  it("counts a zero setup as one-time and a yearly fee once", () => {
    expect(firstYear(parseCost("$0 setup + $240/mo")!)).toEqual({ amount: 2880, approx: false });
    expect(firstYear(parseCost("$1,000 + $300 per year")!)).toEqual({ amount: 1300, approx: false });
  });

  it("gives no first year without both kinds of charge", () => {
    expect(firstYear(parseCost("$900 fixed")!)).toBeUndefined();
    expect(firstYear(parseCost("$40/mo")!)).toBeUndefined();
  });

  it("leaves free-form, ranged, and hourly prices as written", () => {
    for (const t of ["", "depends on seats", "$40-60/mo", "$120/hour", "$5 per seat", "$100 + $200", "$1,600 or $2,000"]) expect(parseCost(t)).toBeUndefined();
  });
});
