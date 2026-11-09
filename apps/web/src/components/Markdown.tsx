// apps/web/src/components/Markdown.tsx - A small Markdown renderer for the legal pages: headings,
// paragraphs, lists, tables, bold, italics, code, and links. It builds React elements, never HTML
// strings, so nothing is injected.


import { Fragment, type ReactNode } from "react";


/** Inline formatting inside one line of text */
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code first (its contents stay literal), then links, bold, italics
  const re = /(`[^`]+`)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${m.index}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    // Only plain web, mail, and same-site links; anything else renders as text
    else if (m[2] && m[3]) out.push(/^(https:|mailto:|\/)/.test(m[3]) ? <a key={k} href={m[3]}>{m[2]}</a> : m[2]);
    else if (m[4]) out.push(<b key={k}>{inline(m[4], key + 1)}</b>);
    else if (m[5]) out.push(<em key={k}>{inline(m[5], key + 1)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}


// Split a table row into trimmed cells, ignoring the outer pipes
const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());


/** One block of a document, before rendering */
export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; at: number }
  | { kind: "list"; ordered: boolean; items: string[]; at: number }
  | { kind: "table"; head: string[]; rows: string[][]; at: number }
  | { kind: "para"; lines: string[]; at: number };


// A line that starts a block of its own kind (heading, list item, or table row)
const STARTS_BLOCK = /^(#{1,3}\s|\s*([-*]|\d+\.)\s|\s*\|)/;


/**
 * Split a document into blocks. Every pass of the loop consumes at least one line: anything that
 * doesn't complete a heading, list, or table (a lone "|row|", a stray pipe) becomes a plain
 * paragraph, so no input can hold the loop at one line
 */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    // Blank lines only separate blocks
    if (!line.trim()) {
      i++;
      continue;
    }
    // Headings: levels one to three
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: "heading", level: h[1]!.length as 1 | 2 | 3, text: h[2]!, at: i });
      i++;
      continue;
    }
    // Lists: consecutive "- " or "1. " lines
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const at = i;
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s+/, ""));
      blocks.push({ kind: "list", ordered: /^\s*\d+\./.test(line), items, at });
      continue;
    }
    // Tables: a header row, a separator row, then body rows
    if (line.trim().startsWith("|") && /^\s*\|?\s*-{3}/.test(lines[i + 1] ?? "")) {
      const at = i;
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!));
      blocks.push({ kind: "table", head, rows, at });
      continue;
    }
    // Paragraphs: this line always, then following plain lines
    const at = i;
    const para = [lines[i++]!];
    while (i < lines.length && lines[i]!.trim() && !STARTS_BLOCK.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push({ kind: "para", lines: para, at });
  }
  return blocks;
}


/** Render a Markdown document as blocks; level one headings use the page title style */
export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseBlocks(source).map((b) => {
        const i = b.at;
        if (b.kind === "heading") {
          const Tag = b.level === 1 ? "h1" : b.level === 2 ? "h2" : "h3";
          return <Tag key={i} className={b.level === 1 ? "page-title" : "section-h"}>{inline(b.text, i)}</Tag>;
        }
        if (b.kind === "list") {
          const items = b.items.map((t, j) => <li key={j}>{inline(t, i * 100 + j)}</li>);
          return b.ordered ? <ol key={`l${i}`}>{items}</ol> : <ul key={`l${i}`}>{items}</ul>;
        }
        if (b.kind === "table") {
          return (
            <div key={`t${i}`} style={{ overflowX: "auto" }}>
              <table className="people">
                <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, ri * 100 + j)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return <p key={`p${i}`}>{b.lines.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, i * 10 + j)}</Fragment>)}</p>;
      })}
    </>
  );
}
