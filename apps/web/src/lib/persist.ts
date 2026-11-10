// apps/web/src/lib/persist.ts - Whether the demo can keep anything on this device. Browser storage
// (localStorage or IndexedDB) can be blocked or full; the demo then runs from memory, and the page
// says it lasts until the tab closes or reloads instead of failing silently.


import { useSyncExternalStore } from "react";


// Set once any save on this device fails; it stays set for the life of the tab
let failed = false;
const listeners = new Set<() => void>();


/** Note that a save on this device failed (storage denied, missing, or out of room) */
export function persistFailed() {
  if (failed) return;
  failed = true;
  for (const fn of listeners) fn();
}

/** True while every save so far has worked */
export const persisting = () => !failed;


/** For components: re-renders when saving stops working */
export function usePersisting() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => void listeners.delete(fn); },
    persisting,
  );
}


/** Forget a failure (tests only) */
export function resetPersist() {
  failed = false;
}
