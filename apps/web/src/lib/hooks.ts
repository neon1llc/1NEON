// Shared queries and small helpers for pages inside an organization.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@1neon/domain";
import { api, HttpError } from "./api.ts";
import type { MemberRow, ProjectDetail } from "./types.ts";

export const qk = {
  projects: (tid: string) => ["projects", tid] as const,
  project: (tid: string, pid: string) => ["project", tid, pid] as const,
  members: (tid: string) => ["members", tid] as const,
  workspace: (tid: string) => ["workspace", tid] as const,
};

export function useProjects(tid: string) {
  return useQuery({ queryKey: qk.projects(tid), queryFn: () => api<Project[]>(`/t/${tid}/projects`) });
}

export function useProject(tid: string, pid: string | undefined) {
  return useQuery({ queryKey: qk.project(tid, pid ?? ""), queryFn: () => api<ProjectDetail>(`/t/${tid}/projects/${pid}`), enabled: Boolean(pid), refetchInterval: 15_000 });
}

export function useMembers(tid: string) {
  return useQuery({ queryKey: qk.members(tid), queryFn: () => api<MemberRow[]>(`/t/${tid}/members`) });
}

/** Refresh everything that depends on an organization's data. */
export function useRefresh(tid: string) {
  const qc = useQueryClient();
  return () => {
    for (const key of [["projects", tid], ["project", tid], ["workspace", tid], ["members", tid]]) qc.invalidateQueries({ queryKey: key });
  };
}

/** A sentence a person can act on, whatever went wrong. */
export function problem(e: unknown) {
  if (e instanceof HttpError) {
    if (e.body.error === "strong_auth_required") return "This needs a second step at sign-in. Add an authenticator app or a passkey, then sign in again.";
    return e.body.message;
  }
  return "Couldn't reach 1NEON. Check your connection and try again.";
}

export const byRank = <T extends { rank: string }>(a: T, b: T) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
