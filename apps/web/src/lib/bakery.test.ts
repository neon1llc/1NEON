// apps/web/src/lib/bakery.test.ts - The made-up bakery's figures hold together: every option's hours
// add up inside its range, the hours logged land inside the approved estimate, and the invoices the
// story shows are the ones the billing rules produce.


import { OptionFields, depositLines, finalLines, hoursLogged, priceOf } from "@1neon/domain";
import { describe, expect, it } from "vitest";
import { CHOSEN, HOURS, MONEY, OPTIONS, SUMMARY } from "./bakery.ts";


describe("the bakery's options", () => {
  it("are valid options, each an estimate with a range", () => {
    for (const o of OPTIONS) {
      const f = OptionFields.parse(o.fields);
      expect(priceOf(f)?.kind).toBe("estimate");
      expect(o.title.length).toBeLessThanOrEqual(160);
    }
  });

  it("have hours that add up inside their own range, at its midpoint", () => {
    for (const o of OPTIONS) {
      const total = o.fields.basis.reduce((n, b) => n + b.hours, 0);
      expect(total).toBe((o.fields.hoursLow + o.fields.hoursHigh) / 2);
    }
  });

  it("build on each other: C starts from everything in B", () => {
    expect(OPTIONS[2]!.fields.basis[0]!.hours).toBe(SUMMARY[1]!.expected);
    expect(SUMMARY.map((s) => s.price)).toEqual(["$400 to $600 estimate", "$2,200 to $2,800 estimate", "$3,200 to $3,900 estimate"]);
  });
});


describe("the bakery's money", () => {
  // The decision and the hours as the billing rules read them
  const decision = { id: "i_decision", title: "Approved: B. Solid setup", fields: { code: "0039-r1-B", terms: { title: CHOSEN.title, ...CHOSEN.fields } } };
  const time = HOURS.map((h, i) => ({ id: `i_time${i}`, kind: "time", status: "done", fields: { hours: h.hours } }));

  it("logs hours inside the approved estimate", () => {
    const logged = hoursLogged(time);
    expect(logged).toBe(24.5);
    expect(logged).toBeGreaterThanOrEqual(CHOSEN.fields.hoursLow);
    expect(logged).toBeLessThanOrEqual(CHOSEN.fields.hoursHigh);
  });

  it("asks for the deposit and the final amount the story says", () => {
    const deposit = depositLines(decision);
    expect(deposit[0]!.unitCents).toBe(MONEY.depositCents);
    const invoice = { id: "i_inv1", kind: "invoice", status: "paid", fields: { type: "deposit", lines: deposit } };
    const final = finalLines(decision, [...time, invoice]);
    expect(final.reduce((n, l) => n + Math.round(l.qty * l.unitCents), 0)).toBe(MONEY.finalCents);
    expect([MONEY.deposit, MONEY.earned, MONEY.final, MONEY.range, MONEY.hours]).toEqual(["$1,100", "$2,450", "$1,350", "$2,200 to $2,800", "22 to 28 hours"]);
  });
});
