// apps/web/src/lib/csv.test.ts - The export's CSV opens cleanly in a spreadsheet: quoting, line
// breaks, and formulas typed into a record shown as text.


import { describe, expect, it } from "vitest";
import { csv } from "./csv.ts";


describe("the export's tables", () => {
  it("quotes commas, quotes, and line breaks, and defuses formulas", () => {
    const out = csv([{ a: 'Say "hi", then', b: "two\nlines", c: "=SUM(A1)", d: undefined }], ["a", "b", "c", "d"]);
    expect(out).toBe('\ufeffa,b,c,d\r\n"Say ""hi"", then","two\nlines",\'=SUM(A1),\r\n');
  });
});
