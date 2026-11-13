// apps/web/src/lib/markup.test.ts - An edited proposal copy: its changes are found paragraph by
// paragraph, traced to the option fields they came from, and anything else is left for neon1.


import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { docxParagraphs } from "./docx.ts";
import { compare, replaceInBody, suggest, words, type Printed } from "./markup.ts";


const printed: Printed[] = [
  { text: "Neon1: Chatbot" },
  { text: " OPTIONS " },
  { text: "0039-r1-A  AWS tooling  (recommended)", opt: "0039-r1-A", field: "title" },
  { text: "Centralize site in AWS with chatbot", opt: "0039-r1-A", field: "body" },
  { text: "neon1's time: 10 to 20 hours · Timeline: 2 weeks · Price: $1,000 to $2,000 estimate", opt: "0039-r1-A", field: "meta" },
  { text: "When you pay: $500.00 when you approve (50% of the low end, as a deposit); The rest when you accept the handover: the hours worked, less the deposit.", opt: "0039-r1-A", field: "pay" },
  { text: "Neither of us adds work or cost without a written change, which becomes the next revision." },
];
const option = { code: "0039-r1-A", title: "AWS tooling", body: "Centralize site in AWS with chatbot", fields: { pricing: "estimate", recommended: true } };

describe("an edited proposal", () => {
  it("finds a changed deposit and suggests the option's deposit share", () => {
    const edited = printed.map((p) => p.text.replace("$500.00 when you approve (50% of the low end", "$200.00 when you approve (20% of the low end").replace("’", "'"));
    const changes = compare(printed, edited);
    expect(changes).toEqual([expect.objectContaining({ kind: "changed", field: "pay", opt: "0039-r1-A" })]);
    const { updates, manual } = suggest(changes, [option]);
    expect(manual).toEqual([]);
    expect(updates[0]!.fields).toEqual({ depositPercent: 20 });
  });

  it("traces the timeline, the title, and a new sentence; leaves the price of an estimate for neon1", () => {
    const edited = [printed[0]!.text, printed[1]!.text, "0039-r1-A AWS tooling and chat", printed[3]!.text, "It answers in English and Spanish.", "neon1’s time: 10 to 20 hours · Timeline: 3 weeks · Price: $900 to $1,800 estimate", printed[5]!.text, printed[6]!.text];
    const { updates, manual } = suggest(compare(printed, edited), [option]);
    expect(updates[0]).toMatchObject({ title: "AWS tooling and chat", fields: { recommended: false, timeline: "3 weeks" }, body: "Centralize site in AWS with chatbot\n\nIt answers in English and Spanish." });
    expect(manual).toEqual([]);
    // The price line changed too, but an estimate's price follows its rate and hours: not suggested
    expect(updates[0]!.fields.cost).toBeUndefined();
  });

  it("lists changes outside any option for neon1 to handle", () => {
    const edited = printed.map((p, i) => (i === 6 ? "Either of us may add small items by email." : p.text));
    const { updates, manual } = suggest(compare(printed, edited), [option]);
    expect(updates).toEqual([]);
    expect(manual).toEqual([expect.objectContaining({ kind: "changed", after: "Either of us may add small items by email." })]);
  });

  it("replaces or removes one paragraph, bullet, or subhead of a description", () => {
    const body = "Today:\nOrders arrive three ways.\n\n- One list\n- A bake sheet";
    expect(replaceInBody(body, "Orders arrive three ways.", "Orders arrive four ways.")).toBe("Today:\nOrders arrive four ways.\n\n- One list\n- A bake sheet");
    expect(replaceInBody(body, "A bake sheet", undefined)).toBe("Today:\nOrders arrive three ways.\n\n- One list");
    expect(replaceInBody(body, "Nothing like it", "x")).toBeUndefined();
  });

  it("leaves out a change already applied from the same copy", () => {
    const edited = printed.map((p) => p.text.replace("Centralize site in AWS with chatbot", "Move the site to AWS and add the chatbot"));
    const changes = compare(printed, edited);
    expect(suggest(changes, [option]).updates[0]!.body).toBe("Move the site to AWS and add the chatbot");
    const applied = { ...option, body: "Move the site to AWS and add the chatbot" };
    expect(suggest(changes, [applied])).toEqual({ updates: [], manual: [] });
  });

  it("shows a changed paragraph word by word", () => {
    expect(words("pay 50% now", "pay 20% now").filter((w) => w.op !== "same")).toEqual([{ op: "del", text: "50%" }, { op: "ins", text: "20%" }]);
  });

  it("reads a Word file's paragraphs, table cells included, the way Google Docs saves them", async () => {
    const z = new JSZip();
    z.file("word/document.xml", '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world &amp; more</w:t></w:r></w:p><w:p/><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>A</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>B</w:t></w:r></w:p></w:body></w:document>');
    expect(await docxParagraphs(await z.generateAsync({ type: "arraybuffer" }))).toEqual(["Hello world & more", "Cell", "A B"]);
  });
});
