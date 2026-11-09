// apps/web/src/pages/AllWorkflow.tsx - All clients: every organization's projects in one read-only
// view, one lane per organization.


import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Board } from "../components/Board.tsx";
import { useTopBar } from "../components/Shell.tsx";
import { gate, Stale } from "../components/Reads.tsx";
import { Empty } from "../components/ui.tsx";
import { read } from "../lib/reads.ts";
import type { AllProjects } from "../lib/types.ts";


// The operator's read-only board across every client, refreshed every 30 seconds
export function AllWorkflow() {
  const all = useQuery({ queryKey: ["all-projects"], queryFn: () => read<AllProjects>("/all/projects", { orgs: "array", projects: "array", stages: "array" }), refetchInterval: 30_000 });
  // Lanes by organization or one combined board
  const [view, setView] = useState<"lanes" | "board">("lanes");
  useTopBar(<span>All clients · Workflow</span>, []);
  // Nothing renders from the data while the gate shows loading or a failure
  const wait = gate([all]);
  const data = wait ? undefined : all.data;
  // Cards link into their own organization, where changes are allowed
  const slugOf = new Map(data?.orgs.map((o) => [o.id, o]) ?? []);
  // A project's page inside its own organization
  const href = (tenantId: string, key: string) => `/o/${slugOf.get(tenantId)?.slug}/projects/${key}`;
  return (
    <>
      <h1 className="page-title">All clients</h1>
      <p className="lead">Every active project across organizations. Open a project to make changes inside its organization.</p>
      {/* View switch between lanes and one board */}
      {/* Plain toggle buttons styled as tabs: Tab reaches each, Enter or Space picks it */}
      <div className="tabs" role="group" aria-label="View">
        <button type="button" aria-pressed={view === "lanes"} className={view === "lanes" ? "active" : ""} onClick={() => setView("lanes")}>By organization</button>
        <button type="button" aria-pressed={view === "board"} className={view === "board" ? "active" : ""} onClick={() => setView("board")}>One board</button>
      </div>
      <Stale reads={[all]} />
      {wait}
      {data && data.projects.length === 0 && <Empty text="No projects in any organization yet." />}
      {/* One board: the default stages, each card tagged with its client ID */}
      {data && view === "board" && (
        <Board stages={data.stages} projects={data.projects} hrefFor={(p) => href(p.tenantId, p.key)} orgName={(p) => slugOf.get(p.tenantId)?.clientId} />
      )}
      {/* By organization: one lane per client with its own stages; empty clients are skipped */}
      {data && view === "lanes" && (
        <div className="lanes">
          {data.orgs.map((o) => {
            const mine = data.projects.filter((p) => p.tenantId === o.id);
            if (mine.length === 0) return null;
            return (
              <section className="lane" key={o.id}>
                <h3>{o.name} <span className="tag client">{o.clientId}</span> <span className="muted small">{mine.length} active</span></h3>
                <Board stages={o.stages} projects={mine} hrefFor={(p) => href(p.tenantId, p.key)} />
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
