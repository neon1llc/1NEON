// apps/web/src/pages/Documents.tsx - Documents hub: every file in the organization, filed by layer
// and project, with one place to upload from a phone or a browser.


import { fileState, priceCheckDue, todayIn, type DocumentRecord, type Layer } from "@1neon/domain";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { DropZone, FileList } from "../components/Files.tsx";
import { gate, Stale } from "../components/Reads.tsx";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { LayerBadge, LAYERS, layerName } from "../components/ui.tsx";
import { NEW_TAB } from "../lib/api.ts";
import { read } from "../lib/reads.ts";


// What the hub reads: the finished uploads, and project names to show beside them
interface DocsResponse {
  docs: DocumentRecord[];
  projects: { id: string; key: string; name: string; archived?: boolean }[];
  // Every issued proposal revision, newest first (older APIs don't send it)
  proposals?: { id: string; projectId: string; key: string; title: string; rev: number; status: string; issuedAt: string; issuerName?: string; note: string; checkBy: string; decided: string[] }[];
}


/** Upload with a project and layer chosen up front; browse by layer below */
export function Documents() {
  const { org } = useOrg();
  useTopBar(<span>{org.name} · Files</span>, [org.name]);
  // While any file is still being received or checked, ask again on a backoff (3s, growing to 30s) so a
  // file turns ready without a reload; it stops once every file has settled (AUTH-P02). The download
  // gate stays on the server: polling only shows the state it already decided
  const polls = useRef(0);
  const q = useQuery({
    queryKey: ["project", org.id, "docs"],
    queryFn: () => read<DocsResponse>(`/t/${org.id}/docs`, { docs: "array", projects: "array" }),
    refetchInterval: (query) => {
      const pending = (query.state.data?.docs ?? []).some((d) => fileState(d) === "checking" || fileState(d) === "receiving");
      if (!pending) { polls.current = 0; return false; }
      return Math.min(30_000, 3_000 * 1.5 ** polls.current++);
    },
    refetchIntervalInBackground: false,
  });
  const checking = (q.data?.docs ?? []).filter((d) => fileState(d) === "checking").length;
  // Where the next upload is filed, and which layer the list shows
  const [projectId, setProjectId] = useState("");
  const [layer, setLayer] = useState<Layer>("needs");
  const [show, setShow] = useState<Layer | "all">("all");
  const docs = q.data?.docs ?? [];
  const projectName = (id?: string) => (id ? q.data?.projects.find((p) => p.id === id)?.key : "General");
  // Counts only once the list has answered; a zero while it loads or fails would be a false claim
  const count = (n: number) => (q.data ? <span className="muted">{n}</span> : null);
  return (
    <>
      <h1 className="page-title">Files</h1>
      <p className="lead">Private to {org.name}. Every file is checked for viruses before anyone can download it.</p>
      {/* Where uploads go, as one sentence, then the drop area */}
      <div className="file-target">
        <span>File new uploads under</span>
        <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">the whole organization</option>
          {/* Archived projects keep their files for browsing but take no new uploads (the API refuses
              them too), so they're shown and disabled rather than offered (AUTH-P05) */}
          {q.data?.projects.map((p) => <option key={p.id} value={p.id} disabled={p.archived}>{p.key} · {p.name}{p.archived ? " (archived)" : ""}</option>)}
        </select>
        <span>in</span>
        <select aria-label="Layer" value={layer} onChange={(e) => setLayer(e.target.value as Layer)}>
          {LAYERS.map((l) => <option key={l} value={l}>{layerName(l)}</option>)}
        </select>
      </div>
      <DropZone target={{ layer, projectId: projectId || undefined }}>
        <span className="muted small">Files a project asks for can also be sent from its Needs tab.</span>
      </DropZone>
      {/* Filter by layer, with counts */}
      <div className="chips" role="group" aria-label="Show files from">
        <button className={`chip${show === "all" ? " on" : ""}`} aria-pressed={show === "all"} onClick={() => setShow("all")}>All {count(docs.length)}</button>
        {LAYERS.map((l) => (
          <button key={l} className={`chip${show === l ? " on" : ""}`} aria-pressed={show === l} onClick={() => setShow(l)}>
            <LayerBadge layer={l} /> {layerName(l)} {count(docs.filter((d) => d.layer === l).length)}
          </button>
        ))}
      </div>
      <Stale reads={[q]} />
      {/* Files still being checked say so, with a way to look again now */}
      {checking > 0 && (
        <p className="small muted" role="status">
          {checking} {checking === 1 ? "file is" : "files are"} still being checked for viruses; {checking === 1 ? "it opens" : "they open"} when the check finishes.{" "}
          <button type="button" className="linkish" onClick={() => { polls.current = 0; void q.refetch(); }}>Check again</button>
        </p>
      )}
      {/* Proposals: each issued revision, what was decided on it, and the markups filed with it */}
      {(q.data?.proposals?.length ?? 0) > 0 && (show === "all" || show === "needs") && (
        <section className="kind-group" aria-labelledby="files-proposals">
          <h2 className="section-h" id="files-proposals">Proposals <small>{q.data!.proposals!.length}</small></h2>
          <div className="rows">
            {q.data!.proposals!.map((r) => {
              const stale = !r.decided.length && r.status === "issued" && priceCheckDue(r, todayIn(org.timeZone));
              const markups = docs.filter((d) => d.itemId === r.id);
              return (
                <div className={`revision${r.status !== "issued" || stale ? " faded" : ""}`} key={r.id}>
                  <div>
                    <Link to={`/o/${org.slug}/projects/${r.key}/proposal?r=${r.rev}`} {...NEW_TAB}><b>{r.title}</b></Link>
                    <span className="small muted"> · {r.key} · issued {new Date(r.issuedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{r.issuerName ? ` by ${r.issuerName}` : ""}</span>
                    <div className="small">
                      {r.decided.length ? <span className="tag client">approved {r.decided.join(", ")}</span> : r.status === "superseded" ? <span className="tag">replaced by a later revision</span> : stale ? <span className="tag warn">prices may have changed</span> : <span className="tag">waiting on a decision</span>}
                      {r.note && <span className="muted"> {r.note}</span>}
                    </div>
                    {markups.length > 0 && <FileList docs={markups} empty="" />}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {gate([q]) ?? <FileList docs={show === "all" ? docs : docs.filter((d) => d.layer === show)} projectName={projectName} empty="No files here yet." />}
    </>
  );
}
