// apps/web/src/components/Board.tsx - The workflow board: one column per stage, projects as cards,
// ordered by rank. Drag and drop for pointers, a "Move to" menu for keyboards and screen readers.


import type { Project, Stage } from "@1neon/domain";
import { useState } from "react";
import { Link } from "react-router";
import { byRank } from "../lib/hooks.ts";
import { daysSince, Health, LayerBadge } from "./ui.tsx";


/** A requested move: target stage and the ranks of the neighbours it lands between */
export interface MoveRequest {
  project: Project;
  stageId: string;
  after?: string;
  before?: string;
}


/** The board. Without `onMove` it's read only (viewers and the All clients view) */
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
  // The card being dragged and the column under the pointer
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  // Cards in one column, in rank order
  const byStage = (sid: string) => projects.filter((p) => p.stageId === sid).sort(byRank);
  // Hidden stages drop off the board, except while projects are still in them, so no project goes missing
  const visible = stages.filter((s) => !s.hidden || projects.some((p) => p.stageId === s.id));

  // Drop before `beforeId`, or at the end of the column; a drop onto the card's own place is ignored
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
        // Work-in-progress limits are advice: the count turns amber, nothing is blocked
        const overLimit = s.wipLimit !== undefined && cards.length > s.wipLimit;
        return (
          <section
            key={s.id}
            role="listitem"
            data-tour="board-column"
            className={`col${cards.length ? "" : " empty"}${over === s.id ? " drop" : ""}`}
            aria-label={`${s.name}, ${cards.length} ${cards.length === 1 ? "project" : "projects"}`}
            title={cards.length ? undefined : `${s.name}: no projects${s.exit ? `. Done when: ${s.exit}` : ""}`}
            // Columns accept drops; a card accepts a drop to insert before itself
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
            {/* Column header: layer, name, and count against its limit */}
            <header>
              <h3><LayerBadge layer={s.layer} /><span className="nm">{s.name}</span></h3>
              <span className={`n${overLimit ? " over" : ""}`} title={s.wipLimit ? `Limit ${s.wipLimit}` : undefined}>
                {cards.length}{s.wipLimit ? `/${s.wipLimit}` : ""}
              </span>
            </header>
            {s.exit && <div className="exit">Done when: {s.exit}</div>}
            {/* Cards drag when the board is editable; a drop onto a card inserts before it */}
            {cards.map((p) => (
              <article
                key={p.id}
                data-tour="board-card"
                className={`pcard${dragging === p.id ? " dragging" : ""}`}
                draggable={Boolean(onMove)}
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
                {/* Project key, its organization on All clients, name, health, and days in stage */}
                <div className="k">
                  <span>{p.key}</span>
                  {orgName?.(p) && <span className="tag client">{orgName(p)}</span>}
                </div>
                <Link className="name" to={hrefFor(p)}>{p.name}</Link>
                <div className="meta">
                  <Health value={p.health} />
                  <span title="Days in this stage">{daysSince(p.stageEnteredAt)}d</span>
                </div>
                {/* Keyboard, tap, and screen-reader path: the same moves as dragging. Up and down reorder within
                    the column (AP-06); another stage moves the card to the end of that column */}
                {onMove && (
                  <label className="move">
                    <span className="sr">Move {p.key} to</span>
                    <select
                      value=""
                      onChange={(e) => {
                        const to = e.target.value;
                        if (!to) return;
                        const at = cards.findIndex((x) => x.id === p.id);
                        if (to === "__up" || to === "__down") {
                          // Up: between the two cards above; down: between the two below
                          const rest = cards.filter((x) => x.id !== p.id);
                          const idx = to === "__up" ? at - 1 : at + 1;
                          onMove({ project: p, stageId: s.id, after: rest[idx - 1]?.rank, before: rest[idx]?.rank });
                          return;
                        }
                        const list = byStage(to).filter((x) => x.id !== p.id);
                        onMove({ project: p, stageId: to, after: list.at(-1)?.rank });
                      }}
                    >
                      <option value="">Move to…</option>
                      {cards.findIndex((x) => x.id === p.id) > 0 && <option value="__up">Up one in {s.name}</option>}
                      {cards.findIndex((x) => x.id === p.id) < cards.length - 1 && <option value="__down">Down one in {s.name}</option>}
                      {stages.filter((x) => !x.hidden && x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </label>
                )}
              </article>
            ))}
            {cards.length === 0 && <p className="muted small none" style={{ padding: "4px" }}>No projects here.</p>}
          </section>
        );
      })}
    </div>
  );
}
