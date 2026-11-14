// apps/web/src/lib/export-plan.ts - What the organization export holds, decided without the network:
// where each record and file goes in the zip, why a file is left out, whether the export is complete,
// and the manifest.json and README.txt that say so. No api.ts import, so it runs under vitest.


import { fileState, type DocumentRecord, type FileState, type Item, type Project, type Tenant } from "@1neon/domain";


// --- Limits -----------------------------------------------------------------------------------

/**
 * The largest export built in memory, for browsers that can't write it to disk as it goes (older
 * Safari and iOS, private windows). A browser tab's memory runs out somewhere between 2 and 4 GB on
 * most desktops and far sooner on phones; the whole zip sits in memory once, plus one file at a time,
 * so 1.5 GB leaves headroom. Above it the admin is warned before anything starts.
 */
export const MEMORY_LIMIT_BYTES = 1.5 * 1024 ** 3;

/** Room asked for on disk beyond the files themselves: records, zip headers, and slack */
export const DISK_MARGIN_BYTES = 64 * 1024 ** 2;


// --- Names and paths --------------------------------------------------------------------------

/** A name safe in a zip on every system */
export const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";

/** Top-level names the export writes itself; a project folder never takes one */
export const RESERVED = ["organization.json", "members.csv", "projects.csv", "decisions.csv", "invoices.csv", "payments.csv", "items.csv", "manifest.json", "README.txt", "files", "trash"];

/**
 * Hands out unique zip paths. Compared without case, since Windows and macOS treat "A.pdf" and "a.pdf"
 * as one file; a repeat gets " (2)", " (3)" before its extension (or at the end, for a folder)
 */
export class Paths {
  private taken = new Set<string>();
  constructor(reserved: string[] = []) {
    for (const r of reserved) this.taken.add(r.toLowerCase());
  }
  claim(path: string, folder = false): string {
    let out = path;
    for (let k = 2; this.taken.has(out.toLowerCase()); k++) out = folder ? `${path} (${k})` : path.replace(/(\.[^./]*)?$/, ` (${k})$1`);
    this.taken.add(out.toLowerCase());
    return out;
  }
}

/** A project's folder: its key at the top, or under trash/ when it's in Trash */
export const projectFolder = (key: string, trashed: boolean) => (trashed ? `trash/${safe(key)}` : safe(key));


// --- What goes in -----------------------------------------------------------------------------

/** A project as the export holds it: the full read, and whether it came from Trash */
export type Held = { project: Project; items: Item[]; docs: DocumentRecord[]; trashed: boolean; folder: string };

/** One file the export tries to include, with the path it gets in the zip */
export type Planned = { doc: DocumentRecord; path: string; projectKey?: string; trashed: boolean; state: FileState };

/**
 * Give every project a folder and every file a path. Live projects keep their key as the folder,
 * trashed ones go under trash/; files go in the project's files/ (or files/ for the organization's own)
 */
export function plan(projects: Omit<Held, "folder">[], orgDocs: DocumentRecord[]): { held: Held[]; files: Planned[] } {
  const folders = new Paths(RESERVED);
  const files = new Paths();
  const held: Held[] = projects.map((p) => ({ ...p, folder: folders.claim(projectFolder(p.project.key, p.trashed), true) }));
  const out: Planned[] = [];
  for (const doc of orgDocs) out.push({ doc, path: files.claim(`files/${safe(doc.name)}`), trashed: false, state: fileState(doc) });
  for (const h of held) for (const doc of h.docs) out.push({ doc, path: files.claim(`${h.folder}/files/${safe(doc.name)}`), projectKey: h.project.key, trashed: h.trashed, state: fileState(doc) });
  return { held, files: out };
}

/** Bytes the files should come to, from their records, before any download */
export const expectedBytes = (files: Planned[]) => files.reduce((n, f) => n + (f.doc.size || 0), 0);


// --- Why a file is left out -------------------------------------------------------------------

/** A failed read as the export sees it: an API refusal (status and code), a storage refusal (status
 * only), or a plain network error */
export type Failure = { status?: number; body?: { error?: string; message?: string }; message?: string };

/** A refusal that won't change on a retry: the API says so with 410 (flagged or failed for good) */
export const permanent = (e: unknown) => (e as Failure | undefined)?.status === 410;

/** Why a file isn't in the export, in plain words, from its state and how its download failed */
export function reason(state: FileState, e: unknown): string {
  const f = (e ?? {}) as Failure;
  if (f.status === 410 && f.body?.error === "infected") return "flagged by the malware scan, so it can't be downloaded";
  if (f.status === 410) return `the upload failed${f.body?.message ? `: ${f.body.message}` : ""}`;
  if (f.status === 409) return state === "receiving" ? "the upload never finished" : "still being checked for malware";
  if (f.status === 404 && f.body?.error === "not_found") return "it was deleted while the export ran";
  if (f.status) return `download failed: ${f.status}`;
  return `download failed: ${f.message || "no answer"}`;
}


// --- The manifest -----------------------------------------------------------------------------

/** One file's line in manifest.json */
export type FileEntry = { path: string; name: string; id: string; project?: string; trashed?: true; bytes: number; sha256?: string; status: "included" | "omitted"; reason?: string };
/** One record file (JSON or CSV) in manifest.json */
export type RecordEntry = { path: string; bytes: number; sha256: string };

/** Counts of everything in the export, so a reader can check the zip against them. null: not read
 * (an older API without the export's routes), so the number isn't known */
export type Counts = {
  projects: number;
  trashedProjects: number | null;
  members: number;
  items: Record<string, number>;
  decisions: number;
  invoices: number;
  payments: number;
  comments: number | null;
  activity: number | null;
  files: { expected: number; included: number; omitted: number };
  bytes: { expected: number; included: number };
};

/** Something the export doesn't hold, and why. `partial` when it should be there and isn't (that makes
 * the export partial); otherwise it's left out on purpose, said so nobody wonders */
export type NotIncluded = { what: string; why: string; partial: boolean };

/** Which of the export's own reads the API answered ("unavailable": an older API without the route) */
export type Reads = { trash: "included" | "unavailable"; history: "included" | "unavailable" };

export type Manifest = {
  format: "1neon-export/1";
  exportedAt: string;
  organization: { id: string; slug: string; clientId: string; name: string };
  complete: boolean;
  trash: Reads["trash"];
  history: Reads["history"];
  counts: Counts;
  notInExport: NotIncluded[];
  records: RecordEntry[];
  files: FileEntry[];
};

/** What the export never holds, by design, and what it couldn't read this time */
export function notIncluded(reads: Reads, held: Held[]): NotIncluded[] {
  const out: NotIncluded[] = [];
  if (reads.trash === "unavailable") out.push({ what: "Projects in Trash", why: "this version of 1NEON can't export them; ask neon1 for them", partial: true });
  if (reads.history === "unavailable") out.push({ what: "Comments and the activity history", why: "this version of 1NEON can't export them; ask neon1 for them", partial: true });
  // A client admin never sees invoice drafts; when the export holds none, say they're left out
  if (!held.some((h) => h.items.some((i) => i.kind === "invoice" && i.status === "draft"))) out.push({ what: "Invoice drafts neon1 hasn't issued yet, and comments on them", why: "they're neon1's working copies until issued; every issued invoice is included", partial: false });
  out.push({ what: "Files still being uploaded to the organization's own files (not to a project)", why: "they have no content until the upload finishes; ones on a project are listed in manifest.json", partial: false });
  out.push({ what: "Each person's notifications, sign-in methods (passkeys, authenticator apps, phone numbers), and display preferences", why: "they belong to that person, not to the organization", partial: false });
  out.push({ what: "Who is editing what at the moment", why: "it's temporary and clears itself within minutes", partial: false });
  return out;
}

/** Build manifest.json's content. Complete: every file arrived, and Trash and the history were read */
export function manifest(input: { org: Tenant; at: string; held: Held[]; reads: Reads; members: number; comments: number; activity: number; records: RecordEntry[]; files: FileEntry[] }): Manifest {
  const { org, held, files, reads } = input;
  const items: Record<string, number> = {};
  for (const h of held) for (const i of h.items) items[i.kind] = (items[i.kind] ?? 0) + 1;
  const all = held.flatMap((h) => h.items);
  const included = files.filter((f) => f.status === "included");
  const omitted = files.length - included.length;
  const notInExport = notIncluded(reads, held);
  return {
    format: "1neon-export/1",
    exportedAt: input.at,
    organization: { id: org.id, slug: org.slug, clientId: org.clientId, name: org.name },
    complete: omitted === 0 && !notInExport.some((n) => n.partial),
    trash: reads.trash,
    history: reads.history,
    counts: {
      projects: held.filter((h) => !h.trashed).length,
      trashedProjects: reads.trash === "included" ? held.filter((h) => h.trashed).length : null,
      members: input.members,
      items,
      decisions: all.filter((i) => i.kind === "decision").length,
      invoices: all.filter((i) => i.kind === "invoice" && i.status !== "draft").length,
      payments: all.filter((i) => i.kind === "payment").length,
      comments: reads.history === "included" ? input.comments : null,
      activity: reads.history === "included" ? input.activity : null,
      files: { expected: files.length, included: included.length, omitted },
      bytes: { expected: files.reduce((n, f) => n + f.bytes, 0), included: included.reduce((n, f) => n + f.bytes, 0) },
    },
    notInExport,
    records: input.records,
    files,
  };
}


// --- Complete or partial, in words ------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one line that opens README.txt and ends the Settings status */
export function verdict(m: Pick<Manifest, "complete" | "notInExport" | "counts">): string {
  if (m.complete) return "This export is complete.";
  const missed = m.counts.files.omitted;
  const parts = [
    ...(missed ? [`${plural(missed, "file is", "files are")} not included (listed below and in manifest.json)`] : []),
    ...m.notInExport.filter((n) => n.partial).map((n) => `${n.what[0]!.toLowerCase()}${n.what.slice(1)} are not included (this version of 1NEON can't export them)`),
  ];
  return `This export is partial: ${parts.join("; ")}.`;
}

/** The zip's name: the organization, the day, and complete or partial, so the file itself says which */
export const zipName = (slug: string, at: string, complete: boolean) => `${safe(slug)}-1neon-export-${at.slice(0, 10)}-${complete ? "complete" : "partial"}.zip`;

/** Bytes as people read them */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024, u = 0;
  while (n >= 1024 && u < units.length - 1) (n /= 1024), u++;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[u]}`;
}

/**
 * The warning shown before an in-memory export too big to be safe; undefined when it's fine. Disk
 * exports don't need one: they check free space instead
 */
export function memoryWarning(bytes: number, limit = MEMORY_LIMIT_BYTES): string | undefined {
  if (bytes <= limit) return undefined;
  return `This export is about ${size(bytes)}. This browser has to build it in memory, and above ${size(limit)} it may run out and stop. For a large export, use Chrome, Edge, or Firefox on a computer, which save it to disk as it goes.`;
}


// --- README.txt -------------------------------------------------------------------------------

/** README.txt: the verdict first, then what each file holds, then what's not here and why */
export function readme(m: Manifest): string {
  const omitted = m.files.filter((f) => f.status === "omitted");
  const lines = [
    "- manifest.json: the list of everything here. It says whether the export is complete, counts every kind\n  of record, and lists every file with its path, size in bytes, and SHA-256 checksum, so you can check\n  nothing was lost or changed. A file that couldn't be included is listed too, with the reason.",
    "- organization.json: the organization, its board stages, and its signed service agreements.",
    "- members.csv: everyone with access, their role, and whether they've joined.",
    "- projects.csv: one row per project, with its stage, health, dates, folder, and whether it's in Trash.",
    "- decisions.csv: every approved option, who signed, the typed name, and the reason.",
    "- invoices.csv and payments.csv: every issued invoice and every payment recorded against one, in dollars.",
    "- items.csv: every record on every project (requests, questions, requirements, options, tasks, updates,\n  checks, handover steps, and the rest), one row each.",
    ...(m.history === "included" ? [
      "- comments.csv: every comment on every record, with who wrote it and when.",
      "- activity.csv and activity.json: the organization's activity history (who did what, and when), oldest\n  first, as far back as 1NEON keeps it.",
    ] : []),
    "- <project key>/project.json: that project's complete record, every field, as 1NEON stores it, with its\n  comments. Issued proposals are in it as \"proposal\" items, each with the exact snapshot the client approved.",
    "- <project key>/files/: the files uploaded to that project, as uploaded.",
    "- files/: files uploaded to the organization rather than to one project.",
    ...(m.trash === "included" ? [`- trash/<project key>/: projects in Trash (${m.counts.trashedProjects ?? 0} of them), laid out like the others. projects.csv\n  marks them in its "trashed" column with the date they were trashed.`] : []),
  ];
  return `${verdict(m)}

${m.organization.name} (${m.organization.clientId}): everything in 1NEON, exported ${m.exportedAt}

What's in this file
${lines.join("\n")}

Formats: JSON (UTF-8) and CSV (UTF-8, comma-separated, first row is the column names). Dates are ISO 8601
in UTC; amounts in CSV are dollars, and in JSON are cents ("Cents" fields).
${omitted.length ? `\nFiles not included (download them from Files, upload again any that never finished, and ask neon1 for ones in\nTrash; then export again):\n${omitted.map((f) => `- ${f.path}: ${f.reason}`).join("\n")}\n` : ""}
Not in this export
${m.notInExport.map((n) => `- ${n.what}: ${n.why}.`).join("\n")}
`;
}


// --- Checksums --------------------------------------------------------------------------------

/** SHA-256 of some bytes, as lowercase hex (Web Crypto, in the browser and in Node) */
export async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
