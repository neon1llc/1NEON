// apps/web/src/live/where.ts - Which show /1NEON/live plays, and where in it. ?play= names a short
// demo or a section of the whole project; a refresh partway through picks up where it was. Read
// once at load, before the in-browser API seeds, so the seed and the player agree.


// The short demos, by the id their ?play= link uses (their sections live in shorts.ts)
export const SHORT_IDS = ["invite", "passkey", "authenticator", "texts"] as const;
export type ShortId = (typeof SHORT_IDS)[number];

// The whole project's id, for the saved place
export const PROJECT = "project";

/** What to play: a show, and optionally the section of it to start at */
export interface Play {
  show: ShortId | typeof PROJECT;
  at?: string;
}


// The saved place, per tab, so a refresh resumes rather than replaying from the top
const KEY = "1neon.live";

/** Remember the section now playing; a refresh of a page deep in the playback comes back to it */
export function remember(p: Play) {
  try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked: a refresh starts over */ }
}

// Is this one of the short demos?
const isShort = (id: string | null | undefined): id is ShortId => SHORT_IDS.includes(id as ShortId);


/**
 * Decide once per page load. A ?play= link wins. Otherwise a page deep inside the playback (the
 * address moves as the story navigates) is a refresh, so it resumes at the saved section; the bare
 * /1NEON/live starts the whole project from the top.
 */
export const PLAY: Play = (() => {
  const param = new URLSearchParams(location.search).get("play");
  if (isShort(param)) return { show: param };
  if (param) return { show: PROJECT, at: param };
  const deep = !/^\/1NEON\/live\/?$/.test(location.pathname);
  if (deep) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Play | null;
      if (saved && (saved.show === PROJECT || isShort(saved.show))) return saved;
    } catch { /* unreadable: start over */ }
  }
  return { show: PROJECT };
})();
