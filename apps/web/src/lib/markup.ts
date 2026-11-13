// apps/web/src/lib/markup.ts - What a client changed in an edited copy of a proposal, and which
// option fields those changes map to. The edited Word file (from Word, Google Docs, or Pages) is read
// paragraph by paragraph and lined up against the paragraphs the issued revision printed; each change
// is traced to the option and field it came from where it can be, and anything else is listed for
// neon1 to handle by hand.


/** One printed paragraph of the issued revision: its words, and the option and field it came from */
export interface Printed { text: string; opt?: string; field?: string }

/** One change in the edited copy */
export interface Change {
  kind: "changed" | "added" | "removed";
  before?: string;
  after?: string;
  // The option it falls under (its code) and the field it changed, when known
  opt?: string;
  field?: string;
}

/** What a change means for an option: the field, its value before, and the value the copy asks for */
export interface Suggestion { label: string; before: string; after: string; change: Change }

/** The changes for one option, ready to apply: the fields to set, and why */
export interface OptionUpdate {
  code: string;
  title?: string;
  body?: string;
  fields: Record<string, unknown>;
  says: Suggestion[];
}

// Typography a word processor swaps in (curly quotes, long dashes, nonbreaking spaces) counts as the same
export const norm = (t: string) => t.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();


/** Line two lists of paragraphs up (longest common run) and say what was kept, removed, and added */
function align(a: string[], b: string[]): { op: "same" | "del" | "ins"; i?: number; j?: number }[] {
  const n = a.length;
  const m = b.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: { op: "same" | "del" | "ins"; i?: number; j?: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: "same", i, j }); i++; j++; }
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) out.push({ op: "del", i: i++ });
    else out.push({ op: "ins", j: j++ });
  }
  while (i < n) out.push({ op: "del", i: i++ });
  while (j < m) out.push({ op: "ins", j: j++ });
  return out;
}

/** How alike two paragraphs are, from 0 to 1: the share of words they have in common */
function alike(x: string, y: string) {
  const a = x.toLowerCase().split(" ");
  const b = new Map<string, number>();
  for (const w of y.toLowerCase().split(" ")) b.set(w, (b.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of a) { const n = b.get(w) ?? 0; if (n) { common++; b.set(w, n - 1); } }
  return common / Math.max(a.length, y.split(" ").length);
}

/** Every change between what was issued and the edited copy. Removed and added paragraphs side by side
 * pair up as changed ones; an added paragraph belongs to the option of the paragraph before it */
export function compare(printed: Printed[], edited: string[]): Change[] {
  const a = printed.map((p) => norm(p.text));
  const b = edited.map(norm).filter(Boolean);
  const steps = align(a, b);
  const out: Change[] = [];
  let k = 0;
  // The last issued paragraph passed, for where an added one sits
  let at: Printed | undefined;
  while (k < steps.length) {
    if (steps[k]!.op === "same") { at = printed[steps[k]!.i!]; k++; continue; }
    const dels: number[] = [];
    const ins: number[] = [];
    while (k < steps.length && steps[k]!.op !== "same") {
      const s = steps[k++]!;
      if (s.op === "del") dels.push(s.i!);
      else ins.push(s.j!);
    }
    // Each removed paragraph pairs with the most alike added one after the last pairing (in order),
    // when they share enough words to be the same paragraph edited; the rest were removed or added
    const pairedTo = new Map<number, number>();
    let after = -1;
    for (const d of dels) {
      let best = -1;
      let score = 0.34;
      for (const j of ins) {
        if (j <= after) continue;
        const sc = alike(a[d]!, b[j]!);
        if (sc > score) { score = sc; best = j; }
      }
      if (best >= 0) { pairedTo.set(best, d); after = best; }
    }
    // What's left over pairs in order when as many were removed as added: a paragraph rewritten
    const lonelyD = dels.filter((x) => ![...pairedTo.values()].includes(x));
    const lonelyI = ins.filter((j) => !pairedTo.has(j));
    if (lonelyD.length === lonelyI.length) lonelyI.forEach((j, n) => pairedTo.set(j, lonelyD[n]!));
    const paired = new Set(pairedTo.values());
    // In reading order: each added paragraph either answers a removed one or is new where it sits
    let last = at;
    for (const d of dels.filter((x) => !paired.has(x))) { const p = printed[d]!; out.push({ kind: "removed", before: p.text, opt: p.opt, field: p.field }); }
    for (const j of ins) {
      const d = pairedTo.get(j);
      if (d !== undefined) { const p = printed[d]!; out.push({ kind: "changed", before: p.text, after: b[j]!, opt: p.opt, field: p.field }); last = p; }
      else out.push({ kind: "added", after: b[j]!, opt: last?.opt, field: last?.opt ? "body" : undefined });
    }
    if (dels.length) at = printed[dels.at(-1)!];
  }
  return out;
}


/** Word by word, what stayed, what went, and what came in: for showing a changed paragraph */
export function words(before: string, after: string): { op: "same" | "del" | "ins"; text: string }[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  return align(a, b).map((s) => ({ op: s.op, text: s.op === "ins" ? b[s.j!]! : a[s.i!]! }));
}


// The labeled parts of an option's summary line ("Timeline: 2 weeks · Price: …") and the fields they set
const META: Record<string, string> = { "neon1's time": "hours", Timeline: "timeline", Price: "cost", "Paid directly by you": "outsideCosts" };
const metaOf = (line: string) => Object.fromEntries(norm(line).split(" · ").map((part) => { const at = part.indexOf(": "); return at > 0 ? [part.slice(0, at), part.slice(at + 2)] : [part, ""]; }));

/** A body with one printed paragraph (a paragraph, a bullet, or a subhead) replaced, or removed when
 * `next` is undefined; undefined when that paragraph can't be found in it */
export function replaceInBody(body: string, was: string, next: string | undefined): string | undefined {
  const chunks = body.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const w = norm(was);
  for (let c = 0; c < chunks.length; c++) {
    const lines = chunks[c]!.trim().split("\n");
    // A whole paragraph, as the proposal printed it (its lines joined)
    const head = /^[^-].{0,40}:$/.test(lines[0] ?? "") ? lines.slice(1) : lines;
    if (head.length && norm(head.join(" ")) === w && !head.every((l) => l.startsWith("- "))) {
      const keep = lines.length > head.length ? [lines[0]!] : [];
      chunks[c] = next === undefined ? keep.join("\n") : [...keep, next].join("\n");
      return chunks.filter((x) => x.trim()).join("\n\n");
    }
    // A bullet, or a subhead (printed without its colon)
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l]!;
      if (line.startsWith("- ") && norm(line.slice(2)) === w) { if (next === undefined) lines.splice(l, 1); else lines[l] = `- ${next}`; chunks[c] = lines.join("\n"); return chunks.filter((x) => x.trim()).join("\n\n"); }
      if (l === 0 && /:$/.test(line) && norm(line.slice(0, -1)) === w) { if (next === undefined) lines.splice(0, 1); else lines[0] = `${next}:`; chunks[c] = lines.join("\n"); return chunks.filter((x) => x.trim()).join("\n\n"); }
    }
  }
  return undefined;
}

/** An option as the suggestions read it */
export interface OptionNow { code: string; title: string; body: string; fields: { pricing?: string; recommended?: boolean; depositPercent?: number; [k: string]: unknown } }

/**
 * The changes traced to option fields, per option, and the rest for neon1 to handle by hand. Only
 * what a change clearly says is suggested: a new title, a sentence of the description, the summary
 * line's timeline, time, price (for a fixed price), or direct costs, the target result, the reason,
 * and a deposit share in the payment line
 */
export function suggest(changes: Change[], options: OptionNow[]): { updates: OptionUpdate[]; manual: Change[] } {
  const by = new Map<string, OptionUpdate>();
  const manual: Change[] = [];
  const upd = (o: OptionNow) => by.get(o.code) ?? by.set(o.code, { code: o.code, fields: {}, says: [] }).get(o.code)!;
  // The description as edited so far, so several sentence changes stack
  const bodies = new Map(options.map((o) => [o.code, o.body]));
  for (const ch of changes) {
    const o = options.find((x) => x.code === ch.opt);
    if (!o) { manual.push(ch); continue; }
    const u = upd(o);
    const after = ch.after === undefined ? undefined : norm(ch.after);
    const before = ch.before === undefined ? "" : norm(ch.before);
    let used = false;
    if (ch.field === "title" && ch.kind === "changed" && after) {
      const title = after.replace(/^\d{4}-r\d+-[A-Z]\s*/, "").replace(/\s*\(recommended\)\s*$/i, "").trim();
      if (title && title !== o.title) { u.title = title; u.says.push({ label: "Title", before: o.title, after: title, change: ch }); used = true; }
      const rec = /\(recommended\)\s*$/i.test(after);
      if (rec !== Boolean(o.fields.recommended)) { u.fields.recommended = rec; u.says.push({ label: "Recommended", before: o.fields.recommended ? "yes" : "no", after: rec ? "yes" : "no", change: ch }); used = true; }
    } else if (ch.field === "meta" && ch.kind === "changed" && after) {
      const was = metaOf(before);
      const now = metaOf(after);
      for (const [label, key] of Object.entries(META)) {
        if ((now[label] ?? "") === (was[label] ?? "") || now[label] === undefined) continue;
        // An estimate's price comes from its rate and hours, so a new figure there is neon1's to work out
        if (key === "cost" && o.fields.pricing === "estimate") continue;
        u.fields[key] = now[label];
        u.says.push({ label: label === "Price" ? "Price" : label, before: was[label] ?? "", after: now[label]!, change: ch });
        used = true;
      }
    } else if ((ch.field === "result" || ch.field === "why") && ch.kind === "changed" && after) {
      const text = ch.field === "result" ? after.replace(/^Target result:\s*/i, "") : after.replace(/^(Why I recommend it|When to pick it):\s*/i, "");
      u.fields[ch.field] = text;
      u.says.push({ label: ch.field === "result" ? "Target result" : "Why pick it", before: before.replace(/^[^:]+:\s*/, ""), after: text, change: ch });
      used = true;
    } else if (ch.field === "pay" && ch.kind === "changed" && after) {
      // "20% deposit", "20% of the low end", or nothing up front
      const pct = /nothing up front|no deposit/i.test(after) ? 0 : Number(/(\d{1,3})\s*%/.exec(after)?.[1] ?? NaN);
      if (Number.isFinite(pct) && pct >= 0 && pct <= 100 && pct !== (o.fields.depositPercent ?? 50)) {
        u.fields.depositPercent = pct;
        u.says.push({ label: "Deposit up front", before: `${o.fields.depositPercent ?? 50}%`, after: `${pct}%`, change: ch });
        used = true;
      }
    } else if (ch.field === "body") {
      const cur = bodies.get(o.code) ?? "";
      const next = ch.kind === "added" ? `${cur.trim()}${cur.trim() ? "\n\n" : ""}${ch.after}` : replaceInBody(cur, ch.before ?? "", ch.kind === "removed" ? undefined : ch.after);
      if (next !== undefined) {
        bodies.set(o.code, next);
        u.body = next;
        u.says.push({ label: ch.kind === "added" ? "Description, added" : ch.kind === "removed" ? "Description, removed" : "Description", before: ch.before ?? "", after: ch.after ?? "", change: ch });
        used = true;
      }
    }
    if (!used) manual.push(ch);
  }
  return { updates: [...by.values()].filter((u) => u.says.length), manual };
}
