// A layer across the organization: its stages, and the projects sitting in them.
import type { Layer } from "@1neon/domain";
import { Link, useParams } from "react-router";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { daysSince, Empty, Health, LAYERS, layerName, Rings } from "../components/ui.tsx";
import { useProjects } from "../lib/hooks.ts";

const ABOUT: Record<Layer, string> = {
  needs: "What you need: requests, discovery, systems and accounts, requirements, options, and decisions.",
  execution: "The work itself: tasks, milestones, changes, and status updates.",
  observation: "Whether it worked: measures against the baseline, checks, and incidents.",
  next: "What happens after: handoff, runbooks, training, care, and the retrospective.",
};

export function LayerPage() {
  const { org, summary } = useOrg();
  const { layer } = useParams();
  const projects = useProjects(org.id);
  const l = layer as Layer;
  useTopBar(<span>{org.name} · {LAYERS.includes(l) ? layerName(l) : "Layer"}</span>, [org.name, l]);
  if (!LAYERS.includes(l)) return <Empty text="That layer doesn't exist." />;
  const stages = org.stages.filter((s) => s.layer === l && !s.hidden);
  const ids = new Set(stages.map((s) => s.id));
  const all = (projects.data ?? []).filter((p) => !p.archived);
  const here = all.filter((p) => ids.has(p.stageId));
  const others = all.filter((p) => !ids.has(p.stageId));
  return (
    <>
      <h1 className="page-title" style={{ display: "flex", gap: 12, alignItems: "center" }}><Rings active={l} title={layerName(l)} />{layerName(l)}</h1>
      <p className="lead">{ABOUT[l]}</p>
      {stages.map((s) => {
        const list = here.filter((p) => p.stageId === s.id);
        return (
          <section key={s.id}>
            <h2 className="section-h">{s.name} <small>{list.length}{s.exit ? ` · done when ${s.exit.toLowerCase()}` : ""}</small></h2>
            {list.length === 0 ? <p className="muted small">Nothing in {s.name} right now.</p> : (
              <div className="rows">
                {list.map((p) => (
                  <Link key={p.id} className="row" to={`/o/${summary.slug}/projects/${p.key}/${l}`}>
                    <span><span className="s">{p.key}</span> <span className="t">{p.name}</span></span>
                    <span className="s">{daysSince(p.stageEnteredAt)}d in stage</span>
                    <Health value={p.health} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {others.length > 0 && (
        <>
          <h2 className="section-h">Other projects <small>open their {layerName(l)} tab</small></h2>
          <div className="rows">
            {others.map((p) => (
              <Link key={p.id} className="row" to={`/o/${summary.slug}/projects/${p.key}/${l}`}>
                <span><span className="s">{p.key}</span> <span className="t">{p.name}</span></span>
                <span className="s">{org.stages.find((s) => s.id === p.stageId)?.name}</span>
                <Health value={p.health} />
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
