// apps/web/src/pages/Workspace.tsx - Home inside an organization: what needs you, a setup checklist
// until it's done, the headline numbers, and recent activity.


import { KIND_LAYER, type ItemKind } from "@1neon/domain";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleCheck, FileUp, ListTodo } from "lucide-react";
import { Link } from "react-router";
import { ComingUp } from "../components/ComingUp.tsx";
import { Problem, Stale } from "../components/Reads.tsx";
import { useHelp } from "../components/Help.tsx";
import { useOrg, useSession, useTopBar } from "../components/Shell.tsx";
import { ago, Health } from "../components/ui.tsx";
import type { Project } from "@1neon/domain";
type HealthT = Project["health"];
import { qk } from "../lib/hooks.ts";
import { failureOf, hidesData, read } from "../lib/reads.ts";
import type { Workspace } from "../lib/types.ts";


// The words and icon for each kind of thing waiting on someone
const ACTION = {
  approve: { label: "Review and approve", icon: CircleCheck },
  upload: { label: "Upload file", icon: FileUp },
  do: { label: "Open", icon: ListTodo },
} as const;


// The organization's home
export function WorkspacePage() {
  const { org, summary, canWrite, canAdmin } = useOrg();
  const me = useSession();
  const help = useHelp();
  const base = `/o/${summary.slug}`;
  // Counts, waiting items, and activity in one call, refreshed every 30 seconds
  const ws = useQuery({ queryKey: qk.workspace(org.id), queryFn: () => read<Workspace>(`/t/${org.id}/workspace`, { counts: "object", waiting: "array", activity: "array" }), refetchInterval: 30_000 });
  useTopBar(<span>{org.name}</span>, [org.name]);
  const c = ws.data?.counts;
  const first = (me.user.name || "").split(" ")[0];

  // Setup steps, each ticked off by the real state; the card goes once all are done
  const steps = [
    { done: me.user.tour === "done", label: "Take the 1-minute tour", act: <button className="link" onClick={help.welcomeTour}>Start</button> },
    ...(canWrite ? [{ done: (c?.projects ?? 0) > 0, label: "Start your first project", act: <Link to={`${base}/projects/new`}>Start</Link> }] : []),
    ...(canAdmin ? [{ done: (c?.people ?? 0) > 1, label: "Invite your team", act: <Link to={`${base}/people`}>Invite</Link> }] : []),
    ...(canAdmin ? [{ done: Boolean(me.factors?.any), label: "Add a passkey for admin actions", act: <Link to="/me">Add</Link> }] : []),
  ];
  const setupLeft = steps.filter((s) => !s.done).length;
  const n = ws.data?.waiting.length ?? 0;
  // A failure with nothing to show (or one that hides what was shown) replaces the cards, so no card
  // claims "all caught up" or "no activity" for data that never arrived
  const blocked = ws.isError && (!ws.data || hidesData(failureOf(ws.error)));

  return (
    <>
      <h1 className="page-title">{first ? `Hi, ${first}` : "Home"}</h1>
      <p className="lead">{ws.data && !blocked ? (n ? `${n} ${n === 1 ? "thing needs" : "things need"} you.` : "Nothing needs you right now.") : " "}</p>
      <Stale reads={[ws]} />

      {blocked ? <Problem error={ws.error} reads={[ws]} /> : <div className="home">
        <div className="home-main">
        {/* Needs you: the main event, each with the one action it asks for */}
        <section className="card needs" data-tour="needs-you" aria-busy={ws.isPending}>
          <h2 className="section-h">Needs you</h2>
          {ws.data && n === 0 && <p className="empty-line"><Check size={18} aria-hidden="true" /> You're all caught up.</p>}
          <ul className="todo">
            {ws.data?.waiting.map((w) => {
              const a = ACTION[w.action];
              const layer = KIND_LAYER[w.kind as ItemKind] ?? "needs";
              return (
                <li key={w.itemId}>
                  <a.icon size={18} aria-hidden="true" className="todo-ico" />
                  <span className="todo-t">{w.title}<small>{w.projectKey}</small></span>
                  <Link className="btn btn-ghost btn-sm" to={`${base}/projects/${w.projectKey}/${layer}#item-${w.itemId}`}>{a.label}</Link>
                </li>
              );
            })}
          </ul>
        </section>

        <ComingUp tid={org.id} base={base} />
        </div>
        <div className="home-side">
          {/* Setup, until every step is done */}
          {setupLeft > 0 && (
            <section className="card" data-tour="get-started">
              <h2 className="section-h">Get started <small>{steps.length - setupLeft} of {steps.length}</small></h2>
              <ul className="checklist">
                {steps.map((s) => (
                  <li key={s.label} className={s.done ? "done" : ""}>
                    <span className="tick" aria-hidden="true">{s.done ? <Check size={14} /> : null}</span>
                    <span>{s.label}</span>
                    {!s.done && s.act}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* The headline numbers, each a way in */}
          <nav className="stats" aria-label="At a glance">
            <Link to={`${base}/projects`}><b>{c?.projects ?? "–"}</b> projects</Link>
            <Link to={`${base}/workflow`}><b>{c?.deciding ?? "–"}</b> deciding</Link>
            <Link to={`${base}/workflow`}><b>{c?.building ?? "–"}</b> building</Link>
            <Link to={`${base}/people`}><b>{c?.people ?? "–"}</b> people{c?.invited ? ` (${c.invited} invited)` : ""}</Link>
            <Link to={`${base}/documents`}><b>{c?.documents ?? "–"}</b> files</Link>
          </nav>
          {/* Each project's latest written update, with its health */}
          {(ws.data?.updates?.length ?? 0) > 0 && (
            <section className="card">
              <h2 className="section-h">Project updates</h2>
              <ul className="updates">
                {ws.data!.updates!.map((u) => (
                  <li key={u.projectKey}>
                    <Link to={`${base}/projects/${u.projectKey}`}><span className="s">{u.projectKey}</span> {u.projectName}</Link>
                    <span className="u-line"><Health value={u.health as HealthT} /> <time>{ago(u.at)}</time></span>
                    <p>{u.title}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* What happened lately */}
          <section className="card" data-tour="activity">
            <h2 className="section-h">Recent activity</h2>
            {ws.data && ws.data.activity.length === 0 && <p className="muted small">No activity yet.</p>}
            <ul className="feed">
              {ws.data?.activity.slice(0, 8).map((a) => (
                <li key={a.id}><span>{a.summary}</span><time dateTime={a.at}>{ago(a.at)}</time></li>
              ))}
            </ul>
          </section>
        </div>
      </div>}
    </>
  );
}
