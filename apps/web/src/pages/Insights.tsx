// apps/web/src/pages/Insights.tsx - Insights: charts made by default from the organization's own data.
// Headline numbers, work finished per week, where projects sit across the four layers, and
// their health. Recent activity lives on Home and in each project's history, so it isn't charted
// twice. Drawn as plain SVG and CSS, so nothing extra loads.


import { useQuery } from "@tanstack/react-query";
import { gate, Stale } from "../components/Reads.tsx";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { LAYERS, layerName } from "../components/ui.tsx";
import { read } from "../lib/reads.ts";


// The insights payload
interface Data {
  projects: number;
  byLayer: Record<string, number>;
  byHealth: Record<string, number>;
  weeks: { week: string; done: number }[];
  work: { open: number; overdue: number; onTime: number; late: number };
  decisions: { count: number; avgDays: number | null };
  measures: { count: number; reached: number };
  people: { active: number; invited: number };
}


// Health words and their colors, in the order people read them
const HEALTH = [
  ["on_track", "On track", "var(--ok)"],
  ["at_risk", "At risk", "var(--amber)"],
  ["off_track", "Off track", "var(--red)"],
  ["not_started", "Not started", "var(--muted)"],
] as const;


/** The Insights page */
export function Insights() {
  const { org } = useOrg();
  useTopBar(<span>{org.name} · Insights</span>, [org.name]);
  const q = useQuery({ queryKey: ["insights", org.id], queryFn: () => read<Data>(`/t/${org.id}/insights`, { work: "object", decisions: "object", measures: "object", people: "object", weeks: "array", byLayer: "object", byHealth: "object" }) });
  const d = q.data;
  const onTimeRate = d && d.work.onTime + d.work.late ? Math.round((d.work.onTime / (d.work.onTime + d.work.late)) * 100) : undefined;
  return (
    <>
      <h1 className="page-title">Insights</h1>
      <p className="lead">How work is going across {org.name}, made from what's already here.</p>
      <Stale reads={[q]} />
      {gate([q]) ?? (d && (
        <>
          {/* Headline numbers: each one a plain sentence underneath */}
          <div className="kpis" data-tour="kpis">
            <Kpi big={d.projects} label="active projects" />
            <Kpi big={d.work.open} label="open items" sub={d.work.overdue ? `${d.work.overdue} overdue` : "none overdue"} warn={d.work.overdue > 0} />
            <Kpi big={onTimeRate === undefined ? "–" : `${onTimeRate}%`} label="finished on time" sub={onTimeRate === undefined ? "nothing due has finished yet" : `${d.work.onTime} of ${d.work.onTime + d.work.late}`} />
            <Kpi big={d.decisions.avgDays ?? "–"} label="days to a decision" sub={`${d.decisions.count} decided`} />
            <Kpi big={`${d.measures.reached}/${d.measures.count}`} label="measures at target" />
            <Kpi big={d.people.active} label="people active" sub={d.people.invited ? `${d.people.invited} invited` : undefined} />
          </div>
          <div className="charts">
            <Weekly weeks={d.weeks} />
            <Layers byLayer={d.byLayer} total={d.projects} />
            <HealthBar byHealth={d.byHealth} total={d.projects} />
          </div>
        </>
      ))}
    </>
  );
}


/** One headline number */
function Kpi({ big, label, sub, warn }: { big: number | string; label: string; sub?: string; warn?: boolean }) {
  return (
    <div className="card kpi">
      <b>{big}</b>
      <span>{label}</span>
      {sub && <small className={warn ? "warn" : ""}>{sub}</small>}
    </div>
  );
}


/** Items finished per week for eight weeks, as columns with their counts */
function Weekly({ weeks }: { weeks: Data["weeks"] }) {
  const max = Math.max(1, ...weeks.map((w) => w.done));
  const total = weeks.reduce((a, w) => a + w.done, 0);
  return (
    <section className="card chart" data-tour="weekly">
      <h2 className="section-h">Finished per week <small>{total} in 8 weeks</small></h2>
      <div className="cols" role="img" aria-label={weeks.map((w) => `Week of ${w.week}: ${w.done}`).join(", ")}>
        {weeks.map((w, i) => (
          <div key={w.week} className="wk">
            <span className="v">{w.done || ""}</span>
            <span className={`bar${i === weeks.length - 1 ? " now" : ""}`} style={{ height: `${(w.done / max) * 100}%` }} />
            <span className="x">{i % 2 === 1 ? new Date(w.week + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "\u00a0"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}


/** Where projects are across the four layers, as one bar split in the layer greens */
function Layers({ byLayer, total }: { byLayer: Record<string, number>; total: number }) {
  return (
    <section className="card chart" data-tour="by-layer">
      <h2 className="section-h">Projects by layer</h2>
      <div className="split" role="img" aria-label={LAYERS.map((l) => `${layerName(l)}: ${byLayer[l] ?? 0}`).join(", ")}>
        {LAYERS.map((l, i) => (byLayer[l] ?? 0) > 0 && <span key={l} style={{ flex: byLayer[l], background: `var(--l${i + 1})` }} />)}
        {total === 0 && <span className="empty-bar" />}
      </div>
      <ul className="keys">{LAYERS.map((l, i) => <li key={l}><i style={{ background: `var(--l${i + 1})` }} />{layerName(l)} <b>{byLayer[l] ?? 0}</b></li>)}</ul>
    </section>
  );
}


/** Project health as one split bar, with words and counts */
function HealthBar({ byHealth, total }: { byHealth: Record<string, number>; total: number }) {
  return (
    <section className="card chart">
      <h2 className="section-h">Project health</h2>
      <div className="split" role="img" aria-label={HEALTH.map(([k, w]) => `${w}: ${byHealth[k] ?? 0}`).join(", ")}>
        {HEALTH.map(([k, , c]) => (byHealth[k] ?? 0) > 0 && <span key={k} style={{ flex: byHealth[k], background: c }} />)}
        {total === 0 && <span className="empty-bar" />}
      </div>
      <ul className="keys">{HEALTH.map(([k, w, c]) => <li key={k}><i style={{ background: c }} />{w} <b>{byHealth[k] ?? 0}</b></li>)}</ul>
    </section>
  );
}
