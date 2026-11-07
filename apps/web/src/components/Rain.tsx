// apps/web/src/components/Rain.tsx - The neon1.tech rain behind the sign-in screen, loaded from
// the site's shared module so both stay one design. Controls match the site's.


import { useEffect, useRef, useState } from "react";


// The site serves the shared rain at /shared/rain.js; this is the part of its interface used here
interface RainApi {
  readonly running: boolean;
  readonly mode: string;
  readonly charset: string;
  setRunning(on: boolean): void;
  toggleMode(): void;
  nextCharset(): void;
  subscribe(f: (r: RainApi) => void): () => void;
  stop(): void;
}
interface WordGroup { weight: number; color: string; alpha: number; glow?: number; words: string[] }
interface RainModule {
  rain(opts: { canvas: HTMLCanvasElement; lens?: HTMLCanvasElement; panes?: () => Iterable<Element>; words?: WordGroup[] }): RainApi;
}
const SHARED = "/shared/rain.js";

// 1NEON's stages and verbs in gold, neon1's own names in its green
const WORDS: WordGroup[] = [
  { weight: 3, color: "#ffd77a", alpha: 0.95, words: ["needs", "execute", "observe", "normalize", "listen", "propose", "decide", "build", "hand over"] },
  { weight: 2, color: "#6CFFA8", alpha: 1, glow: 6, words: ["1NEON", "neon1", "onion"] },
];


/** Full-screen rain with a lens behind the `panes` selector, plus the site's grid, charset, and pause controls */
export function Rain({ panes }: { panes: string }) {
  const rainRef = useRef<HTMLCanvasElement>(null);
  const lensRef = useRef<HTMLCanvasElement>(null);
  const [api, setApi] = useState<RainApi | null>(null);
  const [, redraw] = useState(0);
  // Load the shared module once; without it the sign-in still works on a plain dark screen
  useEffect(() => {
    let r: RainApi | undefined, off: (() => void) | undefined, gone = false;
    import(/* @vite-ignore */ SHARED)
      .then((m: RainModule) => {
        if (gone) return;
        r = m.rain({ canvas: rainRef.current!, lens: lensRef.current!, panes: () => document.querySelectorAll(panes), words: WORDS });
        off = r.subscribe(() => redraw((n) => n + 1));
        setApi(r);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      off?.();
      r?.stop();
    };
  }, [panes]);
  // Decorative canvases are hidden from assistive tech; the controls are not
  return (
    <>
      <canvas id="rain" ref={rainRef} aria-hidden="true" />
      <canvas id="lens" ref={lensRef} aria-hidden="true" />
      {api && (
        <div className="rainctl" role="group" aria-label="Rain controls">
          <button type="button" title="Rain motion: grid or free. Click to switch." onClick={() => api.toggleMode()}>{api.mode}</button>
          <button type="button" title="Rain characters. Click to cycle." onClick={() => api.nextCharset()}>{api.charset}</button>
          <button type="button" aria-pressed={!api.running} onClick={() => api.setRunning(!api.running)}>{api.running ? "pause" : "play"}</button>
        </div>
      )}
    </>
  );
}
