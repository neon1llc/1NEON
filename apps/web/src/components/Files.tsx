// apps/web/src/components/Files.tsx - Uploading, listing, and downloading files: from a phone's
// camera or files, a browser's file picker, or a drop onto the page.


import type { DocumentRecord, Layer } from "@1neon/domain";
import { useRef, useState, type ReactNode } from "react";
import { api, HttpError } from "../lib/api.ts";
import { problem, useRefresh } from "../lib/hooks.ts";
import { useOrg, useSession } from "./Shell.tsx";
import { ago, LayerBadge, useToast } from "./ui.tsx";


// Where an upload is filed: its layer, and optionally a project and the "file needed" item it answers
export interface FileTarget {
  layer: Layer;
  projectId?: string;
  itemId?: string;
}


/** Upload each file: make its record, send the bytes straight to storage, then mark it done */
export async function uploadFiles(tid: string, files: File[], target: FileTarget) {
  for (const f of files) {
    const { doc, upload } = await api<{ doc: DocumentRecord; upload: string }>(`/t/${tid}/docs`, {
      method: "POST",
      body: { name: f.name, contentType: f.type || "application/octet-stream", size: f.size, ...target },
    });
    // A blocked or dropped connection throws rather than returning a status; both get a plain message
    const r = await fetch(upload, { method: "PUT", headers: { "content-type": f.type || "application/octet-stream" }, body: f }).catch(() => undefined);
    if (!r?.ok) throw new Error(`Couldn't send ${f.name} to storage. Check your connection and try again.`);
    await api(`/t/${tid}/docs/${doc.id}/done${doc.projectId ? `?p=${doc.projectId}` : ""}`, { method: "POST" });
  }
}


/** Runs uploads for any control, reports the result, and refreshes the page's data */
export function useUpload(target: FileTarget, onDone?: () => void) {
  const { org } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [busy, setBusy] = useState(false);
  const run = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      await uploadFiles(org.id, files, target);
      toast(files.length === 1 ? `Uploaded ${files[0]!.name}` : `Uploaded ${files.length} files`);
      onDone?.();
    } catch (e) {
      toast(e instanceof HttpError ? problem(e) : (e as Error).message);
    }
    refresh();
    setBusy(false);
  };
  return { busy, run };
}


/** A button that opens the file picker (camera, photos, or files on a phone) and uploads what's chosen */
export function UploadButton({ target, label = "Upload files", className = "btn btn-ghost", onDone }: { target: FileTarget; label?: string; className?: string; onDone?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useUpload(target, onDone);
  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : label}</button>
      <input ref={input} type="file" multiple hidden onChange={(e) => { void run([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </>
  );
}


/** A drop area for desktop browsers that also opens the picker when tapped */
export function DropZone({ target, children }: { target: FileTarget; children?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { busy, run } = useUpload(target);
  return (
    <div
      className={`drop${over ? " over" : ""}`}
      role="button"
      tabIndex={0}
      aria-busy={busy}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void run([...e.dataTransfer.files]); }}
    >
      <b>{busy ? "Uploading…" : "Drop files here, or tap to choose"}</b>
      {children}
      <input ref={input} type="file" multiple hidden onChange={(e) => { void run([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </div>
  );
}


// File sizes in the units people expect
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);


/** Files as rows: name, where it's filed, when, and Download; uploaders and admins may remove */
export function FileList({ docs, projectName, empty = "No files yet." }: { docs: DocumentRecord[]; projectName?: (id?: string) => string | undefined; empty?: string }) {
  const { org, canAdmin } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const list = docs.filter((d) => d.uploaded);
  if (!list.length) return <p className="muted small">{empty}</p>;
  const q = (d: DocumentRecord) => (d.projectId ? `?p=${d.projectId}` : "");
  // Downloads wait for the malware scan; a pending scan says so instead of failing quietly
  const download = async (d: DocumentRecord) => {
    try {
      const { url } = await api<{ url: string }>(`/t/${org.id}/docs/${d.id}/download${q(d)}`);
      location.href = url;
    } catch (e) {
      toast(problem(e));
    }
  };
  // Removing asks first; admins need strong sign-in for others' files
  const remove = async (d: DocumentRecord) => {
    if (!confirm(`Remove ${d.name}?`)) return;
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
            <span className="t">{d.name}</span>
            <span className="s">{[projectName?.(d.projectId), size(d.size), ago(d.createdAt), d.scan === "infected" ? "flagged by scan" : ""].filter(Boolean).join(" · ")}</span>
          </div>
          <span className="acts">
            <button className="chip" onClick={() => void download(d)} disabled={d.scan === "infected"}>Download</button>
            {(d.updatedBy === me.user.id || canAdmin) && <button className="chip" onClick={() => void remove(d)} aria-label={`Remove ${d.name}`}>Remove</button>}
          </span>
        </div>
      ))}
    </div>
  );
}
