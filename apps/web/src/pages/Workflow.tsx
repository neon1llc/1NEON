// apps/web/src/pages/Workflow.tsx - Workflow: this organization's projects on the stage board.


import { useState } from "react";
import { Link } from "react-router";
import { Board, type MoveRequest } from "../components/Board.tsx";
import { gate, Stale } from "../components/Reads.tsx";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { Dialog, Empty, useToast } from "../components/ui.tsx";
import { api, HttpError } from "../lib/api.ts";
import { problem, useProjects, useRefresh } from "../lib/hooks.ts";


// The organization's board; editors can move cards
export function Workflow() {
  const { org, summary, canWrite } = useOrg();
  const projects = useProjects(org.id);
  const refresh = useRefresh(org.id);
  const toast = useToast();
  // A move waiting on a reason, and the reason being typed
  const [pending, setPending] = useState<{ move: MoveRequest; message: string }>();
  const [reason, setReason] = useState("");
  useTopBar(<span>{org.name} · Board</span>, [org.name]);

  // Ask the API to move; it may need a reason (428) or report that someone moved the card first (409)
  const move = async (m: MoveRequest, why?: string) => {
    try {
      await api(`/t/${org.id}/projects/${m.project.id}/move`, {
        method: "POST",
        body: { version: m.project.version, stageId: m.stageId, after: m.after, before: m.before, reason: why },
      });
      const to = org.stages.find((s) => s.id === m.stageId)?.name;
      if (m.stageId !== m.project.stageId) toast(`${m.project.key} moved to ${to}`);
    } catch (e) {
      // Past Decide with no approved option: collect a reason and try again with it
      if (e instanceof HttpError && e.status === 428) {
        setReason("");
        setPending({ move: m, message: e.body.message });
        return;
      }
      if (e instanceof HttpError && e.status === 409) toast(`${m.project.key} changed while you were moving it. The board is up to date now.`);
      else toast(problem(e));
    }
    refresh();
  };

  // Archived projects leave the board; until the list answers, the board waits instead of showing empty
  const live = (projects.data ?? []).filter((p) => !p.archived);
  const wait = gate([projects]);
  return (
    <>
      <h1 className="page-title">Board</h1>
      <p className="lead">
        {/* Touch screens can't drag cards, so they hear only about the menu */}
        {!canWrite ? "Every project and where it stands." : matchMedia("(pointer: fine)").matches ? "Drag a card, or use its Move to menu, to change a project's stage." : "Use a card's Move to menu to change a project's stage."}
      </p>
      <Stale reads={[projects]} />
      {/* Read-only board for viewers: no onMove */}
      {wait ?? (live.length === 0 ? (
        <Empty text="No projects yet." action={canWrite && <Link className="btn btn-primary" to={`/o/${summary.slug}/projects/new`}>New project</Link>} />
      ) : (
        <Board stages={org.stages} projects={live} hrefFor={(p) => `/o/${summary.slug}/projects/${p.key}`} onMove={canWrite ? (m) => void move(m) : undefined} />
      ))}
      {/* The reason prompt for moving past Decide without a decision */}
      <Dialog open={Boolean(pending)} onClose={() => setPending(undefined)} label="Reason needed">
        <h2>Move on without a decision?</h2>
        <p className="muted small">{pending?.message}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const p = pending;
            setPending(undefined);
            if (p && reason.trim()) void move(p.move, reason.trim());
          }}
        >
          <label htmlFor="why">Reason</label>
          <textarea id="why" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required autoFocus placeholder="e.g. the client chose over the phone; the option will be approved here this week" />
          <div className="actions">
            <button className="btn btn-primary" type="submit">Move anyway</button>
            <button className="btn btn-ghost" type="button" onClick={() => setPending(undefined)}>Cancel</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
