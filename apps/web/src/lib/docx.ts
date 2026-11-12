// apps/web/src/lib/docx.ts - A proposal revision as a Word document, and reading a proposal's ID back
// out of a marked-up copy. Both load their libraries only when used (docx, MIT; JSZip, MIT or GPLv3).
// The ID travels in three places a markup keeps: the file name, a custom document property
// (neon1-proposal-id), and the header on every page.


import { findProposalRef, proposalFileName, proposalRef, type ProposalFields, type ProposalSnapshot } from "@1neon/domain";


// The fictional-sample line, on screen and on every printed page of a Demo proposal
export const FICTIONAL = "Fictional sample: a made-up business and illustrative figures, to show what a real proposal looks like. Not an offer.";

// The property name a markup carries the proposal's ID under
export const ID_PROPERTY = "neon1-proposal-id";

// A long date, the way the letter writes it
const longDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** What one acceptance block says, when the revision was decided */
export interface Acceptance { name: string; email?: string; code: string; title: string; at: string; conditions?: string; initials?: string }


/** Build the .docx for one issued revision and hand it to the browser as a download */
export async function downloadDocx(p: Pick<ProposalFields, "number" | "rev" | "issuedAt" | "checkBy" | "note">, s: ProposalSnapshot, slug: string, opts: { accepted?: Acceptance; fictional?: string } = {}) {
  const d = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Header, Footer, Table, TableRow, TableCell, WidthType, AlignmentType, PageNumber, ShadingType } = d;
  const ref = proposalRef(p.number, p.rev);
  const green = "1F7A4D";
  const para = (text: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, bold: o.bold, size: o.size, color: o.color, italics: o.italics })] });
  const bar = (title: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, shading: { type: ShadingType.CLEAR, fill: green, color: "auto" }, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: ` ${title.toUpperCase()} `, bold: true, color: "FFFFFF" })] });
  const sub = (title: string) => new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: title, bold: true, color: green })] });
  const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun(text)] });
  const cell = (text: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })] });
  const table = (rows: string[][]) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map((r, i) => new TableRow({ children: r.map((c) => cell(c, i === 0)) })) });

  // Body text as written: blank lines split paragraphs, "- " lines are bullets, "Label:" lines are subheads
  const body = (text: string) => text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).flatMap((b) => {
    const lines = b.split("\n");
    const out: InstanceType<typeof Paragraph>[] = [];
    if (/^[^-].{0,40}:$/.test(lines[0]!)) out.push(sub(lines.shift()!.slice(0, -1)));
    if (lines.length && lines.every((l) => l.startsWith("- "))) out.push(...lines.map((l) => bullet(l.slice(2))));
    else if (lines.length) out.push(para(lines.join(" ")));
    return out;
  });

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `${s.orgName}: ${s.project.name}`, bold: true })] }),
    para(`Proposal ${ref} · Issued ${longDate(p.issuedAt)} · Estimates checked ${longDate(p.issuedAt)}; recheck after ${longDate(p.checkBy)}`, { color: "555555" }),
  ];
  if (opts.fictional) children.push(para(opts.fictional, { italics: true, color: "8A5A00" }));
  if (p.note) children.push(para(`What changed in this revision: ${p.note}`, { italics: true }));
  children.push(table([
    ["Prepared for", s.preparedFor ? `${s.preparedFor.name}${s.preparedFor.title ? `, ${s.preparedFor.title}` : ""}` : s.orgName, "Prepared by", "Pradeep Tathineni, neon1"],
    ["Organization", s.orgName, "Proposal", ref],
    ["Contact", s.preparedFor?.email ?? "—", "Wanted by", s.project.targetDate ? longDate(s.project.targetDate) : "—"],
  ]));

  children.push(bar("Discovery"));
  if (s.project.summary) children.push(sub("How it works today"), para(s.project.summary));
  if (s.requests.length) children.push(sub("What you asked for"), ...s.requests.map((r) => bullet(r.body ? `${r.title}. ${r.body}` : r.title)));
  if (s.learned.length) children.push(sub("What we learned"), ...s.learned.map((q) => bullet(`${q.title} ${q.body}`)));

  children.push(bar("Objectives"));
  if (s.project.outcome) children.push(sub("The result"), para(s.project.outcome));
  if (s.measures.length) children.push(sub("How we'll know it worked"), ...s.measures.map(bullet));
  if (s.requirements.length) children.push(sub("Requirements"), ...s.requirements.map((r) => bullet(`${r.title} (${r.priority === "must" ? "must have" : r.priority === "could" ? "nice to have" : "should have"})`)));

  if (s.constraints.length) children.push(bar("Constraints and assumptions"), ...s.constraints.map((c) => bullet(c.body ? `${c.title}. ${c.body}` : c.title)));

  children.push(bar("Options"));
  for (const o of s.options) {
    const f = o.fields;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200 }, children: [new TextRun({ text: `${o.code}  `, color: "777777", size: 18 }), new TextRun({ text: o.title, bold: true }), new TextRun({ text: f.recommended ? "  (recommended)" : "" })] }));
    children.push(...body(o.body));
    if (f.result) children.push(para(`Target result: ${f.result}`));
    children.push(para([f.hours && `neon1's time: ${f.hours}`, f.timeline && `Timeline: ${f.timeline}`, f.cost && `Estimate: ${f.cost}`, f.outsideCosts && `Paid directly by you: ${f.outsideCosts}`].filter(Boolean).join(" · "), { size: 18 }));
    if (f.purchases.length) children.push(sub("Expected purchases"), table([["Item", "Estimate", "Bought by", "Why"], ...f.purchases.map((x) => [x.example ? `${x.name} (${x.example})` : x.name, x.estimate || "—", x.buyer === "neon1" ? "neon1, paid back at cost" : "You", x.why || ""])]));
  }

  children.push(bar("Cost estimates"), table([["Option", "neon1's time", "Timeline", "Estimate", "Paid directly by you"], ...s.options.map((o) => [`${o.code} ${o.title}`, o.fields.hours || "—", o.fields.timeline || "—", o.fields.cost || "—", o.fields.outsideCosts || "None"])]));
  children.push(para("Estimates are for the work described. Accounts and subscriptions are in your name and billed to you directly. Items to buy are bought by you unless you agree, with your initials, that neon1 buys them; those are paid back at cost, with the receipt.", { size: 18 }));

  children.push(bar("Comments and agreement"));
  children.push(bullet(`Estimates were checked on ${longDate(p.issuedAt)}. After ${longDate(p.checkBy)}, ask neon1 to refresh them before choosing; refreshing issues the next revision.`));
  children.push(bullet("Choosing an option accepts its scope and estimate. Work begins under our service agreement, signed once before any paid work, which covers payment, ownership, confidentiality, and how either of us can end the work."));
  children.push(bullet("Neither of us adds work or cost without a written change, which becomes the next revision."));
  children.push(bullet("To suggest changes, mark up this document and upload it to the project's Files; neon1 answers with the next revision."));
  if (opts.accepted) {
    const a = opts.accepted;
    children.push(sub("Accepted in 1NEON"), para(`${a.name}${a.email ? ` (${a.email})` : ""} approved ${a.code}, ${a.title}, on ${longDate(a.at)}.${a.initials ? ` Initialed ${a.initials} for items neon1 buys, paid back at cost.` : ""}`));
    if (a.conditions) children.push(para(`Conditions: ${a.conditions}`));
  } else {
    children.push(para(`I, ____________________________ (print name), choose option ${s.options.map((o) => o.code).join(" / ")} for ${s.orgName}.`));
    children.push(para("Signature ____________________________ Date ______________"));
  }

  const doc = new Document({
    creator: "neon1",
    title: `Proposal ${ref}`,
    description: `${s.orgName}: ${s.project.name}`,
    customProperties: [{ name: ID_PROPERTY, value: ref }],
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `neon1 · Proposal ${ref}`, size: 16, color: "777777" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Proposal ${ref} · ${opts.fictional ? "Fictional sample · " : ""}page `, size: 16, color: "777777" }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "777777" })] })] }) },
      children,
    }],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = proposalFileName(slug, p.number, p.rev, "docx");
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}


/**
 * Which proposal revision an uploaded file is a markup of, if any: the file name first, then the
 * Word file's custom property, then its page header. Undefined for anything that isn't one
 */
export async function proposalRefOf(file: File): Promise<{ number: number; rev: number } | undefined> {
  const byName = findProposalRef(file.name);
  if (byName) return byName;
  if (!/\.docx$/i.test(file.name)) return undefined;
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const custom = await zip.file("docProps/custom.xml")?.async("string");
    const prop = custom && new RegExp(`name="${ID_PROPERTY}"[^>]*>\\s*<vt:lpwstr>([^<]+)<`).exec(custom)?.[1];
    if (prop && findProposalRef(prop)) return findProposalRef(prop);
    for (const name of Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n))) {
      const text = (await zip.file(name)!.async("string")).replace(/<[^>]+>/g, "");
      if (findProposalRef(text)) return findProposalRef(text);
    }
  } catch {
    // Not a readable Word file: treat it as an ordinary file
  }
  return undefined;
}
