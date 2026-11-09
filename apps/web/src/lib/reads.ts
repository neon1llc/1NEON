// apps/web/src/lib/reads.ts - What a failed read means for the person looking at it, and the shape
// checks that turn a malformed reply into a failure instead of a blank or crashing page.


import { api, HttpError } from "./api.ts";


// --- What went wrong ------------------------------------------------------------


/**
 * Every failed read lands in one of four buckets, each with its own screen:
 * - session: the sign-in ended (401), so the way out is signing in again
 * - unavailable: 403 or 404, worded the same so nobody learns what exists in another organization
 * - busy: 429 or 503, worth trying again in a moment
 * - broken: a server error, a dropped connection, or a reply that isn't what the page expects
 */
export type ReadFailure = "session" | "unavailable" | "busy" | "broken";


/** Sort a query's error into the bucket that decides what the page says */
export function failureOf(e: unknown): ReadFailure {
  if (e instanceof HttpError) {
    if (e.status === 401) return "session";
    if (e.status === 403 || e.status === 404) return "unavailable";
    if (e.status === 429 || e.status === 503) return "busy";
  }
  return "broken";
}


/** True when old data must not stay on screen: the person may no longer be allowed to see it */
export const hidesData = (f: ReadFailure) => f === "session" || f === "unavailable";


/** True when the browser never got an answer at all, so the advice is about the connection */
export const offline = (e: unknown) => !(e instanceof HttpError) && !(e instanceof BadReply);


// --- Shape checks -----------------------------------------------------------------


/** A 2xx reply whose body isn't what the page needs (not JSON, empty, or the wrong shape) */
export class BadReply extends Error {
  constructor(readonly path: string) {
    super(`Unexpected reply from ${path}`);
  }
}


// A plain object, the only thing a field check can look inside
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);


/** What each field must be: an array, an object, a number, or a string */
type Field = "array" | "object" | "number" | "string";
const fits = (v: unknown, f: Field) => (f === "array" ? Array.isArray(v) : f === "object" ? isObj(v) : typeof v === f);


/**
 * Check a reply before the page sees it: `"array"` for a list, or the fields an object must have.
 * Only the fields a page reads before anything else are checked; deeper records are trusted to the
 * API's own schemas. A mismatch throws BadReply, which the page shows as "something went wrong"
 */
export function expectShape<T>(path: string, data: unknown, shape: "array" | Record<string, Field>): T {
  if (shape === "array") {
    if (!Array.isArray(data)) throw new BadReply(path);
    return data as T;
  }
  if (!isObj(data)) throw new BadReply(path);
  for (const [k, f] of Object.entries(shape)) if (!fits(data[k], f)) throw new BadReply(path);
  return data as T;
}


/** GET a path and check its shape before any page sees it */
export async function read<T>(path: string, shape: "array" | Record<string, Field>): Promise<T> {
  return expectShape<T>(path, await api<unknown>(path), shape);
}
