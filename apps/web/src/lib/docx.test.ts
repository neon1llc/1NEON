// apps/web/src/lib/docx.test.ts - A marked-up proposal is recognized by its file name, its Word
// property, or its page header, in that order; anything else is an ordinary file.


import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { proposalRefOf } from "./docx.ts";


/** A minimal .docx-shaped zip with an optional custom property and header */
async function word(name: string, opts: { prop?: string; header?: string }) {
  const z = new JSZip();
  if (opts.prop) z.file("docProps/custom.xml", `<Properties xmlns:vt="x"><property fmtid="{x}" pid="2" name="neon1-proposal-id"><vt:lpwstr>${opts.prop}</vt:lpwstr></property></Properties>`);
  if (opts.header) z.file("word/header1.xml", `<w:hdr><w:p><w:r><w:t>${opts.header}</w:t></w:r></w:p></w:hdr>`);
  z.file("word/document.xml", "<w:document/>");
  return new File([await z.generateAsync({ type: "uint8array" })], name);
}

describe("markup recognition", () => {
  it("reads the file name first", async () => {
    expect(await proposalRefOf(new File(["x"], "neon1-maple-street-proposal-0039-r2.docx"))).toEqual({ number: 39, rev: 2 });
  });
  it("reads the Word property when the file was renamed", async () => {
    expect(await proposalRefOf(await word("Raj's edits.docx", { prop: "0039-r3" }))).toEqual({ number: 39, rev: 3 });
  });
  it("falls back to the page header", async () => {
    expect(await proposalRefOf(await word("edits.docx", { header: "neon1 · Proposal 0041-r1" }))).toEqual({ number: 41, rev: 1 });
  });
  it("treats anything else as an ordinary file", async () => {
    expect(await proposalRefOf(await word("notes.docx", {}))).toBeUndefined();
    expect(await proposalRefOf(new File(["x"], "receipt.pdf"))).toBeUndefined();
  });
});
