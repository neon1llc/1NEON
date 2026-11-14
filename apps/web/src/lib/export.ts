// apps/web/src/lib/export.ts - An organization's own copy of everything in 1NEON, as one zip file.
//
// Built in the browser from the same reads the portal already makes (plus the admin's Trash read), so
// an admin needs nobody's help. Records go in as JSON (complete, every field) and CSV (the tables a
// spreadsheet opens); uploaded files go in byte for byte; manifest.json lists every file with its size
// and SHA-256, and says whether the export is complete. What goes where is export-plan.ts; the reads
// and the zip's entries are export-build.ts; this file is the browser's part: where the zip is built,
// and saving it.
//
// Where the zip is built: on disk when the browser allows (the origin's private file system, in
// Chrome, Edge, Firefox, and recent Safari), so a large export never sits in memory; elsewhere in
// memory, with a warning first when it's large. Either way nothing is saved until the zip is whole,
// and its name says complete or partial, which is only known at the end.


import type { Tenant } from "@1neon/domain";
import { api, openable } from "./api.ts";
import { entries, gather, type Progress, type Source } from "./export-build.ts";
import { clearAfterHandOff, exportFolder, privateRoot, release, writeZip } from "./export-disk.ts";
import { DISK_MARGIN_BYTES, memoryWarning, size, zipName, type Manifest } from "./export-plan.ts";


export type { Progress };

/** How an export ended: the file's name, what's in it, and where it was built */
export type ExportResult = { name: string; manifest: Manifest; builtOn: "disk" | "memory" };

/** The admin chose not to start a large in-memory export */
export class ExportCancelled extends Error {
  constructor() {
    super("The export didn't start.");
  }
}


// --- Reads --------------------------------------------------------------------------------------

/** The live API: reads through api(), and a file's bytes from its signed link */
const source: Source = {
  get: (path) => api(path),
  async file(path) {
    const { url } = await api<{ url: string }>(path);
    const href = await openable(url);
    try {
      const r = await fetch(href);
      // Storage refused (an expired link, say): a status but no API code, so the reason says so plainly
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return await r.arrayBuffer();
    } finally {
      if (href.startsWith("blob:")) URL.revokeObjectURL(href);
    }
  },
};


// --- Saving -------------------------------------------------------------------------------------

/** Room the browser will let this site use, or Infinity when it won't say */
async function freeBytes(): Promise<number> {
  try {
    const { quota, usage = 0 } = await navigator.storage.estimate();
    return quota === undefined ? Infinity : quota - usage;
  } catch {
    return Infinity;
  }
}

/** Hand the finished zip to the browser's downloads under its final name */
function save(blob: Blob, name: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}


// --- The export -------------------------------------------------------------------------------

/**
 * Build the zip and save it. `say` reports progress in words; `confirm` is asked, before anything is
 * downloaded, whether to go on with an in-memory export too large to be safe. Resolves with what's in
 * the zip; throws (with nothing saved) if it can't finish, or ExportCancelled if the admin stops it
 */
export async function exportOrganization(org: Tenant, say: Progress, confirm: (warning: string) => Promise<boolean>): Promise<ExportResult> {
  const { makeZip } = await import("client-zip");
  const g = await gather(org, source, say);

  // Decide where to build it before downloading a byte: on disk if the browser allows and there's
  // room, else in memory. Not on disk means no folder kept
  const root = await privateRoot();
  const folder = root ? await exportFolder(root) : undefined;
  const room = folder ? await freeBytes() : 0;
  const onDisk = Boolean(folder) && room >= g.expected + DISK_MARGIN_BYTES;
  if (root && !onDisk) await release(root);

  let done: Manifest | undefined;
  const finish = (m: Manifest) => (done = m);
  /** The finished zip's name, once its manifest says complete or partial */
  const named = () => {
    if (!done) throw new Error("The zip ended before its manifest was written.");
    return zipName(org.slug, g.at, done.complete);
  };

  if (onDisk && root && folder) {
    try {
      // Written as it's built; a failure removes the folder, and nothing is saved
      const file = await writeZip(root, folder, makeZip(entries(org, g, source, say, finish)));
      const name = named();
      say("Saving…");
      save(file, name);
      clearAfterHandOff(root);
      return { name, manifest: done!, builtOn: "disk" };
    } catch (e) {
      await release(root);
      // The browser's storage refused part way (full, or private mode): start again in memory
      say(`Couldn't build it on this device's storage (${e instanceof Error ? e.message : String(e)}); starting again in memory…`);
      done = undefined;
    }
  }

  // In memory: warn first when it's large, then hold the whole zip until it's saved
  const warning = memoryWarning(g.expected);
  const why = folder ? ` There's room for about ${size(Math.max(0, room))} on this device for it.` : "";
  if (warning && !(await confirm(warning + why))) throw new ExportCancelled();
  const blob = await new Response(makeZip(entries(org, g, source, say, finish))).blob();
  const name = named();
  say("Saving…");
  save(blob, name);
  return { name, manifest: done!, builtOn: "memory" };
}
