// apps/web/src/live/LiveBar.tsx - The live playback's controls, above the portal: one segment per
// section showing where the story is, the last section on the left, the next on the right, and
// between them play, speed, and what's happening now. The middle opens every section, plus the
// short demos. Space plays or pauses; the arrow keys step between sections.


import { ChevronDown, ChevronLeft, ChevronRight, Gauge, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Player, View } from "./player.ts";
import { SHORTS } from "./shorts.ts";
import { PROJECT } from "./where.ts";
import "./live.css";


// Typing in a field, or a focused control that already answers Space, keeps its own keys
const ownsKeys = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest("input, textarea, select, button, a, [contenteditable=true], dialog"));


/** Exit tour: back where the visitor came from on neon1.tech, or the site's home */
function exitTo() {
  try {
    const from = new URL(document.referrer);
    if (from.origin === location.origin && !from.pathname.startsWith("/1NEON/live")) return from.pathname + from.search;
  } catch { /* no referrer */ }
  return "/";
}


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
  const short = player.show.id !== PROJECT;

  // The middle opens the list and pauses, so nothing moves while choosing
  const openList = () => {
    if (!list) player.pause();
    setList(!list);
  };
  // A tap outside the open list closes it; Escape too
  useEffect(() => {
    if (!list && !speedOpen) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) { setList(false); setSpeedOpen(false); } };
    // Escape from inside a list returns focus to the bar's control that opened it (AP-04)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = box.current?.contains(document.activeElement) && document.activeElement !== box.current;
      setList(false); setSpeedOpen(false);
      if (inside) box.current?.querySelector<HTMLButtonElement>(speedOpen ? ".live-speed" : ".live-now")?.focus();
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", esc); };
  }, [list, speedOpen]);
  const jump = (i: number) => { setList(false); void player.goTo(i); };
  // Keyboard: Space plays and pauses, the arrows step back and on, wherever focus isn't already busy
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || ownsKeys(e.target)) return;
      if (e.key === " ") { e.preventDefault(); player.toggle(); }
      else if (e.key === "ArrowRight" && v.index < player.sections.length - 1) void player.goTo(v.index + 1);
      else if (e.key === "ArrowLeft" && v.index > 0) void player.goTo(v.index - 1);
    };
    addEventListener("keydown", keys);
    return () => removeEventListener("keydown", keys);
  }, [player, v.index]);

  return (
    <div className="live-bar" ref={box} role="region" aria-label="Guided walkthrough controls">
      <div className="live-inner">
        {/* What this is, at every chapter: a fictional walkthrough, with a way to try it by hand and
            a way out that doesn't depend on anything the story is doing underneath */}
        <div className="live-meta">
          <span className="live-what"><b>Guided walkthrough</b><span className="live-fiction">Fictional<span className="wide"> project</span> · no account needed</span></span>
          <span className="live-exits">
            <a href="/1NEON/demo/">Try it<span className="wide"> yourself</span></a>
            <a href={exitTo()} className="live-exit">Exit tour</a>
          </span>
        </div>
        {/* One segment per section: done ones full, the current one filling, the rest empty */}
        <div className="live-line" aria-hidden="true">
          {player.sections.map((s, i) => (
            <span key={s.id} className={i === v.index ? "now" : undefined}>
              <i style={{ transform: `scaleX(${i < v.index ? 1 : i === v.index ? v.progress : 0})` }} />
            </span>
          ))}
        </div>
        <div className="live-row">
          {/* Back and on name the neighbouring sections; at either end the button steps aside */}
          <button className={`live-step back${prev ? "" : " none"}`} onClick={() => jump(v.index - 1)} disabled={!prev} aria-label={prev ? `Back to ${prev.title}` : undefined}>
            <ChevronLeft size={16} aria-hidden="true" /><span>{prev?.title}</span>
          </button>
          <div className="live-mid">
            {/* Before it starts (reduced motion, or a background tab) the one button says Start */}
            <button className={`live-play${v.idle ? " start" : ""}`} onClick={() => player.toggle()} aria-label={v.idle ? undefined : v.done ? "Watch again" : v.paused ? "Play" : "Pause"} title={v.done ? "Watch again" : undefined}>
              {v.done ? <RotateCcw size={15} aria-hidden="true" /> : v.paused || v.idle ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
              {v.idle && <span>Start</span>}
            </button>
            {/* Speed: a slider from half to twice the calm default, remembered on this device */}
            <span className="live-speed-wrap">
              <button className="live-speed" onClick={() => setSpeedOpen(!speedOpen)} aria-expanded={speedOpen} aria-label={`Speed ${speed}x`}>
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
            <button className="live-now" onClick={openList} aria-expanded={list} aria-controls="live-list">
              <span className="live-title">{v.idle ? player.show.title : `${v.index + 1}/${player.sections.length} · ${v.title}`}</span>
              {/* Before starting: how long it takes, so the visitor knows before committing */}
              <span className="live-cap">{v.idle ? `${player.show.length ?? "A few minutes"}. Start when you're ready.` : v.skipping ? "Catching up…" : v.caption || " "}</span>
              <ChevronDown className="live-caret" size={14} aria-hidden="true" />
            </button>
          </div>
          <button className={`live-step fwd${next ? "" : " none"}`} onClick={() => jump(v.index + 1)} disabled={!next} aria-label={next ? `On to ${next.title}` : undefined}>
            <span>{next?.title}</span><ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {/* While it plays, the portal underneath doesn't take clicks, so a stray click can't knock the
          story off course. Pause to explore; resuming plays the section again from its start */}
      {!v.paused && !v.done && createPortal(<div className="live-shield" aria-hidden="true" />, document.body)}
      {/* Every section in order, the current one marked; it unrolls downward from the bar. Below, the
          short demos (a different show loads fresh) */}
      <div id="live-list" className={`live-list${list ? " open" : ""}`} inert={!list}>
        <p className="live-list-h">{player.show.title}</p>
        {/* How a reload behaves, said where someone would look for it */}
        <p className="live-list-note">Nothing here is saved. A reload picks up at the same chapter, from fresh fictional data.</p>
        <ol>
          {player.sections.map((s, i) => (
            <li key={s.id}>
              <button aria-current={i === v.index ? "step" : undefined} className={i === v.index ? "on" : i < v.index ? "past" : ""} onClick={() => jump(i)}>
                <span className="n">{i + 1}</span>{s.title}
              </button>
            </li>
          ))}
        </ol>
        {(short || SHORTS.length > 0) && <p className="live-list-h">{short ? "Other demos" : "Short demos"}</p>}
        <ul>
          {short && <li><a href="/1NEON/live?play=full"><span className="n">▸</span><span>The full story<small>A whole project, from a first sign-in to ongoing care · about 6 minutes</small></span></a></li>}
          {SHORTS.filter((s) => s.id !== player.show.id).map((s) => (
            <li key={s.id}><a href={`/1NEON/live?play=${s.id}`}><span className="n">▸</span><span>{s.title}<small>{s.blurb}{s.length ? ` · ${s.length}` : ""}</small></span></a></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
