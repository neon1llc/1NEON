// apps/web/src/pages/Workspace.tsx - Workspace: the landing page inside an organization. Four hubs,
// what's waiting, and recent activity.


import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { ago, Empty, Rings } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { qk } from "../lib/hooks.ts";
import type { Workspace } from "../lib/types.ts";


// The organization's home: hub counts, items waiting on the caller, and recent activity
export function WorkspacePage() {
  const { org, summary } = useOrg();
  const base = `/o/${summary.slug}`;
  // Counts, waiting items, and activity in one call, refreshed every 30 seconds
  const ws = useQuery({ queryKey: qk.workspace(org.id), queryFn: () => api<Workspace>(`/t/${org.id}/workspace`), refetchInterval: 30_000 });
  useTopBar(<span>{org.name} · Workspace</span>, [org.name]);
  const c = ws.data?.counts;
  return (
    <>
      <h1 className="page-title">Workspace</h1>
      <p className="lead">{org.name} · {org.clientId}</p>
      {/* The four hubs with their headline numbers */}
      <div className="grid" aria-busy={ws.isPending}>
        <Hub to={`${base}/projects`} title="Projects" big={c?.projects} text={c ? `${c.deciding} deciding, ${c.building} building` : "…"} />
        <Hub to={`${base}/people`} title="People" big={c?.people} text={c ? (c.invited ? `${c.invited} invited, not joined yet` : "Everyone has joined") : "…"} />
        <Hub to={`${base}/documents`} title="Documents" big={c?.documents} text="Files by layer, scanned on upload" />
        <Hub to={`${base}/workflow`} title="Workflow" big={undefined} text="Every project on one board" icon />
      </div>
      <div className="two">
        {/* Options to approve and tasks assigned to the caller, linked to the right tab */}
        <section>
          <h2 className="section-h">Waiting on you <small>{ws.data?.waiting.length ?? 0}</small></h2>
          {ws.data && ws.data.waiting.length === 0 && <Empty text="Nothing is waiting on you." />}
          <div className="rows">
            {ws.data?.waiting.map((w) => (
              <Link key={w.itemId} className="row" to={`${base}/projects/${w.projectKey}/${w.kind === "option" ? "needs" : "execution"}`}>
                <span className="t">{w.title}</span>
                <span className="s">{w.projectKey}</span>
                <span className="tag">{w.kind === "option" ? "approve" : w.kind}</span>
              </Link>
            ))}
          </div>
        </section>
        <section>
          <h2 className="section-h">Recent activity</h2>
          {ws.data && ws.data.activity.length === 0 && <Empty text="No activity yet." />}
          <div className="rows">
            {ws.data?.activity.map((a) => (
              <div key={a.id} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                <span className="small">{a.summary}</span>
                <span className="s">{ago(a.at)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}


/** One hub card on the workspace */
function Hub({ to, title, big, text, icon }: { to: string; title: string; big?: number; text: string; icon?: boolean }) {
  return (
    <Link to={to} className="card hub" style={{ textDecoration: "none", color: "inherit" }}>
      <h3>
        {title}
        {icon ? <Rings /> : <span className="big">{big ?? "–"}</span>}
      </h3>
      <p>{text}</p>
    </Link>
  );
}
