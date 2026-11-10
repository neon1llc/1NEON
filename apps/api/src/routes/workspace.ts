// apps/api/src/routes/workspace.ts - One organization's frame and overview pages: the org itself,
// its workflow stages, the workspace landing, Coming up, Insights, and the audit trail.


import { Stage, canApprove, isClosed, isOwnOrg, type Tenant } from "@1neon/domain";
import { z } from "zod";
import { actorId, body, fail, need, now, who } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";


// Needs you: a preview on Home, and a bounded full list behind View all
const WAITING_PREVIEW = 10;
const WAITING_ALL = 200;


export function workspaceRoutes(app: App, k: Kit) {
  const { repo, audit, allDocs } = k;

  // The organization and the caller's access, for the web app's frame
  app.get("/t/:tid", (c) => {
    need(c, "read");
    return c.json({ org: c.get("tenant"), access: who(c).actor.operator ? "admin" : c.get("access") });
  });

  // Workflow stages: admins only, and never remove a stage that still holds a project
  app.put("/t/:tid/stages", async (c) => {
    need(c, "manage_settings");
    const input = await body(c, z.object({ version: z.number().int(), stages: z.array(Stage).min(1).max(20) }));
    const ids = new Set(input.stages.map((s) => s.id));
    if (ids.size !== input.stages.length) fail(400, "invalid", "Stage IDs must be unique.");
    const t = c.get("tenant");
    const projects = await repo.listProjects(t.id);
    const orphan = projects.find((p) => !ids.has(p.stageId));
    if (orphan) fail(400, "stage_in_use", `Move ${orphan.key} out of that stage before removing it.`);
    const next: Tenant = { ...t, stages: input.stages, version: t.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    await repo.saveTenant(next, input.version);
    await audit(c, "org.stages", t.id, "Updated workflow stages");
    return c.json(next);
  });

  // Workspace landing: hub counts, what's waiting on the caller, and recent activity
  app.get("/t/:tid/workspace", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const [projects, members, activity] = await Promise.all([repo.listProjects(t.id), repo.listMembers(t.id), repo.listAudit(t.id, 16)]);
    // Members by id, to name who did what
    const names = new Map(members.map((m) => [m.userId, m.name || m.email]));
    const live = projects.filter((p) => !p.archived);
    const me = actorId(c);
    const { actor } = who(c);
    // Needs you: a choice between options you may approve, files the client is asked for, and your
    // open work. A project's proposed options are one decision, so they wait as one entry
    const waiting: { projectId: string; projectKey: string; projectName: string; itemId: string; title: string; kind: string; action: "choose" | "upload" | "do"; count?: number; dueDate?: string }[] = [];
    for (const p of live) {
      const items = await repo.listItems(t.id, p.id);
      // A project with an approved option no longer asks anyone to approve the others
      const decider = canApprove(actor, c.get("access"), p.people, isOwnOrg(t.slug)).ok && !items.some((i) => i.kind === "option" && i.status === "approved");
      const options = decider ? items.filter((i) => i.kind === "option" && i.status === "proposed").sort((a, b) => a.title.localeCompare(b.title)) : [];
      if (options.length) waiting.push({ projectId: p.id, projectKey: p.key, projectName: p.name, itemId: options[0]!.id, title: "Choose an option", kind: "option", action: "choose", count: options.length });
      for (const i of items) {
        const action = i.kind === "file_request" && i.status !== "done" && !actor.operator ? "upload"
          : i.kind !== "option" && i.assigneeId === me && i.status !== "done" ? "do" : undefined;
        if (action) waiting.push({ projectId: p.id, projectKey: p.key, projectName: p.name, itemId: i.id, title: i.title, kind: i.kind, action, dueDate: i.dueDate });
      }
    }
    // Choices first, then files to send, then work; within each, the earliest due date first and
    // undated last, so the preview shows what's most pressing
    const order = { choose: 0, upload: 1, do: 2 };
    waiting.sort((a, b) => order[a.action] - order[b.action] || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title));
    // Home shows a preview of ten; ?waiting=all (the View all list) returns up to WAITING_ALL. The total
    // is always the true count, so the page never presents a preview as everything
    const limit = c.req.query("waiting") === "all" ? WAITING_ALL : WAITING_PREVIEW;
    // The latest written update on each live project, newest first
    const updates: { projectKey: string; projectName: string; title: string; body: string; health: string; at: string; by: string }[] = [];
    for (const p of live) {
      const u = (await repo.listItems(t.id, p.id)).filter((i) => i.kind === "update").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (u) updates.push({ projectKey: p.key, projectName: p.name, title: u.title, body: u.body, health: String(u.fields.health ?? p.health), at: u.createdAt, by: u.updatedBy });
    }
    updates.sort((a, b) => b.at.localeCompare(a.at));
    const stageName = new Map(t.stages.map((s) => [s.id, s]));
    return c.json({
      counts: {
        projects: live.length,
        deciding: live.filter((p) => stageName.get(p.stageId)?.id === "decide").length,
        building: live.filter((p) => stageName.get(p.stageId)?.layer === "execution").length,
        people: members.filter((m) => m.status !== "deactivated").length,
        invited: members.filter((m) => m.status === "invited").length,
        documents: (await allDocs(t.id, live.map((p) => p.id))).length,
      },
      waiting: waiting.slice(0, limit),
      waitingTotal: waiting.length,
      updates: updates.slice(0, 5),
      // What people did: sign-ins aren't doing anything, so the feed leaves them out (the
      // notification for them still goes to whoever asked for it). Each row names who did it
      activity: activity.filter((a) => a.action !== "member.signedin").map((a) => ({ ...a, by: names.get(a.actorId) ?? (a.actorId === "system" ? "" : "neon1") })),
    });
  });

  // Coming up: dated work (due items, milestones, project targets) up to six weeks ahead. Overdue work
  // and overdue targets of projects not yet closed stay listed however old they are; a target more
  // than two weeks past on a closed project has been dealt with and drops off
  app.get("/t/:tid/upcoming", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const live = (await repo.listProjects(t.id)).filter((p) => !p.archived);
    const today = now().slice(0, 10);
    const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 42 * 864e5).toISOString().slice(0, 10);
    // requestedTiming: the person's own words for a request's timing ("this month"), beside its date
    const events: { date: string; title: string; projectKey: string; kind: string; itemId?: string; overdue: boolean; mine: boolean; requestedTiming?: string }[] = [];
    const me = actorId(c);
    for (const p of live) {
      const open = !isClosed(t.stages, p.stageId);
      if (p.targetDate && (p.targetDate >= from || open) && p.targetDate <= to) events.push({ date: p.targetDate, title: `${p.name} target`, projectKey: p.key, kind: "target", overdue: p.targetDate < today, mine: false });
      for (const i of await repo.listItems(t.id, p.id)) {
        if (!i.dueDate || i.status === "done" || i.status === "approved" || i.dueDate > to) continue;
        // Overdue items stay listed however old they are; future ones only up to six weeks out
        events.push({ date: i.dueDate, title: i.title, projectKey: p.key, kind: i.kind, itemId: i.id, overdue: i.dueDate < today, mine: i.assigneeId === me, requestedTiming: i.requestedTiming });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    return c.json({ today, from, to, events });
  });

  // Insights: default charts from the organization's own data, computed on request
  app.get("/t/:tid/insights", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const projects = (await repo.listProjects(t.id)).filter((p) => !p.archived);
    const members = await repo.listMembers(t.id);
    const layerOf = new Map(t.stages.map((s) => [s.id, s.layer]));
    const byLayer = { needs: 0, execution: 0, observation: 0, next: 0 } as Record<string, number>;
    const byHealth = { on_track: 0, at_risk: 0, off_track: 0, not_started: 0 } as Record<string, number>;
    const doneByWeek = new Map<string, number>();
    // doneUnknown: items done before completion times were recorded; they count as done, but in no
    // week and in neither on-time nor late, because their real finish date isn't known
    let open = 0, overdue = 0, onTime = 0, late = 0, doneUnknown = 0, measures = 0, reached = 0;
    const decisionDays: number[] = [];
    const today = now().slice(0, 10);
    // Monday of the week a date falls in, so weeks line up
    const week = (iso: string) => { const d = new Date(iso.slice(0, 10) + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
    for (const p of projects) {
      byLayer[layerOf.get(p.stageId) ?? "needs"]!++;
      byHealth[p.health] = (byHealth[p.health] ?? 0) + 1;
      const items = await repo.listItems(t.id, p.id);
      const created = new Map(items.map((i) => [i.id, i.createdAt]));
      for (const i of items) {
        if (i.kind === "metric") {
          measures++;
          const f = i.fields as { baseline?: number; target?: number; readings?: { value: number }[] };
          const last = f.readings?.at(-1)?.value;
          if (last !== undefined && f.target !== undefined && f.baseline !== undefined && (f.target < f.baseline ? last <= f.target : last >= f.target)) reached++;
          continue;
        }
        if (i.kind === "decision") {
          const opt = created.get(String(i.fields.optionId));
          if (opt) decisionDays.push((Date.parse(String(i.fields.approvedAt)) - Date.parse(opt)) / 864e5);
          continue;
        }
        if (i.status === "done") {
          // Finished means the recorded completion time, never the last edit (updatedAt moves on edits)
          if (!i.completedAt) {
            doneUnknown++;
            continue;
          }
          const wk = week(i.completedAt);
          doneByWeek.set(wk, (doneByWeek.get(wk) ?? 0) + 1);
          if (i.dueDate) (i.completedAt.slice(0, 10) <= i.dueDate ? onTime++ : late++);
        } else if (i.kind !== "update" && i.status !== "approved") {
          open++;
          if (i.dueDate && i.dueDate < today) overdue++;
        }
      }
    }
    // The last eight weeks of finished work, oldest first, zero-filled
    const weeks: { week: string; done: number }[] = [];
    for (let k = 7; k >= 0; k--) {
      const wk = week(new Date(Date.now() - k * 7 * 864e5).toISOString());
      weeks.push({ week: wk, done: doneByWeek.get(wk) ?? 0 });
    }
    return c.json({
      projects: projects.length,
      byLayer,
      byHealth,
      weeks,
      work: { open, overdue, onTime, late, doneUnknown },
      decisions: { count: decisionDays.length, avgDays: decisionDays.length ? Math.round((decisionDays.reduce((a, b) => a + b, 0) / decisionDays.length) * 10) / 10 : null },
      measures: { count: measures, reached },
      people: { active: members.filter((m) => m.status === "joined").length, invited: members.filter((m) => m.status === "invited").length },
    });
  });

  // The audit trail, newest first
  app.get("/t/:tid/activity", async (c) => {
    need(c, "read");
    return c.json(await repo.listAudit(c.get("tenant").id, 100));
  });
}
