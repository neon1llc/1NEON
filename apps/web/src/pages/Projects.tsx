// apps/web/src/pages/Projects.tsx - Projects hub: every project as a sortable, filterable list, or on a
// timeline from start to target date. The list and timeline views follow Kaneo and Plane.


import type { Layer, Project } from "@1neon/domain";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { daysSince, Empty, Health, LayerBadge, LAYERS, layerName } from "../components/ui.tsx";
import { useProjects } from "../lib/hooks.ts";
import { slide } from "../lib/motion.ts";


// How the list can be ordered, in plain words
const SORTS = {
  stage: "Stage",
  target: "Target date",
  updated: "Recently changed",
  name: "Name",
} as const;
type Sort = keyof typeof SORTS;


// The person's last view and sort, kept in this browser only
const VIEW_KEY = "1neon.projects.view";
const read = (k: string, d: string) => {
  try { return localStorage.getItem(k) ?? d; } catch { return d; }
};
const write = (k: string, v: string) => {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
};


// Every project in the organization, as a list or a timeline
export function Projects() {
  const { org, summary, canWrite } = useOrg();
  const projects = useProjects(org.id);
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [layer, setLayer] = useState<Layer | "all">("all");
  const [sort, setSort] = useState<Sort>(() => read(`${VIEW_KEY}.sort`, "stage") as Sort);
  const [view, setView] = useState<"list" | "timeline">(() => read(VIEW_KEY, "list") as "list" | "timeline");
  useTopBar(<span>{org.name} · Projects</span>, [org.name]);
  // Stage lookup for each row's layer and stage name, and each stage's place on the board
  const stage = new Map(org.stages.map((s, i) => [s.id, { ...s, at: i }]));

  // Filter by archive state, layer, and search, then sort
  const list = useMemo(() => (projects.data ?? [])
    .filter((p) => p.archived === archived)
    .filter((p) => layer === "all" || stage.get(p.stageId)?.layer === layer)
    .filter((p) => (p.key + p.name + p.summary).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sort === "target") return (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999");
      if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
      if (sort === "name") return a.name.localeCompare(b.name);
      return (stage.get(a.stageId)?.at ?? 0) - (stage.get(b.stageId)?.at ?? 0) || a.key.localeCompare(b.key);
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [projects.data, archived, layer, q, sort, org.stages]);

  // List sits left of Timeline, so switching pans that way
  const pick = (v: "list" | "timeline") => { if (v === view) return; write(VIEW_KEY, v); slide(v === "timeline" ? "next" : "back", () => setView(v)); };
  const order = (s: Sort) => { setSort(s); write(`${VIEW_KEY}.sort`, s); };
  return (
    <>
      {/* Title, the list or timeline switch, and New project for editors */}
      <div className="page-head">
        <h1 className="page-title">Projects</h1>
        <div className="switch" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "list"} onClick={() => pick("list")}>List</button>
          <button role="tab" aria-selected={view === "timeline"} onClick={() => pick("timeline")}>Timeline</button>
        </div>
        {canWrite && <Link className="btn btn-primary" data-tour="new-project" to={`/o/${summary.slug}/projects/new`}>New project</Link>}
      </div>
      {/* Search, layer filter, sort, and archived */}
      <div className="filters">
        <input type="search" aria-label="Search projects" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" role="group" aria-label="Layer">
          <button className={`chip${layer === "all" ? " on" : ""}`} onClick={() => setLayer("all")}>All</button>
          {LAYERS.map((l) => <button key={l} className={`chip${layer === l ? " on" : ""}`} onClick={() => setLayer(l)} title={layerName(l)}><LayerBadge layer={l} /> <span className="hide-sm">{layerName(l)}</span></button>)}
        </div>
        {view === "list" && (
          <select aria-label="Sort by" value={sort} onChange={(e) => order(e.target.value as Sort)}>
            {(Object.keys(SORTS) as Sort[]).map((s) => <option key={s} value={s}>Sort: {SORTS[s]}</option>)}
          </select>
        )}
        <label className="small check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived
        </label>
      </div>
      {projects.isPending && <p className="muted" aria-busy="true">Loading…</p>}
      {projects.data && list.length === 0 && (
        <Empty text={q || layer !== "all" ? "No project matches." : "No projects yet."} action={canWrite && !q && layer === "all" && <Link className="btn btn-primary" to={`/o/${summary.slug}/projects/new`}>Start the first one</Link>} />
      )}
      {view === "list" ? (
        // One row per project: key and name, stage with its days, health, and target date
        <div className="ptable slide-stage" data-tour="project-list" role="table" aria-label="Projects">
          {list.length > 0 && (
            <div className="ptr head" role="row">
              <span role="columnheader">Project</span><span role="columnheader">Stage</span><span role="columnheader">Health</span><span role="columnheader">Target</span>
            </div>
          )}
          {list.map((p) => {
            const s = stage.get(p.stageId);
            return (
              <Link key={p.id} className="ptr" role="row" to={`/o/${summary.slug}/projects/${p.key}`}>
                <span role="cell"><span className="s">{p.key}</span><span className="t">{p.name}</span></span>
                <span role="cell" className="small stage-cell">{s && <LayerBadge layer={s.layer} />}{s?.name ?? p.stageId} <span className="muted">{daysSince(p.stageEnteredAt)}d</span></span>
                <span role="cell"><Health value={p.health} /></span>
                <span role="cell" className="small muted">{p.targetDate ?? "–"}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <Timeline projects={list} slug={summary.slug} layerOf={(p) => stage.get(p.stageId)?.layer ?? "needs"} />
      )}
    </>
  );
}


/** Projects as bars from when they started to their target date, with today marked */
function Timeline({ projects, slug, layerOf }: { projects: Project[]; slug: string; layerOf: (p: Project) => Layer }) {
  const day = 86_400_000;
  const today = Date.now();
  // Projects without a target date show a short open-ended bar to today
  const spans = projects.map((p) => {
    const start = Date.parse(p.createdAt);
    const end = p.targetDate ? Date.parse(p.targetDate) : Math.max(today, start + 14 * day);
    return { p, start, end, open: !p.targetDate };
  });
  if (!spans.length) return null;
  const min = Math.min(...spans.map((s) => s.start), today) - 3 * day;
  const max = Math.max(...spans.map((s) => s.end), today) + 7 * day;
  const pct = (t: number) => ((t - min) / (max - min)) * 100;
  // Month ticks along the top
  const months: { at: number; label: string }[] = [];
  for (let d = new Date(new Date(min).getFullYear(), new Date(min).getMonth() + 1, 1); d.getTime() < max; d.setMonth(d.getMonth() + 1)) {
    months.push({ at: d.getTime(), label: d.toLocaleString(undefined, { month: "short" }) });
  }
  return (
    <div className="timeline slide-stage" data-tour="project-list">
      {/* Month ticks and today, lined up with the bars below */}
      <div className="tl-row head" aria-hidden="true">
        <span />
        <span className="tl-track">
          {months.map((m) => <span key={m.at} className="tl-month" style={{ left: `${pct(m.at)}%` }}>{m.label}</span>)}
          <span className="tl-month today" style={{ left: `${pct(today)}%` }}>Today</span>
        </span>
      </div>
      <div className="tl-rows">
        {spans.map(({ p, start, end, open }) => (
          <Link key={p.id} className="tl-row" to={`/o/${slug}/projects/${p.key}`}>
            <span className="tl-name"><span className="s">{p.key}</span> {p.name}</span>
            <span className="tl-track">
              <i className="tl-now" style={{ left: `${pct(today)}%` }} aria-hidden="true" />
              <span className={`tl-bar l-${layerOf(p)}${open ? " open" : ""}`} style={{ left: `${pct(start)}%`, width: `${Math.max(1.5, pct(end) - pct(start))}%` }} title={`${p.name}: ${new Date(start).toLocaleDateString()} to ${open ? "no target date" : p.targetDate}`} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
