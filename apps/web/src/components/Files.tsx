// apps/web/src/components/Files.tsx - Uploading, listing, and downloading files: from a phone's
// camera or files, a browser's file picker, or a drop onto the page.


import { fileState, VIEWABLE, type DocumentRecord, type FileState, type Layer } from "@1neon/domain";
import { useRef, useState, type ReactNode } from "react";
import { api, HttpError, openable, send } from "../lib/api.ts";
import { problem, useRefresh } from "../lib/hooks.ts";
import { useOrg, useSession } from "./Shell.tsx";
import { ago, LayerBadge, useAsk, useToast } from "./ui.tsx";


// Where an upload is filed: its layer, and optionally a project and the "file needed" item it answers
export interface FileTarget {
  layer: Layer;
  projectId?: string;
  itemId?: string;
}


/**
 * One file's way through an upload (AX-04): its record once made, whether its bytes reached storage, and
 * how it ended. A retry picks up where each file stopped: a file whose bytes arrived only needs its
 * "done" report again, and a finished file is never sent twice
 */
export interface UploadJob {
  file: File;
  doc?: DocumentRecord;
  sent?: boolean;
  result?: DocumentRecord;
  error?: string;
}

// How long one file's bytes may take to reach storage: a minute, plus time for the size at a slow
// 32 KB/s, so a 100 MB file gets about an hour. A stall past it is cancelled and reported (AX-05)
export const transferDeadline = (bytes: number) => 60_000 + Math.ceil(bytes / 32_768) * 1000;

/** Upload each file: make its record, send the bytes straight to storage, then report it done. Every file
 * gets its own outcome; one failure doesn't stop the rest, and nothing already finished is repeated.
 * `signal` cancels what's still in flight (the server settles an abandoned record on its own) */
export async function uploadFiles(tid: string, jobs: UploadJob[], target: FileTarget, signal?: AbortSignal): Promise<UploadJob[]> {
  for (const job of jobs) {
    if (job.result || signal?.aborted) continue;
    const f = job.file;
    job.error = undefined;
    try {
      let upload: string | undefined;
      if (!job.doc || !job.sent) {
        const made = await api<{ doc: DocumentRecord; upload: string }>(`/t/${tid}/docs`, {
          method: "POST",
          body: { name: f.name, contentType: f.type || "application/octet-stream", size: f.size, ...target },
        });
        job.doc = made.doc;
        upload = made.upload;
        // The bytes, bounded by a deadline and the caller's Cancel. A blocked or dropped connection throws
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), transferDeadline(f.size));
        const cancel = () => stop.abort();
        signal?.addEventListener("abort", cancel);
        const r = await send(upload, { method: "PUT", headers: { "content-type": f.type || "application/octet-stream" }, body: f, signal: stop.signal }).catch(() => undefined);
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        if (!r?.ok) throw new Error(signal?.aborted ? "cancelled" : stop.signal.aborted ? "took too long to send" : "couldn't reach storage");
        job.sent = true;
      }
      // Report it done. If this reply is lost, a retry repeats only this step for the same record
      const after = await api<DocumentRecord>(`/t/${tid}/docs/${job.doc!.id}/done${job.doc!.projectId ? `?p=${job.doc!.projectId}` : ""}`, { method: "POST" });
      if (after.state === "failed" || after.state === "rejected") { job.result = after; job.error = fileProblem(after); continue; }
      job.result = after;
    } catch (e) {
      job.error = e instanceof HttpError ? problem(e) : (e as Error).message || "didn't upload";
    }
  }
  return jobs;
}


/** Why a file isn't available, in plain words */
export function fileProblem(d: DocumentRecord) {
  if (d.state === "rejected") return "the malware scan flagged it, so it can't be opened.";
  return { missing: "it never arrived. Upload it again.", size_mismatch: "it arrived incomplete. Upload it again.", scan_failed: "the malware scan couldn't finish. Upload it again.", scan_unsupported: "the malware scan can't read this kind of file (often a password-protected archive). Send it another way.", timeout: "the malware scan took too long. Upload it again." }[d.problem ?? "missing"];
}


/** Runs uploads for any control, reports the result, and refreshes the page's data. One batch at a time:
 * a second drop while one runs is refused at once (a ref, not just aria-busy). Files that didn't make it
 * stay listed with Retry and the batch can be cancelled (AX-04, AX-05) */
export function useUpload(target: FileTarget, onDone?: () => void) {
  const { org } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const stop = useRef<AbortController | null>(null);
  const [left, setLeft] = useState<UploadJob[]>([]);
  const go = async (jobs: UploadJob[]) => {
    if (!jobs.length) return;
    if (running.current) { toast("One upload at a time. Wait for this one to finish, then add more."); return; }
    running.current = true;
    setBusy(true);
    stop.current = new AbortController();
    await uploadFiles(org.id, jobs, target, stop.current.signal);
    const ok = jobs.filter((j) => j.result && !j.error);
    const bad = jobs.filter((j) => j.error);
    const checking = ok.filter((j) => fileState(j.result!) !== "ready").length;
    const what = (n: number) => (n === 1 ? "1 file" : `${n} files`);
    if (!bad.length) {
      const name = ok.length === 1 ? ok[0]!.file.name : what(ok.length);
      toast(checking ? `Uploaded ${name}. A quick malware check runs first; it opens once that's done.` : `Uploaded ${name}`);
      onDone?.();
    } else {
      toast(`${ok.length ? `${what(ok.length)} uploaded; ` : ""}${what(bad.length)} didn't: ${bad.map((j) => `${j.file.name} (${j.error})`).join(", ")}.`);
    }
    // Only unfinished files that can be tried again stay for Retry (a flagged file can't)
    setLeft(bad.filter((j) => !j.result));
    refresh();
    stop.current = null;
    running.current = false;
    setBusy(false);
  };
  const run = (files: File[]) => go(files.map((file) => ({ file })));
  const retry = () => go(left);
  const cancel = () => stop.current?.abort();
  return { busy, run, retry, cancel, left };
}


/** The status line under an upload control: Cancel while sending, Retry for what didn't make it */
function UploadStatus({ busy, left, retry, cancel }: Pick<ReturnType<typeof useUpload>, "busy" | "left" | "retry" | "cancel">) {
  if (busy) return <span className="small muted" role="status">Uploading… <button type="button" className="linkish" onClick={(e) => { e.stopPropagation(); cancel(); }}>Cancel</button></span>;
  if (!left.length) return null;
  return (
    <span className="small warn-text" role="status">
      {left.length === 1 ? `${left[0]!.file.name} didn't upload.` : `${left.length} files didn't upload.`}{" "}
      <button type="button" className="linkish" onClick={(e) => { e.stopPropagation(); void retry(); }}>Retry</button>
    </span>
  );
}


/** A button that opens the file picker (camera, photos, or files on a phone) and uploads what's chosen */
export function UploadButton({ target, label = "Upload files", className = "btn btn-ghost", onDone }: { target: FileTarget; label?: string; className?: string; onDone?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const up = useUpload(target, onDone);
  return (
    <>
      <button type="button" className={className} disabled={up.busy} onClick={() => input.current?.click()}>{up.busy ? "Uploading…" : label}</button>
      <UploadStatus {...up} />
      <input ref={input} type="file" multiple hidden onChange={(e) => { void up.run([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </>
  );
}


/** A drop area for desktop browsers that also opens the picker when tapped */
export function DropZone({ target, children }: { target: FileTarget; children?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const up = useUpload(target);
  const { busy, run } = up;
  return (
    <>
    <div
      data-tour="upload"
      className={`drop${over ? " over" : ""}`}
      role="button"
      tabIndex={0}
      aria-busy={busy}
      onClick={() => input.current?.click()}
      // Space activates without scrolling the page, as on a native button (AP-10)
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!busy) input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void run([...e.dataTransfer.files]); }}
    >
      <b>{busy ? "Uploading…" : matchMedia("(pointer: fine)").matches ? "Drop files here, or click to choose" : "Tap to choose files"}</b>
      {children}
      <input ref={input} type="file" multiple hidden onChange={(e) => { void run([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </div>
    {/* Outside the drop area, so its Cancel and Retry aren't buttons inside a button */}
    <UploadStatus {...up} />
    </>
  );
}


// A short note on each row for files that aren't plain ready ones
const STATE_NOTE: Record<FileState, string> = { receiving: "", checking: "malware check running", ready: "", rejected: "flagged by scan", failed: "upload failed" };


// File sizes in the units people expect
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);


/** Files as rows: the name opens it (in a tab when the browser can show it, otherwise it downloads),
 * then where it's filed, when, and Download; the uploader and admins may delete, after a check */
export function FileList({ docs, projectName, empty = "No files yet." }: { docs: DocumentRecord[]; projectName?: (id?: string) => string | undefined; empty?: string }) {
  const { org, canAdmin } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const ask = useAsk();
  // Ready files, plus ones still checking or that failed, so nobody wonders where an upload went
  const list = docs.filter((d) => fileState(d) !== "receiving");
  if (!list.length) return <p className="muted small">{empty}</p>;
  const q = (d: DocumentRecord) => (d.projectId ? `?p=${d.projectId}` : "");
  // Downloads wait for the malware scan; a pending scan says so instead of failing quietly
  const download = async (d: DocumentRecord) => {
    try {
      const { url } = await api<{ url: string }>(`/t/${org.id}/docs/${d.id}/download${q(d)}`);
      // In the demo the file comes from this browser, so it's saved under its own name from a local link
      const a = Object.assign(document.createElement("a"), { href: await openable(url), download: d.name });
      a.click();
    } catch (e) {
      toast(problem(e));
    }
  };
  // Open in a new tab: PDFs, pictures, and plain text show there; anything else downloads instead.
  // The tab opens on the click itself (a tab opened after waiting would be blocked), then gets the link
  const view = async (d: DocumentRecord) => {
    if (!VIEWABLE.has(d.contentType)) return void download(d);
    const tab = window.open("", "_blank");
    try {
      const { url } = await api<{ url: string }>(`/t/${org.id}/docs/${d.id}/download${q(d) ? `${q(d)}&` : "?"}view=1`);
      if (tab) { tab.opener = null; tab.location.href = await openable(url); } else location.href = await openable(url);
    } catch (e) {
      tab?.close();
      toast(problem(e));
    }
  };
  // Deleting asks first; admins need strong sign-in for others' files
  const remove = async (d: DocumentRecord) => {
    if (!(await ask({ title: `Delete ${d.name}?`, body: "It's deleted for everyone in this organization and can't be downloaded again. The activity log keeps a note that it was deleted.", yes: "Delete", danger: true }))) return;
    try {
      await api(`/t/${org.id}/docs/${d.id}${q(d)}`, { method: "DELETE" });
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };
  return (
    <div className="files">
      {list.map((d) => (
        <div className="file" key={d.id}>
          <LayerBadge layer={d.layer} />
          <div className="meta">
            {/* A ready file's name opens it, like other titles; others are plain text until they're ready */}
            {fileState(d) === "ready" ? <button type="button" className="t item-open" onClick={() => void view(d)} title={VIEWABLE.has(d.contentType) ? "Open in a new tab" : "Download"}>{d.name}</button> : <span className="t">{d.name}</span>}
            <span className="s">{[projectName?.(d.projectId), size(d.size), ago(d.createdAt), STATE_NOTE[fileState(d)]].filter(Boolean).join(" · ")}</span>
            {(d.state === "failed" || d.state === "rejected") && <span className="s warn-text">Not available: {fileProblem(d)}</span>}
          </div>
          <span className="acts">
            <button className="chip" onClick={() => void download(d)} disabled={fileState(d) !== "ready"}>{fileState(d) === "checking" ? "Checking…" : "Download"}</button>
            {(d.updatedBy === me.user.id || canAdmin) && <button className="chip" onClick={() => void remove(d)} aria-label={`Delete ${d.name}`}>Delete</button>}
          </span>
        </div>
      ))}
    </div>
  );
}
