// apps/web/src/pages/LayerPage.tsx - A layer across the organization: its stages, and the projects
// sitting in them.


import type { Layer } from "@1neon/domain";
import { Link, useParams } from "react-router";
import { gate, Stale } from "../components/Reads.tsx";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { daysSince, Empty, Health, LAYERS, layerFromSlug, layerName, layerSlug, Rings } from "../components/ui.tsx";
import { useProjects } from "../lib/hooks.ts";


// What each layer holds, shown under its title
const ABOUT: Record<Layer, string> = {
  needs: "What you need: requests, discovery, systems and accounts, requirements, options, and decisions.",
  execution: "The work itself: tasks, milestones, changes, and status updates.",
  observation: "Whether it worked: measures against the baseline, checks, and incidents.",
  next: "Making it the normal way of working: handoff, training, runbooks and docs, retiring or merging older tools, cleanup, ongoing care, and the retrospective.",
};


// One layer across every live project in the organization
export function LayerPage() {
  const { org, summary } = useOrg();
  const { layer } = useParams();
  const projects = useProjects(org.id);
  const l = layerFromSlug(layer) as Layer;
  useTopBar(<span>{org.name} · {LAYERS.includes(l) ? layerName(l) : "Layer"}</span>, [org.name, l]);
  if (!LAYERS.includes(l)) return <Empty text="That layer doesn't exist." />;
  // Projects in this layer's stages first, then every other project with a link to its tab for this layer
  // A hidden stage still gets its section while projects are in it, as on the board
  const all = (projects.data ?? []).filter((p) => !p.archived);
  const stages = org.stages.filter((s) => s.layer === l && (!s.hidden || all.some((p) => p.stageId === s.id)));
  const ids = new Set(stages.map((s) => s.id));
  const here = all.filter((p) => ids.has(p.stageId));
  const others = all.filter((p) => !ids.has(p.stageId));
  return (
    <>
      <h1 className="page-title" style={{ display: "flex", gap: 12, alignItems: "center" }}><Rings active={l} title={layerName(l)} />{layerName(l)}</h1>
      <p className="lead" data-tour="layer-list">{ABOUT[l]}</p>
      <Stale reads={[projects]} />
      {/* Until the list answers, no stage claims "Nothing in it" */}
      {gate([projects]) ?? <>
      {/* A section per stage in this layer, links opening each project on this layer's tab */}
      {stages.map((s) => {
        const list = here.filter((p) => p.stageId === s.id);
        return (
          <section key={s.id}>
            <h2 className="section-h">{s.name} <small>{list.length}{s.exit ? ` · done when ${s.exit.toLowerCase()}` : ""}</small></h2>
            {list.length === 0 ? <p className="muted small">Nothing in {s.name} right now.</p> : (
              <div className="rows">
                {list.map((p) => (
                  <Link key={p.id} className="row" to={`/o/${summary.slug}/projects/${p.key}/${layerSlug(l)}`}>
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
      {/* Projects in other layers still have work on this one */}
      {others.length > 0 && (
        <>
          <h2 className="section-h">Other projects <small>open their {layerName(l)} tab</small></h2>
          <div className="rows">
            {others.map((p) => (
              <Link key={p.id} className="row" to={`/o/${summary.slug}/projects/${p.key}/${layerSlug(l)}`}>
                <span><span className="s">{p.key}</span> <span className="t">{p.name}</span></span>
                <span className="s">{org.stages.find((s) => s.id === p.stageId)?.name}</span>
                <Health value={p.health} />
              </Link>
            ))}
          </div>
        </>
      )}
      </>}
    </>
  );
}
