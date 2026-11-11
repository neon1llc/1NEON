// apps/api/src/routes/calendar.ts - Home's calendar: one month of everything dated (work due, project
// targets, and the organization's own events such as leave, office closures, meetings, and care plan
// calls), the work still overdue, and the repeating events; plus adding, changing, and removing the
// organization's own events. Each change is in the activity record, worded with what changed.


import { CalEvent, CreateCalEventInput, UpdateCalEventInput, changeRecord, dayWords, isClosed, newId, occurrences, plusDays, todayIn } from "@1neon/domain";
import { actorId, body, defined, fail, need, now } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";


/** One dated thing on the calendar, whatever it comes from */
export interface CalEntry {
  date: string;
  // The last day of a span (leave over several days)
  endDate?: string;
  time?: string;
  title: string;
  // An item's kind, "target" for a project's target date, or the event's own kind
  kind: string;
  source: "work" | "target" | "event";
  projectKey?: string;
  itemId?: string;
  eventId?: string;
  done: boolean;
  overdue: boolean;
  mine: boolean;
  personId?: string;
  repeat?: string;
  requestedTiming?: string;
}


// Words for each kind of event, for the activity record
const KIND_WORD: Record<string, string> = { leave: "leave", office: "office event", meeting: "meeting", care: "care plan date", other: "event" };
const REPEAT_WORD: Record<string, string> = { none: "once", weekly: "every week", monthly: "every month" };


export function calendarRoutes(app: App, k: Kit) {
  const { repo, activeMembers } = k;

  // The month asked for (?month=YYYY-MM, this month by default): its dated things, work still overdue
  // from before it, and the repeating events. Dates are the organization's calendar days (AUTH-P01)
  app.get("/t/:tid/calendar", async (c) => {
    need(c, "read");
    const t = c.get("tenant");
    const today = todayIn(t.timeZone, new Date(now()));
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(c.req.query("month") ?? "") ? c.req.query("month")! : today.slice(0, 7);
    const from = `${month}-01`;
    const to = plusDays(`${month < "9999-12" ? nextMonth(month) : month}-01`, -1);
    const me = actorId(c);
    const live = (await repo.listProjects(t.id)).filter((p) => !p.archived);
    const keyOf = new Map(live.map((p) => [p.id, p.key]));
    const entries: CalEntry[] = [];
    const overdue: CalEntry[] = [];
    for (const p of live) {
      const open = !isClosed(t.stages, p.stageId);
      if (p.targetDate && p.targetDate >= from && p.targetDate <= to) entries.push({ date: p.targetDate, title: `${p.name} target`, kind: "target", source: "target", projectKey: p.key, done: !open, overdue: open && p.targetDate < today, mine: false });
      else if (p.targetDate && open && p.targetDate < today && p.targetDate < from) overdue.push({ date: p.targetDate, title: `${p.name} target`, kind: "target", source: "target", projectKey: p.key, done: false, overdue: true, mine: false });
      for (const i of await repo.listItems(t.id, p.id)) {
        if (!i.dueDate || i.kind === "update" || i.kind === "decision") continue;
        const done = i.status === "done" || i.status === "approved" || i.status === "declined";
        const e: CalEntry = { date: i.dueDate, title: i.title, kind: i.kind, source: "work", projectKey: p.key, itemId: i.id, done, overdue: !done && i.dueDate < today, mine: i.assigneeId === me, requestedTiming: i.requestedTiming };
        if (i.dueDate >= from && i.dueDate <= to) entries.push(e);
        else if (e.overdue && i.dueDate < from) overdue.push(e);
      }
    }
    // The organization's own events: each day they fall on this month; a span shows from its first day
    const events = await repo.listCalEvents(t.id);
    for (const ev of events) {
      const span = ev.endDate ? Math.round((Date.parse(ev.endDate) - Date.parse(ev.date)) / 864e5) : 0;
      // A span that started last month still shows this month, so look back by its length
      for (const d of occurrences(ev, plusDays(from, -span), to)) {
        entries.push({ date: d, endDate: span ? plusDays(d, span) : undefined, time: ev.time, title: ev.title, kind: ev.kind, source: "event", eventId: ev.id, projectKey: ev.projectId ? keyOf.get(ev.projectId) : undefined, done: (span ? plusDays(d, span) : d) < today, overdue: false, mine: ev.personId === me, personId: ev.personId, repeat: ev.repeat });
      }
    }
    entries.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
    overdue.sort((a, b) => a.date.localeCompare(b.date));
    const repeating = events.filter((e) => e.repeat !== "none" && (!e.until || e.until >= today)).sort((a, b) => a.title.localeCompare(b.title));
    return c.json({ today, month, from, to, entries, overdue, repeating, events });
  });

  // Add an event to the organization's calendar
  app.post("/t/:tid/events", async (c) => {
    need(c, "write");
    const t = c.get("tenant");
    const input = await body(c, CreateCalEventInput);
    sane(input);
    if (input.personId) await activeMembers(t.id, [input.personId]);
    if (input.projectId && !(await repo.getProject(t.id, input.projectId))) fail(400, "invalid", "That project doesn't exist.");
    const at = now();
    const ev = CalEvent.parse({ ...input, tenantId: t.id, id: newId("e"), version: 1, createdAt: at, updatedAt: at, updatedBy: actorId(c) });
    const names = await namesOf(t.id);
    await repo.table.write([repo.calEventOp(ev, { create: true }), repo.auditOp({ tenantId: t.id, actorId: actorId(c), action: "calendar.created", target: ev.id, summary: `Added ${KIND_WORD[ev.kind]} "${ev.title}" to the calendar: ${describe(ev, names)}`.slice(0, 300) })]);
    return c.json(ev, 201);
  });

  // Change one, guarded by the version the person last saw; null clears an optional field
  app.patch("/t/:tid/events/:eid", async (c) => {
    need(c, "write");
    const t = c.get("tenant");
    const ev = await repo.getCalEvent(t.id, c.req.param("eid")!);
    if (!ev) fail(404, "not_found", "That event no longer exists.");
    const input = await body(c, UpdateCalEventInput);
    const { version, endDate, time, until, personId, projectId, ...patch } = input;
    const next: CalEvent = { ...ev, ...defined(patch), version: ev.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    if (endDate !== undefined) next.endDate = endDate ?? undefined;
    if (time !== undefined) next.time = time ?? undefined;
    if (until !== undefined) next.until = until ?? undefined;
    if (personId !== undefined) next.personId = personId ?? undefined;
    if (projectId !== undefined) next.projectId = projectId ?? undefined;
    sane(next);
    if (next.personId && next.personId !== ev.personId) await activeMembers(t.id, [next.personId]);
    const names = await namesOf(t.id);
    // What changed, in words
    const changes: string[] = [];
    if (ev.title !== next.title) changes.push(`renamed "${ev.title}" → "${next.title}"`);
    if (ev.kind !== next.kind) changes.push(`kind ${KIND_WORD[ev.kind]} → ${KIND_WORD[next.kind]}`);
    if (ev.date !== next.date || (ev.endDate ?? "") !== (next.endDate ?? "")) changes.push(`dates ${span(ev)} → ${span(next)}`);
    if ((ev.time ?? "") !== (next.time ?? "")) changes.push(`time ${ev.time ?? "all day"} → ${next.time ?? "all day"}`);
    if (ev.repeat !== next.repeat || (ev.until ?? "") !== (next.until ?? "")) changes.push(`repeats ${repeatWords(ev)} → ${repeatWords(next)}`);
    if ((ev.personId ?? "") !== (next.personId ?? "")) changes.push(`for ${next.personId ? names.get(next.personId) ?? "someone" : "nobody in particular"}`);
    if ((ev.projectId ?? "") !== (next.projectId ?? "")) changes.push(next.projectId ? "linked to a project" : "unlinked from its project");
    if (ev.notes !== next.notes) changes.push(next.notes ? "notes edited" : "notes cleared");
    const record = changeRecord(`Updated ${KIND_WORD[next.kind]} "${next.title}"`, changes);
    await repo.table.write([repo.calEventOp(next, { version }), ...(record ? [repo.auditOp({ tenantId: t.id, actorId: actorId(c), action: "calendar.updated", target: ev.id, ...record })] : [])]);
    return c.json(next);
  });

  // Remove one (every repeat of it), guarded by version
  app.delete("/t/:tid/events/:eid", async (c) => {
    need(c, "write");
    const t = c.get("tenant");
    const ev = await repo.getCalEvent(t.id, c.req.param("eid")!);
    if (!ev) fail(404, "not_found", "That event no longer exists.");
    const version = Number(c.req.query("version") ?? ev.version);
    const names = await namesOf(t.id);
    const k2 = { PK: `T#${t.id}`, SK: `CAL#${ev.id}` };
    await repo.table.write([{ delete: k2, guard: { version } }, repo.auditOp({ tenantId: t.id, actorId: actorId(c), action: "calendar.deleted", target: ev.id, summary: `Removed ${KIND_WORD[ev.kind]} "${ev.title}" (${describe(ev, names)}) from the calendar`.slice(0, 300) })]);
    return c.body(null, 204);
  });

  // Members' names by id, for the record
  async function namesOf(tid: string) {
    return new Map((await repo.listMembers(tid)).map((m) => [m.userId, m.name || m.email]));
  }
}


// Dates that make sense together: an end on or after the start, a repeat's last day after its first,
// and spans no longer than a year
function sane(e: { date: string; endDate?: string; until?: string; repeat?: string }) {
  if (e.endDate && e.endDate < e.date) fail(400, "invalid", "The last day can't be before the first.");
  if (e.endDate && Date.parse(e.endDate) - Date.parse(e.date) > 366 * 864e5) fail(400, "invalid", "An event can span a year at most.");
  if (e.until && e.until < e.date) fail(400, "invalid", "A repeat can't end before it starts.");
}


// "Nov 3, 2026", "Nov 3, 2026 to Nov 7, 2026"
const span = (e: Pick<CalEvent, "date" | "endDate">) => e.endDate ? `${dayWords(e.date)} to ${dayWords(e.endDate)}` : dayWords(e.date);
const repeatWords = (e: Pick<CalEvent, "repeat" | "until">) => `${REPEAT_WORD[e.repeat] ?? e.repeat}${e.repeat !== "none" && e.until ? ` until ${dayWords(e.until)}` : ""}`;
function describe(e: CalEvent, names: Map<string, string>) {
  return [span(e), e.time ? `at ${e.time}` : "", e.repeat !== "none" ? repeatWords(e) : "", e.personId ? `for ${names.get(e.personId) ?? "someone"}` : ""].filter(Boolean).join(", ");
}


// The month after YYYY-MM
function nextMonth(m: string) {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}
