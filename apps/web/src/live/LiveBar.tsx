// apps/web/src/live/LiveBar.tsx - The live playback's controls, above the portal: a line that grows
// across the section as it plays, the last section on the left, the next on the right, and between
// them what's happening now. A tap in the middle pauses and lists every section.


import { ChevronDown, ChevronLeft, ChevronRight, Gauge, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Player, View } from "./player.ts";


/** The bar, bound to one player */
export function LiveBar({ player }: { player: Player }) {
  const [v, setV] = useState<View>(player.view);
  const [list, setList] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [speed, setSpeed] = useState(player.speed);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => player.subscribe(setV), [player]);
  const prev = player.sections[v.index - 1];
  const next = player.sections[v.index + 1];

  // The middle opens the list and pauses, so nothing moves while choosing
  const openList = () => {
    if (!list) player.pause();
    setList(!list);
  };
  // A tap outside the open list closes it; Escape too
  useEffect(() => {
    if (!list && !speedOpen) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) { setList(false); setSpeedOpen(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setList(false); setSpeedOpen(false); } };
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", esc); };
  }, [list, speedOpen]);
  const jump = (i: number) => { setList(false); void player.goTo(i); };

  return (
    <div className="live-bar" ref={box} role="region" aria-label="Live demo controls">
      <div className="live-inner">
        {/* The section's time, from the left edge of Back to the right edge of Next */}
        <div className="live-line" aria-hidden="true"><span style={{ transform: `scaleX(${v.progress})` }} /></div>
        <div className="live-row">
          <button className="live-step back" onClick={() => jump(v.index - 1)} disabled={!prev} title={prev ? `Back to ${prev.title}` : undefined}>
            <ChevronLeft size={16} aria-hidden="true" /><span>{prev?.title ?? "Start"}</span>
          </button>
          <div className="live-mid">
            <button className="live-play" onClick={() => player.toggle()} aria-label={v.paused ? "Play" : "Pause"}>
              {v.paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
            </button>
            {/* Speed: a slider from half to twice the calm default, remembered on this device */}
            <span className="live-speed-wrap">
              <button className="live-speed" onClick={() => setSpeedOpen(!speedOpen)} aria-expanded={speedOpen} aria-label={`Speed ${speed}x`} title="Speed">
                <Gauge size={14} aria-hidden="true" /><span>{speed}x</span>
              </button>
              {speedOpen && (
                <span className="live-speed-pop">
                  <span className="small">0.5x</span>
                  <input type="range" min={0.5} max={2} step={0.25} value={speed} aria-label="Playback speed"
                    onChange={(e) => { const n = Number(e.target.value); setSpeed(n); player.setSpeed(n); }} />
                  <span className="small">2x</span>
                  <b className="live-speed-now">{speed}x</b>
                </span>
              )}
            </span>
            <button className="live-now" onClick={openList} aria-expanded={list} aria-haspopup="listbox">
              <span className="live-title">{v.index + 1}. {v.title}</span>
              <span className="live-cap">{v.skipping ? "Catching up…" : v.caption}</span>
              <ChevronDown className="live-caret" size={14} aria-hidden="true" />
            </button>
          </div>
          <button className="live-step fwd" onClick={() => jump(v.index + 1)} disabled={!next} title={next ? `On to ${next.title}` : undefined}>
            <span>{next?.title ?? "The end"}</span><ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        {/* While it plays, the portal underneath doesn't take clicks; a click pauses, so the page can be explored */}
        {!v.paused && !v.done && createPortal(<div className="live-shield" onPointerDown={() => player.pause()} title="Click to pause" />, document.body)}
        {/* Every section in order, the current one marked */}
        {list && (
          <ol className="live-list" role="listbox" aria-label="Sections">
            {player.sections.map((s, i) => (
              <li key={s.id}>
                <button role="option" aria-selected={i === v.index} className={i === v.index ? "on" : i < v.index ? "past" : ""} onClick={() => jump(i)}>
                  <span className="n">{i + 1}</span>{s.title}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
