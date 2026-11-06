// apps/web/src/pages/Documents.tsx - Documents hub: every file in the organization, filed by layer
// and project, with one place to upload from a phone or a browser.


import type { DocumentRecord, Layer } from "@1neon/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DropZone, FileList } from "../components/Files.tsx";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { LayerBadge, LAYERS, layerName } from "../components/ui.tsx";
import { api } from "../lib/api.ts";


// What the hub reads: the finished uploads, and project names to show beside them
interface DocsResponse {
  docs: DocumentRecord[];
  projects: { id: string; key: string; name: string }[];
}


/** Upload with a project and layer chosen up front; browse by layer below */
export function Documents() {
  const { org } = useOrg();
  useTopBar(<span>{org.name} · Documents</span>, [org.name]);
  const q = useQuery({ queryKey: ["project", org.id, "docs"], queryFn: () => api<DocsResponse>(`/t/${org.id}/docs`) });
  // Where the next upload is filed, and which layer the list shows
  const [projectId, setProjectId] = useState("");
  const [layer, setLayer] = useState<Layer>("needs");
  const [show, setShow] = useState<Layer | "all">("all");
  const docs = q.data?.docs ?? [];
  const projectName = (id?: string) => (id ? q.data?.projects.find((p) => p.id === id)?.key : "General");
  return (
    <>
      <h1 className="page-title">Documents</h1>
      <p className="lead">Files for {org.name}, kept in its own private folder and filed by layer. Every upload is scanned for malware before anyone can download it.</p>
      {/* Where uploads go, then the drop area */}
      <div className="file-target">
        <label>Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">General, not one project</option>
            {q.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
          </select>
        </label>
        <label>Layer
          <select value={layer} onChange={(e) => setLayer(e.target.value as Layer)}>
            {LAYERS.map((l) => <option key={l} value={l}>{layerName(l)}</option>)}
          </select>
        </label>
      </div>
      <DropZone target={{ layer, projectId: projectId || undefined }}>
        <span className="muted small">Filed under {layerName(layer)}{projectId ? ` in ${projectName(projectId)}` : ", for the whole organization"}. Files a project asks for can also be sent from its Needs tab.</span>
      </DropZone>
      {/* Filter by layer, with counts */}
      <div className="chips" role="group" aria-label="Show files from">
        <button className={`chip${show === "all" ? " on" : ""}`} onClick={() => setShow("all")}>All <span className="muted">{docs.length}</span></button>
        {LAYERS.map((l) => (
          <button key={l} className={`chip${show === l ? " on" : ""}`} onClick={() => setShow(l)}>
            <LayerBadge layer={l} /> {layerName(l)} <span className="muted">{docs.filter((d) => d.layer === l).length}</span>
          </button>
        ))}
      </div>
      {q.isPending ? <p className="muted" aria-busy="true">Loading…</p> : <FileList docs={show === "all" ? docs : docs.filter((d) => d.layer === show)} projectName={projectName} empty="No files here yet." />}
    </>
  );
}
