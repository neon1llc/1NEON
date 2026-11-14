// apps/web/src/lib/export-build.ts - The organization export's work, with the network passed in: read
// every record (Trash, comments, and the activity history too, where the API allows), then hand the zip its entries one at a time, so no
// more than one uploaded file is in memory at once. manifest.json and README.txt come last, once every
// file has been tried. No api.ts import, so tests drive it with a fake API.


import { InvoiceFields, invoiceTotal, KIND_LAYER, OptionFields, PaymentFields, revisions, type AuditEvent, type DocumentRecord, type Item, type Project, type Tenant } from "@1neon/domain";
import { csv } from "./csv.ts";
import { expectedBytes, manifest, permanent, plan, readme, reason, sha256, size, type FileEntry, type Held, type Manifest, type Planned, type Reads, type RecordEntry } from "./export-plan.ts";
import type { MemberRow } from "./types.ts";


// --- The network, as the export uses it -------------------------------------------------------

/** Reads the export needs. `get` is an API read; `file` turns a download address into the file's bytes.
 * Both throw on failure, an API refusal carrying `status` (and `body.error`) */
export interface Source {
  get<T>(path: string): Promise<T>;
  file(downloadPath: string): Promise<ArrayBuffer>;
}

export type Progress = (said: string) => void;

/** One entry for the zip writer (client-zip's input shape) */
export type ZipEntry = { name: string; input: Uint8Array; lastModified: Date };

/** A comment on an item, as the export's history read gives it */
export type Comment = { projectId: string; itemId: string; id: string; at: string; authorId: string; authorName: string; body: string };

/** Everything read, with paths planned, before any file is downloaded */
export type Gathered = { at: string; held: Held[]; files: Planned[]; members: MemberRow[]; comments: Comment[]; activity: AuditEvent[]; reads: Reads; expected: number };


// --- Reading the records ----------------------------------------------------------------------

type Detail = { project: Project; items: Item[]; docs: DocumentRecord[] };

/** Read every project (live and, where the API allows, in Trash), every member, and the file index */
export async function gather(org: Tenant, src: Source, say: Progress): Promise<Gathered> {
  const at = new Date().toISOString();
  say("Reading projects and people…");
  // Trash first: it's the one read that can ask the admin to confirm it's them, so it fails before
  // anything else is spent. 404 means an older API without the route: say so, don't guess
  const absent = (e: { status?: number }) => {
    if (e?.status === 404) return undefined;
    throw e;
  };
  const trash = await src.get<{ projects: Detail[] }>(`/t/${org.id}/export/trash`).catch(absent);
  const history = await src.get<{ comments: Comment[]; audit: AuditEvent[] }>(`/t/${org.id}/export/history`).catch(absent);
  const [projects, members, index] = await Promise.all([
    src.get<Project[]>(`/t/${org.id}/projects`),
    src.get<MemberRow[]>(`/t/${org.id}/members`),
    src.get<{ docs: DocumentRecord[] }>(`/t/${org.id}/docs`),
  ]);
  // The API lists live projects only; anything trashed comes from the Trash read above
  const live = projects.filter((p) => !p.deletedAt);
  const details: Detail[] = [];
  for (const [i, p] of live.entries()) {
    say(`Reading ${p.key} (${i + 1} of ${live.length})…`);
    details.push(await src.get<Detail>(`/t/${org.id}/projects/${p.id}`));
  }
  // Project files come from each project's own read, which includes uploads that never finished; the
  // index adds the organization's own files
  const { held, files } = plan([
    ...details.map((d) => ({ project: d.project, items: d.items, docs: d.docs, trashed: false })),
    ...(trash?.projects ?? []).map((d) => ({ project: d.project, items: d.items, docs: d.docs, trashed: true })),
  ], index.docs.filter((x) => !x.projectId));
  return {
    at, held, files, members,
    comments: history?.comments ?? [],
    activity: history?.audit ?? [],
    reads: { trash: trash ? "included" : "unavailable", history: history ? "included" : "unavailable" },
    expected: expectedBytes(files),
  };
}


// --- The records as files ---------------------------------------------------------------------

const dollars = (cents: number | undefined) => (cents === undefined ? "" : (cents / 100).toFixed(2));

/** organization.json, the CSV tables, and each project's project.json, as [path, text] */
export function records(org: Tenant, g: Pick<Gathered, "at" | "held" | "members" | "comments" | "activity" | "reads">): [string, string][] {
  const { at, held, members, comments, activity } = g;
  const out: [string, string][] = [];
  out.push(["organization.json", JSON.stringify({ exportedAt: at, organization: org }, null, 2)]);
  out.push(["members.csv", csv(members.map((m) => ({ name: m.name, email: m.email, title: m.title, access: m.access, status: m.status, invitedAt: m.invitedAt, joinedAt: m.joinedAt ?? "" })), ["name", "email", "title", "access", "status", "invitedAt", "joinedAt"])]);
  // One row per project, trashed ones too: "trashed" holds the date it went to Trash
  out.push(["projects.csv", csv(held.map(({ project: p, folder }) => ({ key: p.key, name: p.name, stage: org.stages.find((s) => s.id === p.stageId)?.name ?? p.stageId, health: p.health, archived: p.archived ? "yes" : "", trashed: p.deletedAt ?? "", targetDate: p.targetDate ?? "", createdAt: p.createdAt, updatedAt: p.updatedAt, folder })), ["key", "name", "stage", "health", "archived", "trashed", "targetDate", "createdAt", "updatedAt", "folder"])]);

  // Decisions, invoices, payments, and every item, across projects
  const all = held.flatMap((h) => h.items.map((i) => ({ i, key: h.project.key })));
  out.push(["decisions.csv", csv(all.filter(({ i }) => i.kind === "decision").map(({ i, key }) => {
    const f = i.fields as { code?: string; approverName?: string; approvedAt?: string; reason?: string; signature?: { typedName?: string }; supersedes?: string[]; terms?: Record<string, unknown> };
    return { project: key, option: i.title.replace(/^Approved: /, ""), code: f.code ?? "", approvedBy: f.approverName ?? "", approvedAt: f.approvedAt ?? i.createdAt, signedAs: f.signature?.typedName ?? "", reason: f.reason ?? "", replacesEarlier: f.supersedes?.length ? "yes" : "", price: (f.terms as { cost?: string } | undefined)?.cost ?? "", depositPercent: OptionFields.partial().safeParse(f.terms ?? {}).data?.depositPercent ?? "" };
  }), ["project", "option", "code", "approvedBy", "approvedAt", "signedAs", "reason", "replacesEarlier", "price", "depositPercent"])]);
  out.push(["invoices.csv", csv(all.filter(({ i }) => i.kind === "invoice" && i.status !== "draft").map(({ i, key }) => {
    const f = InvoiceFields.safeParse(i.fields).data;
    return { project: key, number: f?.number ?? "", type: f?.type ?? "", status: i.status, issuedAt: f?.issuedAt ?? "", dueDate: f?.dueDate ?? "", total: f ? dollars(invoiceTotal(f)) : "", lines: f?.lines.map((l) => `${l.text}: ${dollars(Math.round(l.qty * l.unitCents))}`).join("; ") ?? "", note: f?.note ?? "", voided: f?.voided ? `${f.voided.at} by ${f.voided.name}: ${f.voided.reason}` : "" };
  }), ["project", "number", "type", "status", "issuedAt", "dueDate", "total", "lines", "note", "voided"])]);
  const invoiceNo = new Map(all.filter(({ i }) => i.kind === "invoice").map(({ i }) => [i.id, String((i.fields as { number?: string }).number ?? "")]));
  out.push(["payments.csv", csv(all.filter(({ i }) => i.kind === "payment").map(({ i, key }) => {
    const f = PaymentFields.safeParse(i.fields).data;
    return { project: key, invoice: f ? invoiceNo.get(f.invoiceId) ?? "" : "", amount: dollars(f?.amountCents), method: f?.method ?? "", reference: f?.ref ?? "", receivedAt: f?.receivedAt ?? "", status: i.status === "done" ? "received" : i.status };
  }), ["project", "invoice", "amount", "method", "reference", "receivedAt", "status"])]);
  out.push(["items.csv", csv(all.map(({ i, key }) => ({ project: key, kind: i.kind, title: i.title, status: i.status, layer: KIND_LAYER[i.kind] ?? "", description: i.body, dueDate: i.dueDate ?? "", createdAt: i.createdAt, updatedAt: i.updatedAt, id: i.id })), ["project", "kind", "title", "status", "layer", "description", "dueDate", "createdAt", "updatedAt", "id"])]);

  // Comments and the activity history, when the API could read them
  const itemOf = new Map(held.flatMap((h) => h.items.map((i) => [i.id, { key: h.project.key, title: i.title }] as const)));
  if (g.reads.history === "included") {
    out.push(["comments.csv", csv(comments.map((c) => ({ project: itemOf.get(c.itemId)?.key ?? "", item: itemOf.get(c.itemId)?.title ?? "", at: c.at, author: c.authorName, comment: c.body, itemId: c.itemId, id: c.id })), ["project", "item", "at", "author", "comment", "itemId", "id"])]);
    const nameOf = new Map(members.map((m) => [m.userId, m.name]));
    out.push(["activity.csv", csv(activity.map((e) => ({ at: e.at, who: nameOf.get(e.actorId) ?? e.actorId, action: e.action, summary: e.summary, details: e.details?.join("; ") ?? "", target: e.target, id: e.id })), ["at", "who", "action", "summary", "details", "target", "id"])]);
    out.push(["activity.json", JSON.stringify({ exportedAt: at, activity }, null, 2)]);
  }

  // Each project's complete record, every field, with its comments
  for (const h of held) {
    const proposals = revisions(h.items).map((r) => ({ number: r.p.number, rev: r.p.rev, issuedAt: r.p.issuedAt, id: r.id }));
    const mine = new Set(h.items.map((i) => i.id));
    out.push([`${h.folder}/project.json`, JSON.stringify({ exportedAt: at, trashedAt: h.project.deletedAt, project: h.project, proposals, items: h.items, comments: comments.filter((c) => mine.has(c.itemId)), files: h.docs }, null, 2)]);
  }
  return out;
}


// --- The zip's entries, in order --------------------------------------------------------------

/** Where a file's download link comes from: the normal route, or the admin's Trash route */
export function downloadPath(org: Tenant, f: Planned): string {
  const d = f.doc;
  if (f.trashed) return `/t/${org.id}/export/trash/${d.projectId}/docs/${d.id}/download`;
  return `/t/${org.id}/docs/${d.id}/download${d.projectId ? `?p=${d.projectId}` : ""}`;
}

/** A file's bytes, asking once more if the first try fails (not when the API says it never will) */
async function fetchWithRetry(src: Source, path: string): Promise<ArrayBuffer> {
  try {
    return await src.file(path);
  } catch (e) {
    if (permanent(e)) throw e;
    return await src.file(path);
  }
}

/**
 * The zip's entries: records first, then each file as it downloads (hashed, then let go), then
 * manifest.json and README.txt describing exactly what arrived. `finished` gets the manifest once the
 * last entry is taken; the zip writer pulls entries one at a time, so memory holds one file at most
 */
export async function* entries(org: Tenant, g: Gathered, src: Source, say: Progress, finished: (m: Manifest) => void): AsyncGenerator<ZipEntry> {
  const enc = new TextEncoder();
  const when = new Date(g.at);
  const recs: RecordEntry[] = [];
  for (const [path, text] of records(org, g)) {
    const input = enc.encode(text);
    recs.push({ path, bytes: input.byteLength, sha256: await sha256(input) });
    yield { name: path, input, lastModified: when };
  }

  // Files, as uploaded; one that can't be read is listed with the reason instead
  const out: FileEntry[] = [];
  let done = 0;
  for (const [n, f] of g.files.entries()) {
    say(`Adding files (${n + 1} of ${g.files.length}, ${size(done)} of about ${size(g.expected)})…`);
    const base = { path: f.path, name: f.doc.name, id: f.doc.id, ...(f.projectKey ? { project: f.projectKey } : {}), ...(f.trashed ? { trashed: true as const } : {}) };
    let bytes: ArrayBuffer;
    try {
      bytes = await fetchWithRetry(src, downloadPath(org, f));
    } catch (e) {
      out.push({ ...base, bytes: f.doc.size, status: "omitted", reason: reason(f.state, e) });
      continue;
    }
    const input = new Uint8Array(bytes);
    done += input.byteLength;
    out.push({ ...base, bytes: input.byteLength, sha256: await sha256(input), status: "included" });
    yield { name: f.path, input, lastModified: new Date(f.doc.updatedAt || f.doc.createdAt || g.at) };
  }

  // What arrived, then the plain-words guide that opens with complete or partial
  const m = manifest({ org, at: g.at, held: g.held, reads: g.reads, members: g.members.length, comments: g.comments.length, activity: g.activity.length, records: recs, files: out });
  yield { name: "manifest.json", input: enc.encode(JSON.stringify(m, null, 2)), lastModified: when };
  yield { name: "README.txt", input: enc.encode(readme(m)), lastModified: when };
  finished(m);
}
