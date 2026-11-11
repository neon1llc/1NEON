// apps/web/src/components/ComingUp.tsx - Home's calendar: one whole month at a time, named at the top
// ("November 2026"), with arrows to step a month either way, Today, and a jump to any month. Each day
// carries a mark for each dated thing: work due, milestones, project targets, and the organization's own
// events (someone's leave, an office closure or event, a meeting, a care plan's monthly call). A click on
// a day shows what's on it and, for editors, a short form to add an event there. Below the month, the
// same things as folds: Past (closed), Overdue (open, when there is any), Upcoming (open), and Repeated
// (closed): the events that come back every week or month.


import { KIND_LAYER, type CalEvent, type ItemKind } from "@1neon/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { problem, useMembers, useProjects, useRefresh, useSubmit } from "../lib/hooks.ts";
import { read } from "../lib/reads.ts";
import type { CalEntry, CalendarMonth } from "../lib/types.ts";
import { gate } from "./Reads.tsx";
import { useOrg } from "./Shell.tsx";
import { layerSlug, useAsk, useToast } from "./ui.tsx";


// Short names for the kinds that show up here: work, targets, and the organization's own events
const KIND_WORD: Record<string, string> = { request: "Request", target: "Target", milestone: "Milestone", task: "Task", file_request: "File", change: "Change", check: "Check", handoff: "Handoff", training: "Training", option: "Option",
  leave: "Leave", office: "Office", meeting: "Meeting", care: "Care plan", other: "Event" };
// The organization's own kinds, in the order the form offers them
const EVENT_KINDS = [["leave", "Leave or time off"], ["office", "Office closure or event"], ["meeting", "Meeting or call"], ["care", "Care plan date (check-in, retro, re-check)"], ["other", "Something else"]] as const;
const REPEAT_WORD: Record<string, string> = { none: "Doesn't repeat", weekly: "Every week", monthly: "Every month" };


// Dates as strings: the calendar never crosses time zones, so plain UTC arithmetic on YYYY-MM-DD is safe
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const shiftMonth = (m: string, n: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthName = (m: string, style: "long" | "short" = "long") => new Date(m + "-15T12:00:00Z").toLocaleDateString(undefined, { month: style, year: "numeric", timeZone: "UTC" });
const dayName = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const short = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });


/** Does an entry fall on day d (a span covers each of its days)? */
const covers = (e: CalEntry, d: string) => e.date === d || (Boolean(e.endDate) && e.date <= d && d <= e.endDate!);


/** The calendar for one organization */
export function ComingUp({ tid, base }: { tid: string; base: string }) {
  const { canWrite } = useOrg();
  // The month in view; the first answer tells us today's month in the organization's time zone
  const [month, setMonth] = useState<string>();
  const [picked, setPicked] = useState<string>();
  const cal = useQuery({ queryKey: ["calendar", tid, month ?? "now"], queryFn: () => read<CalendarMonth>(`/t/${tid}/calendar${month ? `?month=${month}` : ""}`, { today: "string", entries: "array" }), refetchInterval: 60_000, placeholderData: (prev) => prev });
  const data = cal.data;
  const today = data?.today;
  const shown = month ?? data?.month;
  // A new month clears the picked day unless it's in that month
  useEffect(() => { if (picked && shown && !picked.startsWith(shown)) setPicked(undefined); }, [shown, picked]);

  const wait = gate([cal], { compact: true });
  if (!data || !shown || !today) return <section className="card coming" aria-busy={cal.isPending} data-tour="coming-up"><h2 className="section-h">Calendar</h2>{cal.isError && wait}</section>;

  // The month's days, Monday first, with blanks before the 1st so each row is one week
  const first = `${shown}-01`;
  const len = new Date(Date.UTC(Number(shown.slice(0, 4)), Number(shown.slice(5, 7)), 0)).getUTCDate();
  const lead = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7;
  const days = Array.from({ length: len }, (_, i) => addDays(first, i));
  const on = (d: string) => data.entries.filter((e) => covers(e, d));
  const thisMonth = shown === today.slice(0, 7);
  // The folds: what's passed this month, what's late, what's ahead, and what repeats
  const overdue = thisMonth ? [...data.overdue, ...data.entries.filter((e) => e.overdue)] : [];
  const past = data.entries.filter((e) => !e.overdue && (e.endDate ?? e.date) < today);
  const ahead = data.entries.filter((e) => !e.overdue && (e.endDate ?? e.date) >= today);
  // Jump: a year back to two years ahead
  const jumps = Array.from({ length: 37 }, (_, i) => shiftMonth(today.slice(0, 7), i - 12));
  const go = (m: string) => setMonth(m === today.slice(0, 7) ? undefined : m);

  return (
    <section className="card coming cal" data-tour="coming-up" aria-busy={cal.isFetching}>
      {/* The month's name, and the ways to move: back, forward, Today, or straight to a month */}
      <div className="cal-head">
        <h2 className="section-h" aria-live="polite">{monthName(shown)}</h2>
        <div className="cal-nav">
          {!thisMonth && <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(today.slice(0, 7))}>Today</button>}
          <button type="button" className="icon-btn" onClick={() => go(shiftMonth(shown, -1))} aria-label={`Previous month, ${monthName(shiftMonth(shown, -1))}`} title="Previous month"><ChevronLeft size={16} aria-hidden="true" /></button>
          <button type="button" className="icon-btn" onClick={() => go(shiftMonth(shown, 1))} aria-label={`Next month, ${monthName(shiftMonth(shown, 1))}`} title="Next month"><ChevronRight size={16} aria-hidden="true" /></button>
          <select className="cal-jump" value={shown} onChange={(e) => go(e.target.value)} aria-label="Go to a month">
            {!jumps.includes(shown) && <option value={shown}>{monthName(shown, "short")}</option>}
            {jumps.map((m) => <option key={m} value={m}>{monthName(m, "short")}</option>)}
          </select>
        </div>
      </div>
      {overdue.length > 0 && <p className="cal-late"><span className="tag warn">{overdue.length} overdue</span></p>}

      {/* The whole month: a button per day, today outlined, a mark per dated thing */}
      <div className="strip month" role="grid" aria-label={`${monthName(shown)}: ${data.entries.length} dated things. Choose a day to see it${canWrite ? " or add to it" : ""}.`}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="dow" aria-hidden="true">{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} className="day blank" aria-hidden="true" />)}
        {days.map((d) => {
          const list = on(d);
          return (
            <button type="button" key={d} className={`day${d === today ? " today" : ""}${d < today ? " past" : ""}${d === picked ? " picked" : ""}${list.some((e) => e.kind === "leave") ? " away" : ""}`}
              onClick={() => setPicked(d === picked ? undefined : d)} aria-pressed={d === picked}
              aria-label={`${dayName(d)}${list.length ? `, ${list.length} ${list.length === 1 ? "thing" : "things"}` : ""}`} title={list.map((e) => `${KIND_WORD[e.kind] ?? "Item"}: ${e.title}`).join("\n") || undefined}>
              <span className="num">{Number(d.slice(8))}</span>
              <span className="marks">{list.slice(0, 3).map((e, i) => <i key={i} className={`mark k-${e.kind}${e.mine ? " mine" : ""}${e.done ? " done" : ""}`} />)}{list.length > 3 && <b>+{list.length - 3}</b>}</span>
            </button>
          );
        })}
      </div>

      {/* The picked day: what's on it, and the form to add to it */}
      {picked && <DayPanel tid={tid} base={base} day={picked} entries={on(picked)} events={data.events} canWrite={canWrite} close={() => setPicked(undefined)} />}

      {/* The same things, readable, in folds */}
      {data.entries.length === 0 && overdue.length === 0 && data.repeating.length === 0 ? (
        <p className="muted small">Nothing dated in {monthName(shown)}.{canWrite ? " Choose a day to add leave, an office event, a meeting, or a care plan date." : ""}</p>
      ) : (
        <div className="agenda">
          {past.length > 0 && <Fold name="Past" count={past.length}><Entries base={base} list={past} /></Fold>}
          {overdue.length > 0 && <Fold name="Overdue" count={overdue.length} open late><Entries base={base} list={overdue} /></Fold>}
          <Fold name={thisMonth ? "Upcoming" : `In ${monthName(shown, "short")}`} count={ahead.length} open>
            {ahead.length ? <Entries base={base} list={ahead} /> : <p className="muted small">Nothing else dated this month.</p>}
          </Fold>
          <Fold name="Repeated" count={data.repeating.length}>
            {data.repeating.length ? (
              <ul>
                {data.repeating.map((r) => (
                  <li key={r.id}>
                    <time>{r.repeat === "weekly" ? new Date(r.date + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }) : `${Number(r.date.slice(8))}${ordinal(Number(r.date.slice(8)))}`}</time>
                    <button type="button" className="linkish" onClick={() => { go(nextIn(r, today).slice(0, 7)); setPicked(nextIn(r, today)); }}>{r.title}</button>
                    <span className="s">{REPEAT_WORD[r.repeat]}{r.time ? ` · ${r.time}` : ""}{r.until ? ` · until ${short(r.until)}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">Nothing repeats yet. A care plan's monthly call or a weekly check-in can be set to repeat when you add it.</p>}
          </Fold>
        </div>
      )}
    </section>
  );
}


// "1st", "2nd", "23rd"
const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");


// The next day a repeating event falls on, from today
function nextIn(r: CalEvent, today: string) {
  if (r.date >= today) return r.date;
  if (r.repeat === "weekly") return addDays(r.date, Math.ceil((Date.parse(today) - Date.parse(r.date)) / (7 * 864e5)) * 7);
  const day = Number(r.date.slice(8));
  for (let k = 0; k < 2; k++) {
    const m = shiftMonth(today.slice(0, 7), k);
    const n = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
    const d = `${m}-${String(Math.min(day, n)).padStart(2, "0")}`;
    if (d >= today) return d;
  }
  return today;
}


/** A fold: the label with its count and an arrow that points left when closed and down when open */
function Fold({ name, count, open, late, children }: { name: string; count: number; open?: boolean; late?: boolean; children: ReactNode }) {
  return (
    <details className={`ag-group fold${late ? " late" : ""}`} open={open}>
      <summary><h3>{name} <small>{count}</small></h3><span className="arr" aria-hidden="true">←</span></summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}


/** A list of dated things, each opening where it lives */
function Entries({ base, list }: { base: string; list: CalEntry[] }) {
  const [all, setAll] = useState(false);
  const link = (e: CalEntry) => e.itemId ? `${base}/projects/${e.projectKey}/${layerSlug(KIND_LAYER[e.kind as ItemKind] ?? "needs")}#item-${e.itemId}` : e.projectKey ? `${base}/projects/${e.projectKey}` : undefined;
  const limit = 8;
  return (
    <ul>
      {(all ? list : list.slice(0, limit)).map((e, i) => {
        const to = link(e);
        return (
          <li key={i} className={e.done ? "done" : ""}>
            <time>{short(e.date)}{e.endDate ? `–${short(e.endDate).replace(/^[A-Za-z]+ /, (m) => (e.endDate!.slice(0, 7) === e.date.slice(0, 7) ? "" : m))}` : ""}</time>
            {to && e.source !== "event" ? <Link to={to}>{e.title}</Link> : <span className="t">{e.title}</span>}
            <span className="s">{KIND_WORD[e.kind] ?? "Item"}{e.time ? ` · ${e.time}` : ""}{e.projectKey ? ` · ${e.projectKey}` : ""}{e.repeat && e.repeat !== "none" ? ` · ${REPEAT_WORD[e.repeat]!.toLowerCase()}` : ""}{e.requestedTiming ? ` · asked for ${e.requestedTiming}` : ""}</span>
          </li>
        );
      })}
      {list.length > limit && <li className="small"><button type="button" className="linkish" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show fewer" : `and ${list.length - limit} more`}</button></li>}
    </ul>
  );
}


/** One day: its dated things, and (for editors) adding, changing, or removing the organization's own */
function DayPanel({ tid, base, day, entries, events, canWrite, close }: { tid: string; base: string; day: string; entries: CalEntry[]; events: CalEvent[]; canWrite: boolean; close: () => void }) {
  const [editing, setEditing] = useState<CalEvent | "new" | undefined>(entries.length ? undefined : canWrite ? "new" : undefined);
  const ask = useAsk();
  const toast = useToast();
  const refresh = useRefresh(tid);
  const qc = useQueryClient();
  useEffect(() => setEditing(entries.length ? undefined : canWrite ? "new" : undefined), [day]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (ev: CalEvent) => {
    const many = ev.repeat !== "none";
    if (!(await ask({ title: `Remove "${ev.title}"?`, body: many ? "It comes off the calendar on every day it repeats. The activity record keeps a note that it was removed." : "It comes off the calendar. The activity record keeps a note that it was removed.", yes: "Remove", danger: true }))) return;
    try {
      await api(`/t/${tid}/events/${ev.id}?version=${ev.version}`, { method: "DELETE" });
      toast(`Removed "${ev.title}".`);
      void qc.invalidateQueries({ queryKey: ["calendar", tid] });
      refresh();
    } catch (e) { toast(problem(e)); }
  };
  return (
    <div className="cal-day" role="region" aria-label={dayName(day)}>
      <div className="cal-day-head">
        <b>{dayName(day)}</b>
        <span className="spacer" />
        {canWrite && editing === undefined && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing("new")}>Add to this day</button>}
        <button type="button" className="linkish small" onClick={close}>Close</button>
      </div>
      {entries.length > 0 && (
        <ul className="cal-day-list">
          {entries.map((e, i) => {
            const ev = e.eventId ? events.find((x) => x.id === e.eventId) : undefined;
            const to = e.itemId ? `${base}/projects/${e.projectKey}/${layerSlug(KIND_LAYER[e.kind as ItemKind] ?? "needs")}#item-${e.itemId}` : e.projectKey && e.source !== "event" ? `${base}/projects/${e.projectKey}` : undefined;
            return (
              <li key={i}>
                <i className={`mark k-${e.kind}`} aria-hidden="true" />
                <span className="t">{to ? <Link to={to}>{e.title}</Link> : e.title}<small>{KIND_WORD[e.kind] ?? "Item"}{e.time ? ` · ${e.time}` : " · all day"}{e.endDate ? ` · until ${short(e.endDate)}` : ""}{e.projectKey ? ` · ${e.projectKey}` : ""}{e.repeat && e.repeat !== "none" ? ` · ${REPEAT_WORD[e.repeat]!.toLowerCase()}` : ""}</small></span>
                {ev && canWrite && <>
                  <button type="button" className="icon-act" onClick={() => setEditing(ev)} aria-label={`Change "${ev.title}"`} title="Change"><Pencil size={14} aria-hidden="true" /></button>
                  <button type="button" className="icon-act" onClick={() => void remove(ev)} aria-label={`Remove "${ev.title}"`} title="Remove"><Trash2 size={14} aria-hidden="true" /></button>
                </>}
              </li>
            );
          })}
        </ul>
      )}
      {entries.length === 0 && !canWrite && <p className="muted small">Nothing on this day.</p>}
      {editing !== undefined && <EventForm tid={tid} day={day} ev={editing === "new" ? undefined : editing} done={() => setEditing(undefined)} />}
    </div>
  );
}


/** Add an event on a day, or change one: what, who, when, and whether it repeats */
function EventForm({ tid, day, ev, done }: { tid: string; day: string; ev?: CalEvent; done: () => void }) {
  const members = useMembers(tid);
  const projects = useProjects(tid);
  const toast = useToast();
  const refresh = useRefresh(tid);
  const qc = useQueryClient();
  const [pending, run] = useSubmit();
  const [f, setF] = useState(() => ({
    title: ev?.title ?? "", kind: ev?.kind ?? "meeting", date: ev?.date ?? day, endDate: ev?.endDate ?? "", time: ev?.time ?? "",
    repeat: ev?.repeat ?? "none", until: ev?.until ?? "", personId: ev?.personId ?? "", projectId: ev?.projectId ?? "", notes: ev?.notes ?? "",
  }));
  const people = useMemo(() => (members.data ?? []).filter((m) => m.status !== "deactivated").sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)), [members.data]);
  const live = (projects.data ?? []).filter((p) => !p.archived);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  // Leave is about someone; a title can follow from who it is
  const title = f.title.trim() || (f.kind === "leave" && f.personId ? `${people.find((m) => m.userId === f.personId)?.name || "Someone"} away` : "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title) return;
    void run(async () => {
      const opt = (v: string) => (v ? v : ev ? null : undefined);
      const payload = { title, kind: f.kind, date: f.date, endDate: opt(f.endDate), time: opt(f.time), repeat: f.repeat, until: f.repeat !== "none" ? opt(f.until) : ev ? null : undefined, personId: opt(f.personId), projectId: opt(f.projectId), notes: f.notes };
      try {
        if (ev) await api(`/t/${tid}/events/${ev.id}`, { method: "PATCH", body: { version: ev.version, ...payload } });
        else await api(`/t/${tid}/events`, { method: "POST", body: payload });
        toast(ev ? `Saved "${title}".` : `Added "${title}" on ${short(f.date)}.`);
        void qc.invalidateQueries({ queryKey: ["calendar", tid] });
        refresh();
        done();
      } catch (err) { toast(problem(err)); }
    });
  };
  return (
    <form className="form cal-form" onSubmit={submit}>
      <div className="row2">
        <div><label htmlFor="ce-kind">What kind</label>
          <select id="ce-kind" value={f.kind} onChange={set("kind")}>{EVENT_KINDS.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select></div>
        <div><label htmlFor="ce-who">{f.kind === "leave" ? "Who's away" : "Who it's for"} <small className="muted">optional</small></label>
          <select id="ce-who" value={f.personId} onChange={set("personId")}><option value="">Nobody in particular</option>{people.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}</select></div>
      </div>
      <div><label htmlFor="ce-title">Title</label>
        <input id="ce-title" value={f.title} onChange={set("title")} maxLength={120} placeholder={f.kind === "leave" ? "e.g. Dana on vacation" : f.kind === "care" ? "e.g. Monthly check-in call" : f.kind === "office" ? "e.g. Office closed for the holiday" : "e.g. Quarterly review"} required={!title} /></div>
      <div className="row3">
        <div><label htmlFor="ce-date">First day</label><input id="ce-date" type="date" value={f.date} onChange={set("date")} required /></div>
        <div><label htmlFor="ce-end">Last day <small className="muted">optional</small></label><input id="ce-end" type="date" value={f.endDate} min={f.date} onChange={set("endDate")} /></div>
        <div><label htmlFor="ce-time">Time <small className="muted">blank is all day</small></label><input id="ce-time" type="time" value={f.time} onChange={set("time")} /></div>
      </div>
      <div className="row3">
        <div><label htmlFor="ce-rep">Repeats</label>
          <select id="ce-rep" value={f.repeat} onChange={set("repeat")}>{Object.entries(REPEAT_WORD).map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select></div>
        {f.repeat !== "none" && <div><label htmlFor="ce-until">Until <small className="muted">optional</small></label><input id="ce-until" type="date" value={f.until} min={f.date} onChange={set("until")} /></div>}
        <div><label htmlFor="ce-proj">Project <small className="muted">optional</small></label>
          <select id="ce-proj" value={f.projectId} onChange={set("projectId")}><option value="">None</option>{live.map((p) => <option key={p.id} value={p.id}>{p.key} {p.name}</option>)}</select></div>
      </div>
      <div className="form-acts">
        <button className="btn btn-primary btn-sm" disabled={pending || !title}>{pending ? "Saving…" : ev ? "Save" : "Add"}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={done}>Cancel</button>
      </div>
    </form>
  );
}
