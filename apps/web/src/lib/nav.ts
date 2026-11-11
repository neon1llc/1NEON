// apps/web/src/lib/nav.ts - The router's navigate, for code outside React (the live playback)


let go: (to: string) => void = (to) => { location.href = to; };

/** Set once by main.tsx when the router exists */
export function setNavigate(fn: (to: string) => void) {
  go = fn;
}

/** Sent on window when the guided walkthrough rewinds to a section's start: the app remounts, so
 * nothing held on screen from before (a sign-in step, an open dialog, a tour offer) greets the replay */
export const REWIND = "1neon:live-rewind";

/** Go to a route inside the app, under its base path */
export function navigate(to: string) {
  go(to);
}


// The data cache, so the playback can refresh every view after acting as someone else
type Cache = { invalidateQueries: () => Promise<void>; clear: () => void };
let cache: Cache | undefined;

/** Set once by main.tsx */
export function setCache(c: Cache) {
  cache = c;
}

/** Refetch everything on screen */
export function refreshAll() {
  return cache?.invalidateQueries();
}

/** Forget everything cached (after the data underneath changed wholesale) */
export function clearCache() {
  cache?.clear();
}
