// apps/web/src/lib/devuser.ts - Who you're being in the demo, the live playback, or local
// development. Held in memory for the tab; localStorage only remembers it across reloads, so a
// browser that refuses storage can still pick a person. Never used by the real portal's sign-in.


import { persistFailed } from "./persist.ts";


// The live playback keeps its own "who am I", so it never changes who you are in the demo
const KEY = location.pathname.startsWith("/1NEON/live") ? "1neon.liveUser" : "1neon.devUser";

// The person for this tab; undefined until first read from storage
let current: string | undefined;


/** Local development and the demo only: the API trusts the x-dev-user header there */
export const devUser = {
  // Memory first; storage is read once, and a refusal reads as nobody picked yet
  get(): string {
    if (current === undefined) {
      try {
        current = localStorage.getItem(KEY) ?? "";
      } catch {
        current = "";
        persistFailed();
      }
    }
    return current;
  },
  // Always takes effect in memory; a failed save only means a reload forgets it
  set(email: string) {
    current = email;
    try {
      if (email) localStorage.setItem(KEY, email);
      else localStorage.removeItem(KEY);
    } catch {
      persistFailed();
    }
  },
};
