// apps/web/src/pages/Projects.tsx - Projects hub: every project as a sortable, filterable list, or on a
// timeline from start to target date. The list and timeline views follow Kaneo and Plane.


import { isClosed, type Layer, type Project } from "@1neon/domain";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { gate, Stale } from "../components/Reads.tsx";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { dateLabel, daysSince, Empty, Health, LayerBadge, LAYERS, layerName } from "../components/ui.tsx";
import { useProjects } from "../lib/hooks.ts";
import { slide } from "../lib/motion.ts";
import { prefs } from "../lib/prefs.ts";


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
const read = (k: string, d: string) => prefs.get(k, d);
const write = (k: string, v: string) => prefs.set(k, v);


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
  // Loading, or failed with nothing to show: no empty list and no "No projects yet" until it answers
  const wait = gate([projects]);
  return (
    <>
      {/* Title, the list or timeline switch, and New project for editors */}
      <div className="page-head">
        <h1 className="page-title">Projects</h1>
        {/* Two plain toggle buttons: Tab reaches each, Enter or Space picks it, and the pressed one is announced */}
        <div className="switch" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "list"} onClick={() => pick("list")}>List</button>
          <button type="button" aria-pressed={view === "timeline"} onClick={() => pick("timeline")}>Timeline</button>
        </div>
        {canWrite && <Link className="btn btn-primary" data-tour="new-project" to={`/o/${summary.slug}/projects/new`}>New project</Link>}
      </div>
      {/* Search, layer filter, sort, and archived */}
      <div className="filters">
        <input type="search" aria-label="Search projects" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" role="group" aria-label="Layer">
          <button className={`chip${layer === "all" ? " on" : ""}`} aria-pressed={layer === "all"} onClick={() => setLayer("all")}>All</button>
          {LAYERS.map((l) => <button key={l} className={`chip${layer === l ? " on" : ""}`} aria-pressed={layer === l} aria-label={layerName(l)} onClick={() => setLayer(l)} title={layerName(l)}><LayerBadge layer={l} /> <span className="hide-sm">{layerName(l)}</span></button>)}
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
      <Stale reads={[projects]} />
      {wait}
      {!wait && list.length === 0 && (
        <Empty text={q || layer !== "all" ? "No project matches." : "No projects yet."} action={canWrite && !q && layer === "all" && <Link className="btn btn-primary" to={`/o/${summary.slug}/projects/new`}>Start the first one</Link>} />
      )}
      {wait ? null : view === "list" ? (
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
                <span role="cell" className="small muted">{p.targetDate ? dateLabel(p.targetDate) : "–"}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <Timeline projects={list} slug={summary.slug} stageOf={(p) => { const st = stage.get(p.stageId); return { name: st?.name ?? "", layer: st?.layer ?? "needs", last: isClosed(org.stages, p.stageId) }; }} />
      )}
    </>
  );
}


/**
 * Projects as bars from when they started to their target date. A week grid with dated ticks (months
 * when the span is long), today as a dashed line, time still ahead lighter, each target as a
 * diamond, and time past a target in red. Each row says its stage and how the date stands, and a legend explains the colors
 */
function Timeline({ projects, slug, stageOf }: { projects: Project[]; slug: string; stageOf: (p: Project) => { name: string; layer: Layer; last: boolean } }) {
  const day = 86_400_000;
  const today = new Date(new Date().toDateString()).getTime();
  // Projects without a target date run to today (at least two weeks), faded at the end
  const spans = projects.map((p) => {
    const start = new Date(new Date(p.createdAt).toDateString()).getTime();
    const target = p.targetDate ? Date.parse(`${p.targetDate}T00:00`) : undefined;
    const end = target ?? Math.max(today, start + 14 * day);
    return { p, start, end, target, stage: stageOf(p) };
  });
  if (!spans.length) return null;
  const min = Math.min(...spans.map((s) => s.start), today) - 3 * day;
  const max = Math.max(...spans.map((s) => s.end), today) + 7 * day;
  const pct = (t: number) => ((t - min) / (max - min)) * 100;
  // Ticks: every Monday with its date while the span is under about four months, else each month
  const weekly = max - min <= 120 * day;
  const ticks: { at: number; label: string }[] = [];
  if (weekly) {
    const d = new Date(min);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    for (; d.getTime() < max; d.setDate(d.getDate() + 7)) ticks.push({ at: d.getTime(), label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
  } else {
    for (let d = new Date(new Date(min).getFullYear(), new Date(min).getMonth() + 1, 1); d.getTime() < max; d.setMonth(d.getMonth() + 1)) ticks.push({ at: d.getTime(), label: d.toLocaleString(undefined, { month: "short" }) });
  }
  const short = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  // How a project's date stands, in words: days left, days late, or no date yet
  const standing = (target: number | undefined, last: boolean) => {
    if (target === undefined) return "no target date";
    const n = Math.round((target - today) / day);
    if (last) return `target ${short(target)}`;
    return n > 0 ? `${n}d left, target ${short(target)}` : n === 0 ? "due today" : `${-n}d past target`;
  };
  // The grid lines every row draws behind its bar
  const grid = ticks.map((t) => <i key={t.at} className="tl-tick" style={{ left: `${pct(t.at)}%` }} aria-hidden="true" />);
  return (
    <div className="timeline slide-stage" data-tour="project-list">
      {/* What the colors and marks mean */}
      <div className="tl-legend small muted" aria-hidden="true">
        {LAYERS.map((l) => <span key={l}><i className={`tl-key l-${l}`} />{layerName(l)}</span>)}
        <span><i className="tl-key diamond" />Target</span>
        <span><i className="tl-key late" />Past target</span>
        <span><i className="tl-key now" />Today</span>
      </div>
      {/* Date ticks and today, lined up with the bars below */}
      <div className="tl-row head" aria-hidden="true">
        <span className="small muted">Started → target</span>
        <span className="tl-track">
          {ticks.map((m) => <span key={m.at} className="tl-month" style={{ left: `${pct(m.at)}%` }}>{m.label}</span>)}
          <span className="tl-month today" style={{ left: `${pct(today)}%` }}>Today</span>
        </span>
      </div>
      <div className="tl-rows">
        {spans.map(({ p, start, end, target, stage }) => {
          const late = target !== undefined && target < today && !stage.last;
          const words = `${p.name}: started ${short(start)}, ${stage.name}, ${standing(target, stage.last)}`;
          return (
            <Link key={p.id} className="tl-row" to={`/o/${slug}/projects/${p.key}`} aria-label={words}>
              <span className="tl-name">
                <span><span className="s">{p.key}</span> {p.name}</span>
                <span className={`tl-sub${late ? " late" : ""}`}>{stage.name} · {standing(target, stage.last)}</span>
              </span>
              <span className="tl-track" title={words}>
                {grid}
                <i className="tl-now" style={{ left: `${pct(today)}%` }} aria-hidden="true" />
                <span className={`tl-bar l-${stage.layer}${target === undefined ? " open" : ""}`} style={{ left: `${pct(start)}%`, width: `${Math.max(1.5, pct(end) - pct(start))}%` }}>
                  <span className="tl-date">{short(start)}</span>
                </span>
                {/* Time still ahead shows lighter, so the solid part is how far along the calendar it is */}
                {target !== undefined && today < end && <span className="tl-ahead" style={{ left: `${pct(Math.max(start, today))}%`, width: `${pct(end) - pct(Math.max(start, today))}%` }} aria-hidden="true" />}
                {/* Time past the target, from the target to today */}
                {late && <span className="tl-late" style={{ left: `${pct(target)}%`, width: `${pct(today) - pct(target)}%` }} aria-hidden="true" />}
                {target !== undefined && <i className="tl-target" style={{ left: `${pct(target)}%` }} aria-hidden="true" />}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
