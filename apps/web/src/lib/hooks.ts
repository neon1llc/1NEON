// apps/web/src/lib/hooks.ts - Shared queries and small helpers for pages inside an organization.


import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { Project } from "@1neon/domain";
import { HttpError } from "./api.ts";
import { read } from "./reads.ts";
import type { MemberRow, ProjectDetail } from "./types.ts";


// Query keys, so pages and refreshes agree on what to invalidate
export const qk = {
  projects: (tid: string) => ["projects", tid] as const,
  project: (tid: string, pid: string) => ["project", tid, pid] as const,
  members: (tid: string) => ["members", tid] as const,
  workspace: (tid: string) => ["workspace", tid] as const,
};


/** Every project in the organization (archived included; pages filter) */
export function useProjects(tid: string) {
  return useQuery({ queryKey: qk.projects(tid), queryFn: () => read<Project[]>(`/t/${tid}/projects`, "array") });
}


/** One project, re-fetched every 15 seconds so edit markers and others' changes show up */
export function useProject(tid: string, pid: string | undefined) {
  return useQuery({ queryKey: qk.project(tid, pid ?? ""), queryFn: () => read<ProjectDetail>(`/t/${tid}/projects/${pid}`, { project: "object", items: "array", docs: "array", edits: "array" }), enabled: Boolean(pid), refetchInterval: 15_000 });
}


/** Members with profile details, for names, avatars, and the People table */
export function useMembers(tid: string) {
  return useQuery({ queryKey: qk.members(tid), queryFn: () => read<MemberRow[]>(`/t/${tid}/members`, "array") });
}


/** After a write, refetch every query for the organization */
export function useRefresh(tid: string) {
  const qc = useQueryClient();
  return () => {
    for (const key of [["projects", tid], ["project", tid], ["workspace", tid], ["members", tid]]) qc.invalidateQueries({ queryKey: key });
  };
}


/**
 * One submit at a time: run(fn) ignores calls while the last one is still going, so a double click or
 * a second Enter can't post twice; pending drives the button's disabled state and label
 */
export function useSubmit() {
  // The ref answers at once, before React re-renders with the disabled button
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await fn();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);
  return [pending, run] as const;
}


/** A sentence a person can act on, whatever went wrong */
export function problem(e: unknown) {
  if (e instanceof HttpError) {
    if (e.body.error === "strong_auth_required") return "Confirm it's you first, with a passkey, an authenticator app, or a text code.";
    return e.body.message;
  }
  return "Couldn't reach 1NEON. Check your connection and try again.";
}


/** Order by fractional rank, as the board does */
export const byRank = <T extends { rank: string }>(a: T, b: T) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
