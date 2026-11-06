// The neon1.tech rain, trimmed for the sign-in screen. Still frame for reduced motion.
import { useEffect, useRef } from "react";

// Katakana and digits as on neon1.tech; WORDS surface now and then as readable columns.
const CHARS = [..."ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789neon1"];
const WORDS = ["1NEON", "needs", "execution", "observation", "next", "onion", "neon1", "listen", "propose", "decide", "build", "hand over"];

/** Full-screen canvas rain behind the sign-in panel; decorative, hidden from assistive tech. */
export function Rain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let size = 20, rows = 0, frame = 0, raf = 0;
    let cols: { y: number; word?: string; wi: number; wy: number; hold: number }[] = [];
    // Size the canvas to the window at up to 2x pixel density, and restart the columns.
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      size = innerWidth < 640 ? 17 : 21;
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rows = Math.floor(innerHeight / size);
      cols = Array.from({ length: Math.ceil(innerWidth / size) }, () => ({ y: Math.random() * rows, wi: 0, wy: 0, hold: 0 }));
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillStyle = "#0D0208";
      ctx.fillRect(0, 0, innerWidth, innerHeight);
    };
    // One frame: fade the old frame a little, then draw a character (or a word) per column.
    const draw = () => {
      ctx.fillStyle = "rgba(13, 2, 8, 0.05)";
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.font = `500 ${size}px "JetBrains Mono", ui-monospace, monospace`;
      // Occasionally start spelling a word down a free column.
      if (Math.random() < 0.05) {
        const c = cols[(Math.random() * cols.length) | 0];
        const w = WORDS[(Math.random() * WORDS.length) | 0]!;
        if (c && !c.word && c.y > 1 && c.y + w.length < rows) Object.assign(c, { word: w, wi: 0, wy: Math.floor(c.y), hold: 45 });
      }
      cols.forEach((c, i) => {
        const x = i * size + size / 2;
        if (c.word) {
          if (c.wi < c.word.length) c.wi++;
          else c.hold--;
          for (let k = 0; k < c.wi; k++) {
            const y = (c.wy + k) * size;
            ctx.fillStyle = "#0D0208";
            ctx.fillRect(i * size, y, size, size);
            ctx.shadowColor = "#6CFFA8";
            ctx.shadowBlur = 6;
            ctx.fillStyle = "#6CFFA8";
            ctx.fillText(c.word[k]!, x, y + size / 2);
            ctx.shadowBlur = 0;
          }
          if (c.hold <= 0) { c.y = c.wy + c.wi; c.word = undefined; }
          return;
        }
        const r = Math.random();
        ctx.fillStyle = r > 0.96 ? "#e9ffee" : r > 0.45 ? "#22ff7a" : "#00b84f";
        ctx.fillText(CHARS[(Math.random() * CHARS.length) | 0]!, x, Math.floor(c.y) * size + size / 2);
        c.y += 1;
        if (c.y > rows && Math.random() > 0.97) c.y = 0;
      });
    };
    // Every third animation frame, and nothing while the tab is hidden.
    const loop = () => {
      if (!document.hidden && ++frame % 3 === 0) draw();
      raf = requestAnimationFrame(loop);
    };
    resize();
    // Reduced motion: paint a settled still frame once instead of animating.
    if (reduce) for (let i = 0; i < 60; i++) draw();
    else raf = requestAnimationFrame(loop);
    addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true" />;
}
