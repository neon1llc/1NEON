// apps/api/src/routes/notifications.ts - The bell: recent events by others in one organization, and
// marking them seen. Sending notices is the outbox's job (lib/transactions.ts, outbox.ts).


import { groupOf, KIND_LAYER, type AuditEvent, type ItemKind, type Layer, type Project } from "@1neon/domain";
import { actorId, need, now } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";


/** Where a notification leads, in the organization's own terms; the web turns it into a path */
export interface NoteLink { page?: "people" | "settings" | "documents" | "workspace"; project?: string; layer?: Layer; item?: string }


export function notificationRoutes(app: App, k: Kit) {
  const { repo } = k;

  // Work out where each event leads. Projects come from the project list; items say their project in
  // the summary's leading key ("FLOW-1: ..."), and comments read their item once to find its layer.
  // Anything removed or trashed leads to what's left (the project), or nowhere
  async function linksFor(tid: string, events: AuditEvent[]) {
    const projects = (await repo.listProjects(tid)).filter((p: Project) => !p.deletedAt);
    const byId = new Map(projects.map((p) => [p.id, p]));
    const byKey = new Map(projects.map((p) => [p.key, p]));
    return Promise.all(events.map(async (e): Promise<NoteLink | undefined> => {
      const [kind, verb] = e.action.split(".") as [string, string];
      if (kind === "member") return { page: "people" };
      if (kind === "org") return e.action === "org.stages" ? { page: "settings" } : undefined;
      if (kind === "doc") return { page: "documents" };
      // Calendar events live on Home's calendar
      if (kind === "calendar") return { page: "workspace" };
      if (kind === "project") {
        const p = byId.get(e.target);
        return p ? { project: p.key } : undefined;
      }
      const p = byKey.get(/^([A-Z][A-Z0-9]*-\d+):/.exec(e.summary)?.[1] ?? "");
      if (!p) return undefined;
      if (verb === "deleted") return { project: p.key };
      if (kind === "comment") {
        const item = await repo.getItem(tid, p.id, e.target).catch(() => undefined);
        return item ? { project: p.key, layer: KIND_LAYER[item.kind as ItemKind], item: item.id } : { project: p.key };
      }
      const layer = KIND_LAYER[kind as ItemKind];
      return layer ? { project: p.key, layer, item: e.target } : { project: p.key };
    }));
  }

  // Notifications: what others did here lately, each with its group, importance, and where it leads,
  // and when the caller last looked. Info-level events (sign-ins) show in the list but never count as new
  app.get("/t/:tid/notifications", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const me = actorId(c);
    const [events, member] = await Promise.all([repo.listAudit(t.id, 60), repo.getMember(t.id, me)]);
    // Never opened: only the last three days count as new, so older history doesn't all light up at once
    const seenAt = member?.seenAt ?? new Date(Date.now() - 3 * 864e5).toISOString();
    const mine = events.filter((e) => e.actorId !== me).slice(0, 40);
    const links = await linksFor(t.id, mine);
    const list = mine.map((e, i) => {
      const g = groupOf(e.action);
      return { ...e, group: g.id, level: g.level, unread: e.at > seenAt && g.level !== "info", link: links[i] };
    });
    return c.json({ seenAt, unread: list.filter((e) => e.unread).length, events: list });
  });

  // Opening the list marks everything up to now as seen
  app.post("/t/:tid/notifications/seen", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const m = await repo.getMember(t.id, actorId(c));
    if (m) await repo.saveMember({ ...m, seenAt: now(), version: m.version + 1, updatedAt: now(), updatedBy: actorId(c) }, { version: m.version });
    return c.body(null, 204);
  });
}
