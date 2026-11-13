// apps/web/src/lib/csv.ts - Rows as CSV that any spreadsheet opens cleanly (the organization export).


/** One CSV cell: quoted when it holds a comma, quote, or line break; a formula sign is defused so a
 * spreadsheet shows it as text */
function cell(v: unknown): string {
  let s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of named columns as CSV, with a header line; a byte-order mark so Excel reads UTF-8 */
export function csv(rows: Record<string, unknown>[], columns: string[]): string {
  return "\ufeff" + [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

