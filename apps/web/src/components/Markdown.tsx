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


/** Render a Markdown document as blocks */
export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    // Blank lines only separate blocks
    if (!line.trim()) {
      i++;
      continue;
    }
    // Headings: levels one to three; level one uses the page title style
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      blocks.push(<Tag key={i} className={level === 1 ? "page-title" : "section-h"}>{inline(h[2]!, i)}</Tag>);
      i++;
      continue;
    }
    // Lists: consecutive "- " or "1. " lines
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        items.push(<li key={i}>{inline(lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, ""), i)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={`l${i}`}>{items}</ol> : <ul key={`l${i}`}>{items}</ul>);
      continue;
    }
    // Tables: a header row, a separator row, then body rows
    if (line.trim().startsWith("|") && /^\s*\|?\s*-{3}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={`t${i}`} style={{ overflowX: "auto" }}>
          <table className="people">
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, ri * 100 + j)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    // Paragraphs: consecutive plain lines, joined with line breaks kept
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(<p key={`p${i}`}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, i * 10 + j)}</Fragment>)}</p>);
  }
  return <>{blocks}</>;
}
