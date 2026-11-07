// apps/web/src/components/Glitch.tsx - A word that glitches like a dropped Matrix signal, and the
// screen shown when 1NEON can't be reached.


import { useEffect } from "react";
import { Rain } from "./Rain.tsx";


/** Text that tears and splits in short bursts; still under reduced motion */
export function GlitchWord({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`glitch ${className}`} data-text={text}>
      {text}
    </span>
  );
}


/** The lost-signal screen: the rain, a glitching 1NEON, and a retry that also runs on its own */
export function Offline({ onRetry, server }: { onRetry: () => void; server?: boolean }) {
  // Try again when the connection returns, and every 10 seconds while the page is in view
  useEffect(() => {
    const again = () => !document.hidden && onRetry();
    addEventListener("online", again);
    const timer = setInterval(again, 10_000);
    return () => {
      removeEventListener("online", again);
      clearInterval(timer);
    };
  }, [onRetry]);
  return (
    <main className="signin">
      <Rain panes=".signin .panel, .rainctl button" />
      <div className="veil" />
      <div className="panel glass lost" role="alert">
        <h1 className="word"><GlitchWord text="1NEON" /></h1>
        <p className="lost-title">{server ? "Something broke on our end." : "Lost the signal."}</p>
        <p className="fine">{server ? "Give it a moment. 1NEON will try again on its own." : "Check your connection. 1NEON will try again on its own."}</p>
        <button className="btn btn-primary" type="button" onClick={onRetry}>Try again</button>
        <p className="fine"><a href="/">Back to neon1.tech</a></p>
      </div>
    </main>
  );
}
