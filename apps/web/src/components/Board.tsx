// The workflow board: one column per stage, projects as cards, ordered by rank.
// Drag and drop for pointers, a "Move to" menu for keyboards and screen readers.
import type { Project, Stage } from "@1neon/domain";
import { useState } from "react";
import { Link } from "react-router";
import { byRank } from "../lib/hooks.ts";
import { daysSince, Health, LayerBadge } from "./ui.tsx";

export interface MoveRequest {
  project: Project;
  stageId: string;
  after?: string;
  before?: string;
}

export function Board({
  stages,
  projects,
  hrefFor,
  onMove,
  orgName,
}: {
  stages: Stage[];
  projects: Project[];
  hrefFor: (p: Project) => string;
  onMove?: (m: MoveRequest) => void;
  orgName?: (p: Project) => string | undefined;
}) {
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const visible = stages.filter((s) => !s.hidden);
  const byStage = (sid: string) => projects.filter((p) => p.stageId === sid).sort(byRank);

  const drop = (stageId: string, beforeId?: string) => {
    const p = projects.find((x) => x.id === dragging);
    setDragging(undefined);
    setOver(undefined);
    if (!p || !onMove) return;
    const list = byStage(stageId).filter((x) => x.id !== p.id);
    const at = beforeId ? list.findIndex((x) => x.id === beforeId) : list.length;
    const idx = at < 0 ? list.length : at;
    if (p.stageId === stageId && byStage(stageId).findIndex((x) => x.id === p.id) === idx) return;
    onMove({ project: p, stageId, after: list[idx - 1]?.rank, before: list[idx]?.rank });
  };

  return (
    <div className="board" role="list" aria-label="Workflow board">
      {visible.map((s) => {
        const cards = byStage(s.id);
        const overLimit = s.wipLimit !== undefined && cards.length > s.wipLimit;
        return (
          <section
            key={s.id}
            role="listitem"
            className={`col${over === s.id ? " drop" : ""}`}
            aria-label={`${s.name}, ${cards.length} projects`}
            onDragOver={(e) => {
              if (!onMove || !dragging) return;
              e.preventDefault();
              setOver(s.id);
            }}
            onDragLeave={() => setOver((o) => (o === s.id ? undefined : o))}
            onDrop={(e) => {
              e.preventDefault();
              drop(s.id);
            }}
          >
            <header>
              <h3><LayerBadge layer={s.layer} />{s.name}</h3>
              <span className={`n${overLimit ? " over" : ""}`} title={s.wipLimit ? `Limit ${s.wipLimit}` : undefined}>
                {cards.length}{s.wipLimit ? `/${s.wipLimit}` : ""}
              </span>
            </header>
            {s.exit && <div className="exit">Done when: {s.exit}</div>}
            {cards.map((p) => (
              <article
                key={p.id}
                className={`pcard${dragging === p.id ? " dragging" : ""}`}
                draggable={Boolean(onMove)}
                aria-disabled={!onMove}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", p.key);
                  setDragging(p.id);
                }}
                onDragEnd={() => {
                  setDragging(undefined);
                  setOver(undefined);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  drop(s.id, p.id);
                }}
              >
                <div className="k">
                  <span>{p.key}</span>
                  {orgName?.(p) && <span className="tag client">{orgName(p)}</span>}
                </div>
                <Link className="name" to={hrefFor(p)}>{p.name}</Link>
                <div className="meta">
                  <Health value={p.health} />
                  <span title="Days in this stage">{daysSince(p.stageEnteredAt)}d</span>
                </div>
                {onMove && (
                  <label className="sr-focus small" style={{ display: "block", marginTop: 8 }}>
                    <span className="sr">Move {p.key} to</span>
                    <select
                      value=""
                      onChange={(e) => {
                        const to = e.target.value;
                        if (!to) return;
                        const list = byStage(to).filter((x) => x.id !== p.id);
                        onMove({ project: p, stageId: to, after: list.at(-1)?.rank });
                      }}
                      style={{ minHeight: 30, padding: "2px 8px", fontSize: 12 }}
                    >
                      <option value="">Move to…</option>
                      {visible.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </label>
                )}
              </article>
            ))}
            {cards.length === 0 && <p className="muted small" style={{ padding: "4px" }}>Nothing here.</p>}
          </section>
        );
      })}
    </div>
  );
}
