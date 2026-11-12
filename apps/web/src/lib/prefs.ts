// apps/web/src/lib/prefs.ts - Small view preferences (a page's list or timeline, the last organization)
// kept in this browser. The live playback keeps its own copy in memory: Maria's clicks never change
// the visitor's own choices, and the visitor's choices never change what the playback finds on screen


import { LIVE } from "./api.ts";


// The playback's preferences, for this page load only
const live = new Map<string, string>();


/** Read one preference; storage that's blocked or full reads as the default */
function get(key: string, fallback: string): string;
function get(key: string): string | null;
function get(key: string, fallback?: string): string | null {
  if (LIVE) return live.get(key) ?? fallback ?? null;
  try { return localStorage.getItem(key) ?? fallback ?? null; } catch { return fallback ?? null; }
}

/** Write one preference; a refusal keeps it for this view only */
function set(key: string, value: string) {
  if (LIVE) return void live.set(key, value);
  try { localStorage.setItem(key, value); } catch { /* private mode or full */ }
}

export const prefs = { get, set };
