// apps/web/src/lib/docx.ts - A proposal revision as a Word document, and reading a proposal's ID back
// out of a marked-up copy. Both load their libraries only when used (docx, MIT; JSZip, MIT or GPLv3).
// The ID travels in three places a markup keeps: the file name, a custom document property
// (neon1-proposal-id), and the header on every page.


import { findProposalRef, hoursRange, hoursText, paymentPlan, priceMeaning, priceOf, proposalFileName, proposalRef, type ProposalFields, type ProposalSnapshot } from "@1neon/domain";


// The fictional-sample line, on screen and on every printed page of a Demo proposal
export const FICTIONAL = "Fictional sample: a made-up business and illustrative figures, to show what a real proposal looks like. Not an offer.";

// The property name a markup carries the proposal's ID under
export const ID_PROPERTY = "neon1-proposal-id";

// A long date, the way the letter writes it
const longDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** What one acceptance block says, when the revision was decided */
export interface Acceptance { name: string; email?: string; code: string; title: string; at: string; conditions?: string; initials?: string; signature?: { typedName: string; hash: string } }


/**
 * One piece of a proposal document, in reading order. The Word file is built from these, and a
 * marked-up copy is compared against them, so both read the same words. `opt` names the option a
 * piece belongs to (its code) and `field` what it says, so a change to it can be traced to the
 * option field it came from
 */
export type Block =
  | { t: "title" | "para" | "bar" | "sub" | "bullet"; text: string; opt?: string; field?: string; italics?: boolean; color?: string; size?: number }
  | { t: "head"; code: string; title: string; recommended: boolean; opt: string; field: "title" }
  | { t: "table"; rows: string[][]; opt?: string };

/** Everything one revision says, as blocks */
export function proposalBlocks(p: Pick<ProposalFields, "number" | "rev" | "issuedAt" | "checkBy" | "note">, s: ProposalSnapshot, opts: { accepted?: Acceptance; fictional?: string } = {}): Block[] {
  const ref = proposalRef(p.number, p.rev);
  const out: Block[] = [];
  const para = (text: string, o: { opt?: string; field?: string; italics?: boolean; color?: string; size?: number } = {}) => out.push({ t: "para", text, ...o });
  const bullet = (text: string, opt?: string) => out.push({ t: "bullet", text, opt });
  const sub = (text: string, opt?: string) => out.push({ t: "sub", text, opt });
  const bar = (text: string) => out.push({ t: "bar", text });
  const table = (rows: string[][], opt?: string) => out.push({ t: "table", rows, opt });
  // Body text as written: blank lines split paragraphs, "- " lines are bullets, "Label:" lines are subheads
  const body = (text: string, opt?: string) => text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).forEach((b) => {
    const lines = b.split("\n");
    if (/^[^-].{0,40}:$/.test(lines[0]!)) out.push({ t: "sub", text: lines.shift()!.slice(0, -1), opt, field: opt ? "body" : undefined });
    if (lines.length && lines.every((l) => l.startsWith("- "))) lines.forEach((l) => out.push({ t: "bullet", text: l.slice(2), opt, field: opt ? "body" : undefined }));
    else if (lines.length) out.push({ t: "para", text: lines.join(" "), opt, field: opt ? "body" : undefined });
  });

  out.push({ t: "title", text: `${s.orgName}: ${s.project.name}` });
  para(`Proposal ${ref} · Issued ${longDate(p.issuedAt)} · Prices checked ${longDate(p.issuedAt)}; recheck after ${longDate(p.checkBy)}`, { color: "555555" });
  if (opts.fictional) para(opts.fictional, { italics: true, color: "8A5A00" });
  if (p.note) para(`What changed in this revision: ${p.note}`, { italics: true });
  table([
    ["Prepared for", s.preparedFor ? `${s.preparedFor.name}${s.preparedFor.title ? `, ${s.preparedFor.title}` : ""}` : s.orgName, "Prepared by", "Pradeep Tathineni, neon1"],
    ["Organization", s.orgName, "Proposal", ref],
    ["Contact", s.preparedFor?.email ?? "—", "Wanted by", s.project.targetDate ? longDate(s.project.targetDate) : "—"],
  ]);

  bar("Discovery");
  if (s.project.summary) { sub("How it works today"); para(s.project.summary); }
  if (s.requests.length) { sub("What you asked for"); s.requests.forEach((r) => bullet(r.body ? `${r.title}. ${r.body}` : r.title)); }
  if (s.learned.length) { sub("What we learned"); s.learned.forEach((q) => bullet(`${q.title} ${q.body}`)); }

  bar("Objectives");
  if (s.project.outcome) { sub("The result"); para(s.project.outcome); }
  if (s.measures.length) { sub("How we'll know it worked"); s.measures.forEach((m) => bullet(m)); }
  if (s.requirements.length) { sub("Requirements"); s.requirements.forEach((r) => bullet(`${r.title} (${r.priority === "must" ? "must have" : r.priority === "could" ? "nice to have" : "should have"})`)); }

  if (s.constraints.length) { bar("Constraints and assumptions"); s.constraints.forEach((c) => bullet(c.body ? `${c.title}. ${c.body}` : c.title)); }

  bar("Options");
  for (const o of s.options) {
    const f = o.fields;
    const opt = o.code;
    out.push({ t: "head", code: o.code, title: o.title, recommended: f.recommended, opt, field: "title" });
    body(o.body, opt);
    if (f.result) para(`Target result: ${f.result}`, { opt, field: "result" });
    para([f.hours && `neon1's time: ${f.hours}`, f.timeline && `Timeline: ${f.timeline}`, f.cost && `Price: ${f.cost}`, f.outsideCosts && `Paid directly by you: ${f.outsideCosts}`].filter(Boolean).join(" · "), { size: 18, opt, field: "meta" });
    if (f.why) para(`${f.recommended ? "Why I recommend it" : "When to pick it"}: ${f.why}`, { opt, field: "why" });
    // The price, opened up: what kind it is, the work behind the hours, and when it's paid
    const price = priceOf(f);
    if (price) {
      sub("How the price adds up", opt);
      para(priceMeaning(price), { opt, field: "meaning" });
      const basis = f.basis ?? [];
      if (basis.length) table([["Work", "Expected"], ...basis.map((b) => [b.work, hoursText(b.hours)]), [`Total${price.kind === "estimate" && price.hoursLow !== price.hoursHigh ? `, within a range of ${hoursRange(price)}` : ""}`, hoursText(basis.reduce((n, b) => n + b.hours, 0))]], opt);
      para(`When you pay: ${paymentPlan(price).join("; ")}.`, { opt, field: "pay" });
    }
    if (f.purchases.length) { sub("Expected purchases", opt); table([["Item", "Estimate", "Bought by", "Why"], ...f.purchases.map((x) => [x.example ? `${x.name} (${x.example})` : x.name, x.estimate || "—", x.buyer === "neon1" ? "neon1, paid back at cost" : "You", x.why || ""])], opt); }
  }

  bar("Costs");
  table([["Option", "neon1's time", "Timeline", "Price", "Paid directly by you"], ...s.options.map((o) => [`${o.code} ${o.title}`, o.fields.hours || "—", o.fields.timeline || "—", o.fields.cost || "—", o.fields.outsideCosts || "None"])]);
  para("Prices are for the work described. A fixed price is the whole price for that work. An estimate is billed for the hours worked, at the rate shown, and never above its high end unless you approve a change first; every hour is listed in 1NEON as it's logged. Accounts and subscriptions are in your name and billed to you directly. Items to buy are bought by you unless you agree, with your initials, that neon1 buys them; those are paid back at cost, with the receipt.", { size: 18 });

  bar("Comments and agreement");
  bullet(`Prices were checked on ${longDate(p.issuedAt)}. After ${longDate(p.checkBy)}, ask neon1 to refresh them before choosing; refreshing issues the next revision.`);
  bullet("Choosing an option accepts its scope and price. Work begins under our service agreement, signed once before any paid work, which covers payment, ownership, confidentiality, and how either of us can end the work.");
  bullet("Neither of us adds work or cost without a written change, which becomes the next revision.");
  bullet("To suggest changes, edit this document (in Word, Google Docs, or Pages) and upload it to the project's Files; neon1 sees what you changed and answers with the next revision.");
  if (opts.accepted) {
    const a = opts.accepted;
    sub("Accepted in 1NEON");
    para(`${a.name}${a.email ? ` (${a.email})` : ""} approved ${a.code}, ${a.title}, on ${longDate(a.at)}.${a.initials ? ` Initialed ${a.initials} for items neon1 buys, paid back at cost.` : ""}${a.signature ? ` Signed electronically as ${a.signature.typedName}; fingerprint ${a.signature.hash.slice(0, 16)}.` : ""}`);
    if (a.conditions) para(`Conditions: ${a.conditions}`);
  } else {
    para(`I, ____________________________ (print name), choose option ${s.options.map((o) => o.code).join(" / ")} for ${s.orgName}.`);
    para("Signature ____________________________ Date ______________");
  }
  return out;
}

/** The blocks as the paragraphs a word processor keeps: one per paragraph, one per table cell, with
 * an option's heading as its code, two spaces, its title, and "(recommended)" when it is */
export function blockParagraphs(blocks: Block[]): { text: string; opt?: string; field?: string }[] {
  return blocks.flatMap((b) => {
    if (b.t === "table") return b.rows.flat().map((text) => ({ text, opt: b.opt }));
    if (b.t === "head") return [{ text: `${b.code}  ${b.title}${b.recommended ? "  (recommended)" : ""}`, opt: b.opt, field: "title" }];
    return [{ text: b.t === "bar" ? ` ${b.text.toUpperCase()} ` : b.text, opt: b.opt, field: b.field }];
  });
}


/** Build the .docx for one issued revision and hand it to the browser as a download */
export async function downloadDocx(p: Pick<ProposalFields, "number" | "rev" | "issuedAt" | "checkBy" | "note">, s: ProposalSnapshot, slug: string, opts: { accepted?: Acceptance; fictional?: string } = {}) {
  const d = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Header, Footer, Table, TableRow, TableCell, WidthType, AlignmentType, PageNumber, ShadingType } = d;
  const ref = proposalRef(p.number, p.rev);
  const green = "1F7A4D";
  const cell = (text: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })] });
  // Each block as Word draws it
  const children = proposalBlocks(p, s, opts).map((b) => {
    switch (b.t) {
      case "title": return new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: b.text, bold: true })] });
      case "para": return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: b.text, size: b.size, color: b.color, italics: b.italics })] });
      case "bar": return new Paragraph({ heading: HeadingLevel.HEADING_2, shading: { type: ShadingType.CLEAR, fill: green, color: "auto" }, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: ` ${b.text.toUpperCase()} `, bold: true, color: "FFFFFF" })] });
      case "sub": return new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: b.text, bold: true, color: green })] });
      case "bullet": return new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b.text)] });
      case "head": return new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200 }, children: [new TextRun({ text: `${b.code}  `, color: "777777", size: 18 }), new TextRun({ text: b.title, bold: true }), new TextRun({ text: b.recommended ? "  (recommended)" : "" })] });
      case "table": return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: b.rows.map((r, i) => new TableRow({ children: r.map((c) => cell(c, i === 0)) })) });
    }
  });

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


/** The paragraphs of a Word file's body, in order: each paragraph's text (tabs as spaces), table
 * cells included, page headers and footers left out. Empty paragraphs are skipped */
export async function docxParagraphs(data: ArrayBuffer): Promise<string[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return [];
  const out: string[] = [];
  // Each <w:p>…</w:p>: its runs' text (<w:t>), tabs and breaks as spaces
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const text = m[0].replace(/<w:(tab|br|cr)\b[^>]*\/>/g, " ").replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<[^>]+>/g, (_x, t: string | undefined) => t ?? "");
    const clean = decode(text).replace(/\s+/g, " ").trim();
    if (clean) out.push(clean);
  }
  return out;
}

// XML entities back to characters
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_x, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_x, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");


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
