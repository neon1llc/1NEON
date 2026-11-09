// apps/web/src/components/Reads.tsx - One way to show a read that isn't ready: loading, a failure with
// Try again and a way out, a note when shown data couldn't be refreshed, and the page-level boundary
// for a render that throws.


import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate, useRouteError } from "react-router";
import { failureOf, hidesData, offline } from "../lib/reads.ts";
import { ago } from "./ui.tsx";


/** The parts of a query these pieces read; any useQuery result fits */
export type Read = Pick<UseQueryResult<unknown, Error>, "data" | "error" | "isError" | "isFetching" | "refetch" | "dataUpdatedAt">;


/** Where "a way out" goes when the page in view can't load */
export interface Out {
  to: string;
  label: string;
}
// Home is always safe: Root sends the person to their own first organization
const HOME: Out = { to: "/", label: "Go to my workspace" };


/** Ask Root to check the session again; a 401 there shows sign-in */
export const signInAgain = () => dispatchEvent(new CustomEvent("1neon:signed-out"));


// --- Pending and failed ---------------------------------------------------------


/** A loading line that says what it's waiting for; the query's own retries and timeout bound it */
export function Loading({ what = "Loading…" }: { what?: string }) {
  return <p className="muted" aria-busy="true">{what}</p>;
}


/** Words for each kind of failure. 403 and 404 share one, so nothing hints at what exists elsewhere */
function words(error: unknown): { title: string; text: string } {
  switch (failureOf(error)) {
    case "session":
      return { title: "Your sign-in has ended", text: "Sign in again to pick up where you left off." };
    case "unavailable":
      return { title: "Not available", text: "This isn't here, or you don't have access to it." };
    case "busy":
      return { title: "1NEON is busy", text: "Too much at once just now. Wait a moment, then try again." };
    default:
      return offline(error)
        ? { title: "Couldn't reach 1NEON", text: "Check your connection, then try again." }
        : { title: "Something went wrong", text: "This didn't load properly. Try again in a moment." };
  }
}


/** A failed read: what happened, Try again (or Sign in again), and a link out */
export function Problem({ error, reads, out = HOME, compact }: { error: unknown; reads: Read[]; out?: Out; compact?: boolean }) {
  const kind = failureOf(error);
  const { title, text } = words(error);
  const retrying = reads.some((q) => q.isFetching);
  // Retry only what failed; reads that already worked keep their data
  const retry = () => { for (const q of reads) if (q.isError) void q.refetch(); };
  // Sign in again checks the session (an ended one shows sign-in) and retries, in case only this read lost it
  const act = kind === "session"
    ? <button className="btn btn-primary btn-sm" type="button" onClick={() => { signInAgain(); retry(); }}>Sign in again</button>
    : kind === "unavailable"
      ? null
      : <button className="btn btn-primary btn-sm" type="button" onClick={retry} disabled={retrying}>{retrying ? "Trying again…" : "Try again"}</button>;
  return (
    <div className={`problem${compact ? " compact" : ""}`} role="alert">
      <p><b>{title}.</b> {text}</p>
      <div className="problem-acts">
        {act}
        {!compact && <Link className="btn btn-ghost btn-sm" to={out.to}>{out.label}</Link>}
      </div>
    </div>
  );
}


/**
 * The gate a page puts before its content: null once every read has data to show, otherwise the
 * loading line or the failure. A sign-in or access failure replaces even data already on screen,
 * since the person may no longer be allowed to see it; other failures keep the data (see Stale)
 */
export function gate(reads: Read[], opts: { out?: Out; what?: string; compact?: boolean } = {}): ReactNode | null {
  const blocking = reads.find((q) => q.isError && (q.data === undefined || hidesData(failureOf(q.error))));
  if (blocking) return <Problem error={blocking.error} reads={reads} out={opts.out} compact={opts.compact} />;
  if (reads.some((q) => q.data === undefined)) return <Loading what={opts.what} />;
  return null;
}


/** Marks data that's still on screen after a refresh failed, with when it was loaded and Try again */
export function Stale({ reads }: { reads: Read[] }) {
  const failed = reads.filter((q) => q.isError && q.data !== undefined && !hidesData(failureOf(q.error)));
  if (!failed.length) return null;
  // The oldest of the shown reads is what the note has to own up to
  const at = Math.min(...failed.map((q) => q.dataUpdatedAt));
  const retrying = failed.some((q) => q.isFetching);
  return (
    <p className="notice stale" role="status">
      <span>Couldn't refresh just now, so this may be out of date (loaded {ago(new Date(at).toISOString())}).</span>
      <button className="linkish" type="button" onClick={() => { for (const q of failed) void q.refetch(); }} disabled={retrying}>{retrying ? "Trying again…" : "Try again"}</button>
    </p>
  );
}


// --- Route boundary -------------------------------------------------------------


/** Shown in place of a page whose render threw. Inside an organization the frame and its menu stay
 * usable around it (inFrame); at the top level it stands alone */
export function RouteError({ inFrame }: { inFrame?: boolean }) {
  const error = useRouteError();
  const nav = useNavigate();
  const loc = useLocation();
  // Logged for whoever is debugging; the page itself only offers a way forward
  console.error(error);
  const qc = useQueryClient();
  // Try again drops the page's cached reads (a bad record would only throw again), keeping the session
  // so the app doesn't flash back to loading; navigating to the same address clears the router's error
  const again = () => {
    void qc.resetQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    void nav(loc.pathname + loc.search + loc.hash, { replace: true });
  };
  const body = (
    <div className="problem" role="alert">
      <p><b>This page hit a problem.</b> Something on it didn't work. Try again, or go back to your workspace.</p>
      <div className="problem-acts">
        <button className="btn btn-primary btn-sm" type="button" onClick={again}>Try again</button>
        <Link className="btn btn-ghost btn-sm" to="/">{HOME.label}</Link>
      </div>
    </div>
  );
  return inFrame ? body : <main className="content" id="main">{body}</main>;
}
