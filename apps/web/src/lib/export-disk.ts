// apps/web/src/lib/export-disk.ts - Where a large export is built: the browser's private file storage
// for this site (OPFS), in one folder, "1neon-export", listed in the cookie notice. The folder only
// lives while it's needed: it's removed after the hand-off to Downloads (30 minutes at most, while the
// tab is open), when an export fails or is cancelled, and as a stale leftover when the next export
// starts or Settings opens. No api.ts import, so tests drive it with a fake folder.


/** The one folder the export writes in, as the cookie notice names it */
export const EXPORT_FOLDER = "1neon-export";

/** How long a finished zip stays after the hand-off: long enough for the browser to copy a large file
 * to Downloads. The cookie notice states this limit */
export const KEEP_MS = 30 * 60_000;

/** The parts of a folder handle the export uses (a real FileSystemDirectoryHandle, or a test's fake) */
export type Folder = Pick<FileSystemDirectoryHandle, "getDirectoryHandle" | "removeEntry" | "getFileHandle">;


// --- Opening and clearing ---------------------------------------------------------------------

/** This site's private file storage, or undefined where the browser can't write there as a stream
 * (older Safari and iOS, some private windows), which sends the export to memory instead */
export async function privateRoot(): Promise<Folder | undefined> {
  try {
    if (!navigator.storage?.getDirectory || typeof FileSystemFileHandle === "undefined" || !("createWritable" in FileSystemFileHandle.prototype)) return undefined;
    return await navigator.storage.getDirectory();
  } catch {
    return undefined;
  }
}

/** Remove the export folder and everything in it; nothing there is fine too */
export async function clearExports(root: Folder | undefined): Promise<void> {
  try {
    await root?.removeEntry(EXPORT_FOLDER, { recursive: true });
  } catch {
    // Already gone, or the browser refused: either way there's nothing more to do
  }
}

/** True from opening a fresh folder until its zip is written or it's released, so a stale clear (on
 * opening Settings mid-export) never removes an export in progress */
let building = false;
/** Counts exports started in this tab, so an earlier export's timer never removes a later one's zip */
let generation = 0;

/** A fresh, empty export folder (any leftover cleared first), or undefined if the browser refuses */
export async function exportFolder(root: Folder): Promise<Folder | undefined> {
  await clearExports(root);
  try {
    const folder = await root.getDirectoryHandle(EXPORT_FOLDER, { create: true });
    building = true;
    generation++;
    return folder;
  } catch {
    return undefined;
  }
}

/** Done with the folder without a hand-off (failed, cancelled, or built in memory): remove it now */
export async function release(root: Folder): Promise<void> {
  building = false;
  await clearExports(root);
}


// --- Writing and the hand-off -----------------------------------------------------------------

/** When this tab last handed a finished zip to Downloads; a stale clear leaves that one to its timer */
let handedOffAt = 0;

/**
 * Write the zip as it's built, and return it as a file backed by disk (not memory). On any failure the
 * folder is removed before the error goes on, so nothing half-written stays behind
 */
export async function writeZip(root: Folder, folder: Folder, zip: ReadableStream<Uint8Array>): Promise<File> {
  try {
    const handle = await folder.getFileHandle(`export-${Date.now()}.zip`, { create: true });
    // The file only takes its content when the last byte is in and the stream closes
    await zip.pipeTo(await handle.createWritable());
    const file = await handle.getFile();
    building = false;
    return file;
  } catch (e) {
    await release(root);
    throw e;
  }
}

/** After the hand-off: remove the folder once the browser has had time to copy the file */
export function clearAfterHandOff(root: Folder, wait: (run: () => void, ms: number) => unknown = setTimeout): void {
  handedOffAt = Date.now();
  const mine = generation;
  wait(() => {
    if (mine === generation && !building) void clearExports(root);
  }, KEEP_MS);
}

/** On opening Settings: remove a leftover from an earlier export (a closed tab, a crash), unless this
 * tab is building one, or handed one off within KEEP_MS and its own timer will remove it */
export async function clearStaleExports(root?: Folder): Promise<void> {
  if (building || Date.now() - handedOffAt < KEEP_MS) return;
  await clearExports(root ?? (await privateRoot()));
}
