// apps/web/src/components/ComingUp.tsx - Coming up on Home: this week and the next two as a strip of days, with
// a mark for each dated thing (due work, milestones, project targets), then the same things as an
// agenda grouped into Overdue, This week, Next week, and Later.


import { KIND_LAYER, type ItemKind } from "@1neon/domain";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { read } from "../lib/reads.ts";
import { gate } from "./Reads.tsx";
import { layerSlug } from "./ui.tsx";


// One dated thing, as the API returns it
interface Event {
  date: string;
  title: string;
  projectKey: string;
  kind: string;
  itemId?: string;
  overdue: boolean;
  mine: boolean;
  // A request's timing in the person's words ("this month"), resolved to `date` when it was made
  requestedTiming?: string;
}


// Short names for the kinds that show up here
const KIND_WORD: Record<string, string> = { request: "Request", target: "Target", milestone: "Milestone", task: "Task", file_request: "File", change: "Change", check: "Check", handoff: "Handoff", training: "Training" };


// A date string a number of days from another
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);


/** Coming up for one organization */
export function ComingUp({ tid, base }: { tid: string; base: string }) {
  const up = useQuery({ queryKey: ["upcoming", tid], queryFn: () => read<{ today: string; events: Event[] }>(`/t/${tid}/upcoming`, { today: "string", events: "array" }), refetchInterval: 60_000 });
  // Loading, or failed with nothing to show: the card says which, never an empty calendar
  const wait = gate([up], { compact: true });
  if (wait || !up.data) return <section className="card coming" aria-busy={up.isPending}><h2 className="section-h">Coming up</h2>{up.isError && wait}</section>;
  const { today, events } = up.data;
  // Three weeks from the Monday of this week, so each row of the eye scans one week
  const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7;
  const start = addDays(today, -dow);
  const days = Array.from({ length: 21 }, (_, i) => addDays(start, i));
  const on = (d: string) => events.filter((e) => e.date === d && !e.overdue);
  const overdue = events.filter((e) => e.overdue);
  // The agenda's groups
  const endWeek = addDays(start, 6), endNext = addDays(start, 13);
  const groups: [string, Event[]][] = [
    ["Overdue", overdue],
    ["This week", events.filter((e) => !e.overdue && e.date <= endWeek)],
    ["Next week", events.filter((e) => e.date > endWeek && e.date <= endNext)],
    ["Later", events.filter((e) => e.date > endNext)],
  ];
  const link = (e: Event) => e.itemId ? `${base}/projects/${e.projectKey}/${layerSlug(KIND_LAYER[e.kind as ItemKind] ?? "needs")}#item-${e.itemId}` : `${base}/projects/${e.projectKey}`;
  return (
    <section className="card coming" data-tour="coming-up">
      <div className="coming-head">
        <h2 className="section-h">Coming up</h2>
        {overdue.length > 0 && <span className="tag warn">{overdue.length} overdue</span>}
      </div>
      {/* The strip: three weeks of days, today outlined, a mark per dated thing */}
      <div className="strip" role="img" aria-label={`This week and the next two: ${days.reduce((n, d) => n + on(d).length, 0)} dated things`}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="dow" aria-hidden="true">{d}</span>)}
        {days.map((d) => {
          const list = on(d);
          return (
            <span key={d} className={`day${d === today ? " today" : ""}${d < today ? " past" : ""}`} title={list.map((e) => `${KIND_WORD[e.kind] ?? "Item"}: ${e.title}`).join("\n") || undefined}>
              <span className="num">{Number(d.slice(8))}</span>
              <span className="marks">{list.slice(0, 3).map((e, i) => <i key={i} className={`mark k-${e.kind}${e.mine ? " mine" : ""}`} />)}{list.length > 3 && <b>+{list.length - 3}</b>}</span>
            </span>
          );
        })}
      </div>
      {/* The agenda: the same things, readable, each opening where it lives */}
      {events.length === 0 ? <p className="muted small">Nothing dated in the next six weeks. Add due dates to tasks and milestones to see them here.</p> : (
        <div className="agenda">
          {groups.filter(([, list]) => list.length).map(([name, list]) => (
            <div key={name} className={`ag-group${name === "Overdue" ? " late" : ""}`}>
              <h3>{name}</h3>
              <ul>
                {list.slice(0, 6).map((e, i) => (
                  <li key={i}>
                    <time>{new Date(e.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
                    <Link to={link(e)}>{e.title}</Link>
                    <span className="s">{KIND_WORD[e.kind] ?? "Item"} · {e.projectKey}{e.requestedTiming ? ` · asked for ${e.requestedTiming}` : ""}</span>
                  </li>
                ))}
                {list.length > 6 && <li className="muted small">and {list.length - 6} more</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
