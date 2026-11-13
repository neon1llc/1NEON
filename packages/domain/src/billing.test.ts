// packages/domain/src/billing.test.ts - Money, invoice totals and balances, suggested lines, and the
// hashing behind signatures.


import { describe, expect, it } from "vitest";
import { AGREEMENT_TEXT } from "./agreement.ts";
import { alignPrice, balanceOf, canonical, clearingOn, failedOn, payableOn, depositLines, finalLines, hoursStanding, initialsOf, invoiceNumber, invoiceState, invoiceTotal, money, parseMoney, paymentPlan, priceLine, priceMeaning, priceOf, reimbursementLines, sha256Hex } from "./billing.ts";


// A stored record of a kind, with fields
const rec = (id: string, kind: string, status: string, fields: Record<string, unknown>, title = id) => ({ id, kind, status, fields, title });
const inv = (id: string, status: string, f: Record<string, unknown>) => rec(id, "invoice", status, { termsDays: 15, taxCents: 0, ...f });
const pay = (id: string, invoiceId: string, amountCents: number) => rec(id, "payment", "done", { invoiceId, amountCents, method: "ach", receivedAt: "2026-11-12", recordedBy: "u1" });


describe("money", () => {
  it("reads the first dollar amount in an estimate", () => {
    expect(parseMoney("$6,500 fixed")).toBe(650_000);
    expect(parseMoney("about $1,200.5")).toBe(120_050);
    expect(parseMoney("$400-$500")).toBe(40_000);
    expect(parseMoney("$900")).toBe(90_000);
    expect(parseMoney("ask me")).toBeUndefined();
  });

  it("writes cents as dollars", () => {
    expect(money(650_000)).toBe("$6,500.00");
    expect(money(-1_205)).toBe("-$12.05");
  });
});


describe("invoices", () => {
  it("totals lines and tax, and makes credits negative", () => {
    expect(invoiceTotal({ type: "deposit", taxCents: 100, lines: [{ text: "a", qty: 2, unitCents: 1_000 }, { text: "b", qty: 1, unitCents: 50 }] })).toBe(2_150);
    expect(invoiceTotal({ type: "credit", taxCents: 0, lines: [{ text: "a", qty: 1, unitCents: 500 }] })).toBe(-500);
  });

  it("numbers by proposal and place", () => {
    expect(invoiceNumber("0039", 1)).toBe("INV-0039-01");
  });

  it("subtracts payments and credits, and tells open, partly paid, overdue, and paid apart", () => {
    const i = inv("i1", "issued", { type: "deposit", lines: [{ text: "x", qty: 1, unitCents: 10_000 }], dueDate: "2026-11-20" });
    expect(invoiceState(i, [i], "2026-11-12")).toBe("open");
    const p1 = pay("p1", "i1", 4_000);
    expect(balanceOf(i, [i, p1])).toBe(6_000);
    expect(invoiceState(i, [i, p1], "2026-11-12")).toBe("partly_paid");
    expect(invoiceState(i, [i, p1], "2026-11-21")).toBe("overdue");
    const cr = inv("c1", "issued", { type: "credit", appliesTo: "i1", lines: [{ text: "goodwill", qty: 1, unitCents: 1_000 }] });
    expect(balanceOf(i, [i, p1, cr])).toBe(5_000);
    // A voided credit no longer counts
    expect(balanceOf(i, [i, p1, { ...cr, status: "void" }])).toBe(6_000);
    expect(invoiceState(i, [i, p1, cr, pay("p2", "i1", 5_000)], "2026-11-30")).toBe("paid");
    expect(invoiceState({ ...i, status: "void" }, [], "2026-11-12")).toBe("void");
  });

  it("counts a bank payment only once it clears, and shows one on its way or refused", () => {
    const i = inv("i1", "issued", { type: "deposit", lines: [{ text: "x", qty: 1, unitCents: 10_000 }], dueDate: "2026-11-20" });
    const started = { ...pay("p1", "i1", 10_000), status: "pending" };
    // On its way: still owed, nothing more to pay, and not overdue while the bank works
    expect(balanceOf(i, [i, started])).toBe(10_000);
    expect(clearingOn(i, [i, started])).toBe(10_000);
    expect(payableOn(i, [i, started])).toBe(0);
    expect(invoiceState(i, [i, started], "2026-11-25")).toBe("clearing");
    expect(failedOn(i, [i, started])).toBeUndefined();
    // Refused: owed again, overdue once the date passes, and the failure is there to show
    const refused = { ...started, status: "failed" };
    expect(payableOn(i, [i, refused])).toBe(10_000);
    expect(invoiceState(i, [i, refused], "2026-11-12")).toBe("open");
    expect(invoiceState(i, [i, refused], "2026-11-25")).toBe("overdue");
    expect(failedOn(i, [i, refused])?.amountCents).toBe(10_000);
    // Paid another way afterwards: the failure no longer asks for anything
    expect(failedOn(i, [i, refused, pay("p2", "i1", 10_000)])).toBeUndefined();
    // A transfer for part of it leaves the rest payable
    const part = { ...pay("p3", "i1", 4_000), status: "pending" };
    expect(payableOn(i, [i, part])).toBe(6_000);
    expect(invoiceState(i, [i, part], "2026-11-12")).toBe("open");
  });
});


describe("suggested lines", () => {
  const d = rec("d1", "decision", "approved", { code: "0039-r1-B", terms: { title: "B. Small intake portal on AWS", cost: "$6,500 fixed" } });

  it("asks half up front, then the rest", () => {
    const dep = depositLines(d);
    expect(dep).toEqual([{ text: "50% deposit on 0039-r1-B B. Small intake portal on AWS", qty: 1, unitCents: 325_000, ref: "d1" }]);
    const issued = inv("i1", "paid", { type: "deposit", lines: dep });
    expect(finalLines(d, [issued])[0]!.unitCents).toBe(325_000);
    // A voided deposit doesn't count against the balance
    expect(finalLines(d, [{ ...issued, status: "void" }])[0]!.unitCents).toBe(650_000);
  });

  // An hourly estimate: 20 to 24 hours at $175, so $3,500 to $4,200
  const est = { title: "B. Solid setup", pricing: "estimate" as const, rateCents: 17_500, hoursLow: 20, hoursHigh: 24 };
  const e = rec("d3", "decision", "approved", { code: "0039-r1-B", terms: est });
  const time = (id: string, hours: number) => rec(id, "time", "done", { date: "2026-11-12", hours });

  it("reads an estimate's range, and says what it means for the person paying", () => {
    const p = priceOf(est)!;
    expect(p).toEqual({ kind: "estimate", rateCents: 17_500, hoursLow: 20, hoursHigh: 24, lowCents: 350_000, highCents: 420_000 });
    expect(priceLine(p)).toBe("$3,500 to $4,200 estimate");
    expect(priceMeaning(p)).toContain("can't pass $4,200");
    expect(paymentPlan(p)[0]).toBe("$1,750.00 when you approve (50% of the low end, as a deposit)");
    // The written cost and hours follow the numbers, whatever was typed
    expect(alignPrice({ ...est, cost: "about four grand", hours: "a while" })).toMatchObject({ cost: "$3,500 to $4,200 estimate", hours: "20 to 24 hours" });
    // A fixed price keeps its own words, and an estimate missing its rate has no numbers to bill from
    expect(priceLine(priceOf({ cost: "$1,700 fixed" })!)).toBe("$1,700 fixed");
    expect(priceOf({ pricing: "estimate", hoursHigh: 10 })).toBeUndefined();
  });

  it("asks half of an estimate's low end up front, then the hours worked less that", () => {
    const dep = depositLines(e);
    expect(dep).toEqual([{ text: "Deposit on 0039-r1-B B. Solid setup: 50% of the estimate's low end ($3,500)", qty: 1, unitCents: 175_000, ref: "d3" }]);
    const paid = inv("i1", "paid", { type: "deposit", lines: dep, number: "INV-0039-01", issuedAt: "2026-10-01T12:00:00.000Z" });
    // 21 hours logged: 21 x $175 = $3,675, less the $1,750 deposit
    const lines = finalLines(e, [paid, time("t1", 12.5), time("t2", 8.5)]);
    expect(lines).toEqual([
      { text: "21 hours on 0039-r1-B B. Solid setup at $175 an hour", qty: 21, unitCents: 17_500, ref: "d3" },
      { text: "Less INV-0039-01, invoiced earlier for this work", qty: 1, unitCents: -175_000, ref: "d3" },
    ]);
    expect(invoiceTotal({ type: "final", taxCents: 0, lines })).toBe(192_500);
    // Once that final invoice exists, nothing more is owed for the same hours
    expect(finalLines(e, [paid, inv("i2", "issued", { type: "final", lines }), time("t1", 12.5), time("t2", 8.5)])).toEqual([]);
  });

  it("never bills past an estimate's high end, and shows the hours it doesn't charge for", () => {
    const lines = finalLines(e, [time("t1", 20), time("t2", 6.5)]);
    expect(lines[0]).toMatchObject({ qty: 24, unitCents: 17_500 });
    expect(lines[1]).toEqual({ text: "2.5 hours past the estimate's high end, not billed", qty: 2.5, unitCents: 0, ref: "d3" });
    expect(invoiceTotal({ type: "final", taxCents: 0, lines })).toBe(420_000);
    expect(hoursStanding(est, [time("t1", 20), time("t2", 6.5)])).toMatchObject({ logged: 26.5, billable: 24, over: 2.5, earnedCents: 420_000 });
    // With no hours logged, or a deposit larger than the hours so far, there's nothing to bill
    expect(finalLines(e, [])).toEqual([]);
    expect(finalLines(e, [inv("i1", "paid", { type: "deposit", lines: depositLines(e) }), time("t1", 4)])).toEqual([]);
    expect(hoursStanding({ cost: "$900 fixed" }, [time("t1", 4)])).toBeUndefined();
  });

  it("has nothing to suggest when the price has no amount", () => {
    expect(depositLines(rec("d2", "decision", "approved", { terms: { cost: "time and materials" } }))).toEqual([]);
  });

  it("bills what neon1 bought at the receipt's cost, once", () => {
    const bought = rec("b1", "purchase", "bought", { buyer: "neon1", actual: "$189.99" }, "Label printer");
    const theirs = rec("b2", "purchase", "bought", { buyer: "client", actual: "$50" }, "Cables");
    const notYet = rec("b3", "purchase", "open", { buyer: "neon1", actual: "" }, "Router");
    const lines = reimbursementLines([bought, theirs, notYet]);
    expect(lines).toEqual([{ text: "Label printer (at cost, receipt in Files)", qty: 1, unitCents: 18_999, ref: "b1" }]);
    expect(reimbursementLines([bought, inv("i9", "issued", { type: "reimbursement", lines })])).toEqual([]);
  });
});


describe("signing", () => {
  it("hashes the same content the same way, whatever the key order", async () => {
    expect(canonical({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe('{"a":[2,{"d":3}],"b":1}');
    expect(await sha256Hex(canonical({ a: 1, b: 2 }))).toBe(await sha256Hex(canonical({ b: 2, a: 1 })));
    expect(await sha256Hex(AGREEMENT_TEXT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("takes initials from a typed name", () => {
    expect(initialsOf("Raj  Patel")).toBe("RP");
  });
});
