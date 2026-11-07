// apps/web/public/arrive.js - Arrival from neon1.tech. The site sets sessionStorage "neon1.handoff"
// and fades to its black rain before opening 1NEON; this runs before the first paint so the screen
// stays black, and the app fades the sign-in in. It's a plain script because the page's CSP allows
// only same-origin scripts, never inline ones.


// Take the flag once, so a reload or a later visit loads as usual; storage can throw in private browsing
try {
  if (sessionStorage.getItem("neon1.handoff") === "1") {
    sessionStorage.removeItem("neon1.handoff");
    document.documentElement.classList.add("from-site");
  }
} catch {
  // No storage, no fade
}


// The app's bundle failing to load (offline, blocked, or a stale page after a deploy) would leave a
// blank screen, so the shell's plain fallback message is shown instead. Script errors don't bubble,
// so this listens in the capture phase
addEventListener("error", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLScriptElement || el instanceof HTMLLinkElement) || !/\/1NEON\/assets\//.test(el.src || el.href || "")) return;
  const msg = document.getElementById("boot-failed");
  if (msg) msg.hidden = false;
  document.documentElement.classList.remove("from-site");
}, true);
