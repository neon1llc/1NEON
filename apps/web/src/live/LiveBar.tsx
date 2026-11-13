// apps/web/src/live/LiveBar.tsx - The live playback's controls, above the portal: one segment per
// chapter showing where the story is, the last chapter on the left, the next on the right, and
// between them play, speed, and the chapter's name, which opens every chapter plus the other
// walkthroughs. Around it: the card before Start, the narration band under the controls, and the
// card at the end. Space plays or pauses; the arrow keys step between chapters.


import { ChevronDown, ChevronLeft, ChevronRight, Gauge, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Player, View } from "./player.ts";
import { SHORTS } from "./shorts.ts";
import { FULL_LENGTH, PROJECT } from "./where.ts";
import "./live.css";


// Typing in a field, or a focused control that already answers Space, keeps its own keys
const ownsKeys = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest("input, textarea, select, button, a, [contenteditable=true], dialog"));

// Where a walkthrough link was clicked, saved by the page that linked here (main.tsx), so Exit can
// return to the very answer the visitor was reading; the referrer alone has no #fragment
export const FROM_KEY = "1neon.liveFrom";


/** Exit: back where the visitor came from on neon1.tech (the same answer, when the linking page saved
 * it), or the site's home */
function exitTo(): { href: string; label: string } {
  const name = (path: string) => (/\/faqs|\/knowledge\//.test(path) ? "Back to the answer" : path.startsWith("/1NEON/example") ? "Back to the sample project" : "Back to where you were");
  try {
    const from = new URL(document.referrer);
    if (from.origin === location.origin && !from.pathname.startsWith("/1NEON/live")) {
      // The saved spot counts only when it's on the page the visitor really came from
      const saved = sessionStorage.getItem(FROM_KEY);
      const spot = saved && new URL(saved, location.origin).pathname === from.pathname ? saved : from.pathname + from.search;
      return { href: spot, label: name(from.pathname) };
    }
  } catch { /* no referrer, or storage blocked */ }
  return { href: "/", label: "neon1.tech" };
}


/** A card over the portal: the one before Start, the one at the end, and the one for a stumble. It sits
 * under the bar, dims the page behind it, and takes focus so Enter and Space act on its first button */
function Card({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("[data-first]")?.focus({ preventScroll: true }); }, []);
  return createPortal(
    <div className="live-card-back">
      <section ref={ref} className="live-card" role="dialog" aria-label={label}>{children}</section>
    </div>,
    document.body,
  );
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
  const show = player.show;
  // One chapter on its own counts as a short: it offers the full story beside the other demos
  const short = show.id !== PROJECT || player.focused;
  const exit = exitTo();

  // The middle opens the list and pauses, so nothing moves while choosing
  const openList = () => {
    if (!list && !v.idle && !v.done) player.pause();
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

  // The narration shows while the story is on screen: not before Start, behind the catch-up cover, or
  // once a card has taken over. Paused, it stays, so a paused screen still says what it's showing
  const narration = !v.idle && !v.done && !v.skipping && !v.failed ? v.caption : "";
  // A refresh partway through comes back to its chapter; the card offers to carry on or start over
  const resumeAt = player.resumeAt;
  const length = show.length ?? "a few minutes";

  return (
    <div className="live-bar" ref={box} role="region" aria-label="Guided walkthrough controls">
      <div className="live-inner">
        {/* What this is, at every chapter: a fictional walkthrough, with a way to try it by hand and
            a way out that doesn't depend on anything the story is doing underneath */}
        <div className="live-meta">
          <span className="live-what"><b>Guided walkthrough</b><span className="live-fiction">Fictional<span className="wide"> project</span> · no account needed</span></span>
          <span className="live-exits">
            <a href="/1NEON/demo/">Try it<span className="wide"> yourself</span></a>
            <a href={exit.href} className="live-exit">Exit<span className="wide"> tour</span></a>
          </span>
        </div>
        {/* One segment per chapter: done ones full, the current one filling, the rest empty */}
        <div className="live-line" aria-hidden="true">
          {player.sections.map((s, i) => (
            <span key={s.id} className={i === v.index ? "now" : undefined}>
              <i style={{ transform: `scaleX(${v.done || i < v.index ? 1 : i === v.index ? v.progress : 0})` }} />
            </span>
          ))}
        </div>
        <div className="live-row">
          {/* Back and on name the neighbouring chapters; at either end the button steps aside */}
          <button className={`live-step back${prev ? "" : " none"}`} onClick={() => jump(v.index - 1)} disabled={!prev} aria-label={prev ? `Back to ${prev.title}` : undefined}>
            <ChevronLeft size={16} aria-hidden="true" /><span>{prev?.title}</span>
          </button>
          <div className="live-mid">
            {/* Before it starts the one button says Start, as the card below it does */}
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
            {/* The chapter playing, which opens the list of them. Under it, only the player's own state
                (paused, skipping ahead): the narration itself is the band under the controls */}
            <button className="live-now" onClick={openList} aria-expanded={list} aria-controls="live-list">
              <span className="live-title">{v.idle || (v.skipping && player.focused) ? show.title : v.done ? `${show.title} · the end` : `${v.index + 1}/${player.sections.length} · ${v.title}`}</span>
              {v.note && !v.idle && !v.done && !v.skipping && <span className="live-note">{v.note}</span>}
              <ChevronDown className="live-caret" size={14} aria-hidden="true" />
            </button>
          </div>
          <button className={`live-step fwd${next ? "" : " none"}`} onClick={() => jump(v.index + 1)} disabled={!next} aria-label={next ? `On to ${next.title}` : undefined}>
            <span>{next?.title}</span><ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {/* While it plays, the portal underneath doesn't take clicks, so a stray click can't knock the
          story off course. Pause to explore; resuming plays the chapter again from its start */}
      {!v.paused && !v.done && !v.idle && createPortal(<div className="live-shield" aria-hidden="true" />, document.body)}
      {/* While earlier chapters are set up out of sight (a jump ahead, a link from the FAQs), a loading
          screen in the page's own color covers them: where it's going, why it's waiting, and how far
          along it is. Its card fades in after a moment, so a quick setup never flashes one */}
      {v.skipping && createPortal(
        <div className="live-veil" role="status" aria-live="polite">
          <div className="live-load">
            <p className="live-card-eye">{player.focused ? "Guided walkthrough" : `Chapter ${v.index + 1} of ${player.sections.length}`}</p>
            <h2>{player.focused ? show.title : v.title}</h2>
            <p>Setting up the story so far, so this starts where it should. It takes a few seconds.</p>
            <div className="live-load-bar" aria-hidden="true"><i style={{ transform: `scaleX(${Math.max(0.04, v.loading)})` }} /></div>
          </div>
        </div>, document.body)}
      {/* The narration: what's happening on screen, in a band under the controls that the page starts
          below, so it never covers anything. Screen readers hear each new line */}
      {createPortal(<div className={`live-sub${narration ? " on" : ""}`} role="status" aria-live="polite"><span key={narration}>{narration}</span></div>, document.body)}

      {/* Before Start: who this is, what's coming, and how long it takes. Nothing moves until the
          visitor says so, however fast or slowly they read */}
      {v.idle && (
        <Card label="Before the walkthrough starts">
          <p className="live-card-eye">Guided walkthrough · {length} · fictional data</p>
          {resumeAt !== undefined ? (
            <>
              <h2>Pick up where you left off</h2>
              <p>You were at chapter {resumeAt + 1} of {player.sections.length}, “{player.sections[resumeAt]!.title}”, in {show.title.toLowerCase()}. Nothing was saved, so the story so far is set up again first.</p>
            </>
          ) : (
            <>
              <h2>{show.intro?.heading ?? show.title}</h2>
              {(show.intro?.text ?? [show.blurb]).map((t) => <p key={t}>{t}</p>)}
            </>
          )}
          <div className="live-card-acts">
            <button className="live-btn primary" data-first onClick={() => void player.start()}><Play size={15} aria-hidden="true" />{resumeAt !== undefined ? "Continue" : "Start"}</button>
            {resumeAt !== undefined && <button className="live-btn" onClick={() => void player.start(0)}>Start from the beginning</button>}
            <a className="live-btn" href="/1NEON/demo/">Try it yourself instead</a>
          </div>
          <p className="live-card-foot">Everything here is made up and stays in this browser. The bar above pauses, steps between chapters, and changes the speed; Space and the arrow keys do the same.</p>
        </Card>
      )}

      {/* The end: what just happened, in a sentence, and where to go from here */}
      {v.done && !list && (
        <Card label="The walkthrough has ended">
          <p className="live-card-eye">The end · {show.title}</p>
          <h2>{show.end ?? "That's the whole of it."}</h2>
          {show.recap && <p>{show.recap}</p>}
          <div className="live-card-acts">
            {short
              ? <a className="live-btn primary" data-first href="/1NEON/live?play=full">Watch the full story<small>{FULL_LENGTH}</small></a>
              : <a className="live-btn primary" data-first href="/1NEON/demo/">Try it yourself<small>the same portal, in your hands</small></a>}
            {short && <a className="live-btn" href="/1NEON/demo/">Try it yourself</a>}
            <button className="live-btn" onClick={() => player.toggle()}><RotateCcw size={14} aria-hidden="true" />Watch again</button>
            <button className="live-btn" onClick={() => setList(true)}>Other walkthroughs</button>
          </div>
          <p className="live-card-foot">
            Questions this didn't answer? <a href="/1NEON/faqs">Read the FAQs</a>, or <a href="/#contact">ask Pradeep</a>. <a href={exit.href}>{exit.label}</a>
          </p>
        </Card>
      )}

      {/* A stumble the player couldn't recover from: said plainly, with ways on, never a silent loop */}
      {v.failed && !list && (
        <Card label="The walkthrough stopped">
          <p className="live-card-eye">Stopped at chapter {v.index + 1} · {v.title}</p>
          <h2>This part didn't play as written</h2>
          <p>The walkthrough stopped rather than show you something wrong. Nothing is broken on your side, and nothing was saved or sent.</p>
          <div className="live-card-acts">
            <button className="live-btn primary" data-first onClick={() => void player.goTo(v.index)}>Play this chapter again</button>
            <button className="live-btn" onClick={() => void player.goTo(0)}>Start over</button>
            <a className="live-btn" href="/1NEON/demo/">Try it yourself instead</a>
          </div>
          <p className="live-card-foot">
            If it keeps happening, <a href={`mailto:hello@neon1.tech?subject=${encodeURIComponent(`1NEON walkthrough stopped: ${show.title}, chapter ${v.index + 1} (${v.title})`)}`}>tell neon1</a> and it gets fixed. <a href={exit.href}>{exit.label}</a>
          </p>
        </Card>
      )}

      {/* Every chapter in order, the current one marked; it unrolls downward from the bar. Below, the
          other walkthroughs (a different show loads fresh) */}
      <div id="live-list" className={`live-list${list ? " open" : ""}`} inert={!list}>
        <p className="live-list-h">{show.title}</p>
        {/* How a reload behaves, said where someone would look for it */}
        <p className="live-list-note">Nothing here is saved. A reload comes back to the same chapter, with fresh fictional data.</p>
        <ol>
          {player.sections.map((s, i) => (
            <li key={s.id}>
              <button aria-current={i === v.index && !v.done ? "step" : undefined} className={i === v.index && !v.done ? "on" : v.done || i < v.index ? "past" : ""} onClick={() => jump(i)}>
                <span className="n">{i + 1}</span>{s.title}
              </button>
            </li>
          ))}
        </ol>
        {(short || SHORTS.length > 0) && <p className="live-list-h">{short ? "Other walkthroughs" : "Short walkthroughs"}</p>}
        <ul>
          {short && <li><a href="/1NEON/live?play=full"><span className="n">▸</span><span>The full story<small>A whole project, from a first sign-in to ongoing care · {FULL_LENGTH}</small></span></a></li>}
          {SHORTS.filter((s) => s.id !== show.id).map((s) => (
            <li key={s.id}><a href={`/1NEON/live?play=${s.id}`}><span className="n">▸</span><span>{s.title}<small>{s.blurb}{s.length ? ` · ${s.length}` : ""}</small></span></a></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
