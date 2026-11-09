// apps/web/src/components/markdown.test.ts - The legal pages' Markdown parser always finishes: a lone
// table row, stray pipes, CRLF, long lines, and random short inputs each end promptly as readable text.


import { describe, expect, it } from "vitest";
import { parseBlocks } from "./Markdown.tsx";


describe("parseBlocks", () => {
  it("keeps ordinary documents as before", () => {
    const b = parseBlocks("# Title\n\nA paragraph\nwith two lines.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(b.map((x) => x.kind)).toEqual(["heading", "para", "list", "table"]);
    expect(b[3]).toMatchObject({ head: ["a", "b"], rows: [["1", "2"]] });
  });

  it("turns an incomplete table row into a paragraph instead of hanging", () => {
    expect(parseBlocks("|incomplete row|")).toEqual([{ kind: "para", lines: ["|incomplete row|"], at: 0 }]);
    expect(parseBlocks("text\n| stray\n|\n||").map((x) => x.kind)).toEqual(["para", "para", "para", "para"]);
    expect(parseBlocks("| h |\r\n| not a separator |\r\n").every((x) => x.kind === "para")).toBe(true);
  });

  it("finishes every short input built from tricky pieces, and a very long line", () => {
    const parts = ["|", "-", "---", "#", "# ", "1. ", "- ", "*", "`", "[a](b)", "x", " ", "\n", "\r\n"];
    // Every three-piece combination, each parsed within a line budget: blocks never outnumber lines
    for (const a of parts) for (const b of parts) for (const c of parts) {
      const src = a + b + c;
      expect(parseBlocks(src).length).toBeLessThanOrEqual(src.split("\n").length);
    }
    const started = Date.now();
    parseBlocks(`|${"x|".repeat(50_000)}`);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
