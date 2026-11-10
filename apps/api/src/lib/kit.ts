// apps/api/src/lib/kit.ts - What every route module is handed: the app's dependencies and the
// tenant-scoped lookups and guards that several features share.


import { canNameDecider, deciderIds, isOwnOrg, fileState, type Project } from "@1neon/domain";
import type { Context, Hono } from "hono";
import type { CognitoAuth } from "../auth.ts";
import type { Config } from "../config.ts";
import type { Directory, Mailer, Storage, Texter } from "../services.ts";
import type { Repo } from "../store/repo.ts";
import type { NeoModel } from "../neo/agent.ts";
import type { NeoBudget } from "../routes/neo.ts";
import type { WriteOp } from "../store/types.ts";
import { actorId, check, fail, who, type Env } from "./http.ts";


/** Everything the app needs from outside; tests and local dev pass in-memory versions */
export interface Deps {
  cfg: Config;
  repo: Repo;
  directory: Directory;
  mailer: Mailer;
  storage: Storage;
  // Optional: without it, nobody gets texts
  texter?: Texter;
  auth?: CognitoAuth;
  // "worker": a scheduled worker sends queued messages (production). "inline" (the default): sent
  // right after the change, for local runs, tests, and the browser demo
  outbox?: "inline" | "worker";
  // Optional: Neo for signed-in people (Bedrock in production). Without it, /neo answers 503
  neo?: { model: NeoModel; modelId: string; budget?: NeoBudget };
}


// The one Hono app every route module registers on, in the order createApp calls them
export type App = Hono<Env>;


/** Build the shared kit once per app; route modules destructure what they use */
export function kit(d: Deps, drainNow: (queued: WriteOp[]) => Promise<void>) {
  const { repo, cfg } = d;

  /** The project in :pid within this tenant; trashed projects are gone as far as routes are concerned */
  async function project(c: Context<Env>, allow: { archived?: boolean } = {}) {
    const p = await repo.getProject(c.get("tenant").id, c.req.param("pid")!);
    if (!p || p.deletedAt) fail(404, "not_found", "That project doesn't exist or was deleted.");
    // Archived projects read as usual but refuse changes, except the routes that unarchive or trash them
    const reading = c.req.method === "GET" || c.req.method === "HEAD";
    if (p.archived && !reading && !allow.archived) fail(409, "archived", "This project is archived. Unarchive it to make changes.");
    return p;
  }

  /**
   * A change to who decides needs a confirmed client admin (canNameDecider), and the operator is never
   * named. Returns "old → new" names for the audit record, or undefined when the decision makers stay
   */
  async function deciderChange(c: Context<Env>, before: Project["people"], after: Project["people"]) {
    const was = deciderIds(before);
    const now_ = deciderIds(after);
    if (was.join() === now_.join()) return undefined;
    const own = isOwnOrg(c.get("tenant").slug);
    check(canNameDecider(who(c).actor, c.get("access"), own));
    const users = new Map((await Promise.all([...new Set([...was, ...now_])].map((id) => repo.getUser(id)))).filter((u) => u).map((u) => [u!.id, u!]));
    // A client's decider can't be neon1, which proposes; in neon1's own organization it can
    if (!own && now_.some((id) => cfg.operatorEmails.includes(users.get(id)?.email ?? ""))) fail(400, "operator_decider", "neon1 proposes the options, so it can't be this organization's decision maker. Name someone from the organization.");
    const list = (ids: string[]) => ids.map((id) => users.get(id)?.name || users.get(id)?.email || id).join(", ") || "nobody";
    return `${list(was)} → ${list(now_)}`;
  }

  /** Refuse anyone who isn't an active member of the organization (assignees, project people) */
  async function activeMembers(tid: string, uids: string[]) {
    for (const uid of new Set(uids)) {
      const m = await repo.getMember(tid, uid);
      if (!m || m.status === "deactivated") fail(400, "not_member", "Choose someone who is in this organization.");
    }
  }

  /** Record an audit event on its own (most writes add theirs to the same transaction instead) */
  async function audit(c: Context<Env>, action: string, target: string, summary: string) {
    await repo.table.write([repo.auditOp({ tenantId: c.get("tenant").id, actorId: actorId(c), action, target, summary })]);
  }

  /**
   * Every file past its upload link in the organization: the general files and each live project's.
   * Files still checking, or that failed, are listed with their state so nobody uploads twice
   */
  async function allDocs(tid: string, pids: string[]) {
    const lists = await Promise.all([repo.listDocs(tid, undefined), ...pids.map((pid) => repo.listDocs(tid, pid))]);
    return lists.flat().filter((x) => fileState(x) !== "receiving").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return { d, repo, cfg, drainNow, project, deciderChange, activeMembers, audit, allDocs };
}


export type Kit = ReturnType<typeof kit>;
