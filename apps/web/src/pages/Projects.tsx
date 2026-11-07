// apps/web/src/pages/Projects.tsx - Projects hub: every project in the organization, with filters.


import { useState } from "react";
import { Link } from "react-router";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { daysSince, Empty, Health, LayerBadge } from "../components/ui.tsx";
import { useProjects } from "../lib/hooks.ts";


// A searchable list of the organization's projects, live or archived
export function Projects() {
  const { org, summary, canWrite } = useOrg();
  const projects = useProjects(org.id);
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  useTopBar(<span>{org.name} · Projects</span>, [org.name]);
  // Stage lookup for each row's layer and stage name
  const stage = new Map(org.stages.map((s) => [s.id, s]));
  // Filter by archive state and search, then order by stage, then key
  const list = (projects.data ?? [])
    .filter((p) => p.archived === archived)
    .filter((p) => (p.key + p.name + p.summary).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => org.stages.findIndex((s) => s.id === a.stageId) - org.stages.findIndex((s) => s.id === b.stageId) || a.key.localeCompare(b.key));
  return (
    <>
      {/* Title and the New project action for editors */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 className="page-title" style={{ marginRight: "auto" }}>Projects</h1>
        {canWrite && <Link className="btn btn-primary" data-tour="new-project" to={`/o/${summary.slug}/projects/new`}>New project</Link>}
      </div>
      {/* Search and the archived switch */}
      <div style={{ display: "flex", gap: 12, margin: "8px 0 16px", flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="Search projects" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} style={{ width: 16, minHeight: 0 }} /> Show archived
        </label>
      </div>
      {projects.isPending && <p className="muted" aria-busy="true">Loading…</p>}
      {projects.data && list.length === 0 && (
        <Empty text={q ? "No project matches that search." : "No projects yet."} action={canWrite && !q && <Link className="btn btn-primary" to={`/o/${summary.slug}/projects/new`}>Start the first one</Link>} />
      )}
      {/* One row per project: key and name, stage with its days, and health */}
      <div className="rows" data-tour="project-list">
        {list.map((p) => {
          const s = stage.get(p.stageId);
          return (
            <Link key={p.id} className="row" to={`/o/${summary.slug}/projects/${p.key}`}>
              <span>
                <span className="s">{p.key}</span>
                <span className="t" style={{ display: "block" }}>{p.name}</span>
                {p.summary && <span className="muted small">{p.summary}</span>}
              </span>
              <span className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {s && <LayerBadge layer={s.layer} />}
                {s?.name ?? p.stageId} <span className="muted">· {daysSince(p.stageEnteredAt)}d</span>
              </span>
              <Health value={p.health} />
            </Link>
          );
        })}
      </div>
    </>
  );
}
