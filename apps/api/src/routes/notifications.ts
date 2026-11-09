// apps/api/src/routes/notifications.ts - The bell: recent events by others in one organization, and
// marking them seen. Sending notices is the outbox's job (lib/transactions.ts, outbox.ts).


import { groupOf } from "@1neon/domain";
import { actorId, need, now } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";


export function notificationRoutes(app: App, k: Kit) {
  const { repo } = k;

  // Notifications: what others did here lately, each with its group and importance, and when the
  // caller last looked. Info-level events (sign-ins) show in the list but never count as new
  app.get("/t/:tid/notifications", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const me = actorId(c);
    const [events, member] = await Promise.all([repo.listAudit(t.id, 60), repo.getMember(t.id, me)]);
    // Never opened: only the last three days count as new, so older history doesn't all light up at once
    const seenAt = member?.seenAt ?? new Date(Date.now() - 3 * 864e5).toISOString();
    const list = events.filter((e) => e.actorId !== me).slice(0, 40).map((e) => {
      const g = groupOf(e.action);
      return { ...e, group: g.id, level: g.level, unread: e.at > seenAt && g.level !== "info" };
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
