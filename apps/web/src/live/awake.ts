// apps/web/src/live/awake.ts - Keeps the screen lit while a walkthrough plays. A phone dims and locks
// after a short while without a touch, and a walkthrough is minutes of watching. The browser's Screen
// Wake Lock does it where it exists (iPhone, Android, and desktop browsers of the last few years);
// elsewhere, and when the browser says no (low battery, a power-saving mode), nothing changes.
// Nothing is stored, and the lock ends on pause, at the end, and when the tab is left.


// The lock held now, and whether the walkthrough wants one (it may be asked for while the tab is hidden)
type Lock = { release: () => Promise<void>; addEventListener: (type: "release", fn: () => void) => void };
let lock: Lock | undefined;
let wanted = false;
let asking = false;

async function hold() {
  const wake = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Lock> } }).wakeLock;
  if (!wake || lock || asking || !wanted || document.hidden) return;
  asking = true;
  try {
    const got = await wake.request("screen");
    // The browser drops the lock itself when the tab is hidden; forget it, and ask again on return
    got.addEventListener("release", () => { if (lock === got) lock = undefined; });
    lock = got;
    // Paused while the request was on its way: let it go again
    if (!wanted) drop();
  } catch {
    // Refused: the screen follows the phone's own timer, as before
  }
  asking = false;
}

function drop() {
  const held = lock;
  lock = undefined;
  void held?.release().catch(() => undefined);
}

// Back on the tab with the walkthrough still playing: take the lock again
document.addEventListener("visibilitychange", () => { if (!document.hidden) void hold(); });

/** Keep the screen on while `on` is true (the walkthrough is moving); let it dim as usual otherwise */
export function keepAwake(on: boolean) {
  if (on === wanted) return;
  wanted = on;
  if (on) void hold();
  else drop();
}
