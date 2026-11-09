// apps/web/src/components/Bell.tsx - Notifications: a bell in the top bar that breathes while
// something new is waiting, and a list of what others did lately, important ones marked. Opening
// the list marks everything seen. Choices for email and text live in the profile.


import { BellIcon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { AuditEvent, Level } from "@1neon/domain";
import { api } from "../lib/api.ts";
import { read } from "../lib/reads.ts";
import { gate, Stale } from "./Reads.tsx";
import { useMembers } from "../lib/hooks.ts";
import { ago } from "./ui.tsx";


/** One notification as the API returns it */
type Note = AuditEvent & { group: string; level: Level; unread: boolean };
interface Notes { seenAt: string; unread: number; events: Note[] }


/** The bell and its list for one organization; checks every 20 seconds and when the tab returns */
export function Bell({ tid, slug }: { tid: string; slug: string }) {
  const qc = useQueryClient();
  const members = useMembers(tid);
  const names = new Map(members.data?.map((m) => [m.userId, m.name || m.email]) ?? []);
  const q = useQuery({ queryKey: ["notes", tid], queryFn: () => read<Notes>(`/t/${tid}/notifications`, { unread: "number", events: "array" }), refetchInterval: 20_000 });
  const [open, setOpen] = useState(false);
  // What was new when the list opened stays marked while it's open, even after it's marked seen
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  const unread = q.data?.unread ?? 0;
  // Loading or failed with nothing to show: the list says which instead of "Nothing yet"
  const wait = gate([q], { compact: true });

  // Open: remember what's new, then tell the API it's been seen
  const toggle = async () => {
    if (open) return setOpen(false);
    setFresh(new Set(q.data?.events.filter((e) => e.unread).map((e) => e.id)));
    setOpen(true);
    if (unread) {
      await api(`/t/${tid}/notifications/seen`, { method: "POST" }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ["notes", tid] });
    }
  };
  // A click outside or Escape closes the list
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div className="bell" ref={box}>
      <button className={`icon-btn bell-btn${unread ? " breathing" : ""}`} onClick={() => void toggle()} aria-expanded={open} aria-haspopup="true"
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"} title="Notifications" data-tour="notifications">
        <BellIcon size={17} aria-hidden="true" />
        {unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-list" role="dialog" aria-label="Notifications">
          <div className="bell-head"><b>Notifications</b><Link to="/me#notifications" onClick={() => setOpen(false)} className="small">Choose what emails you</Link></div>
          {/* "Nothing yet" only when the list really answered empty; a failure says so instead */}
          <Stale reads={[q]} />
          {wait ?? (!q.data?.events.length && <p className="muted small bell-empty">Nothing yet. Changes others make here will show up in this list.</p>)}
          <ul>
            {!wait && q.data?.events.map((e) => (
              <li key={e.id} className={`lvl-${e.level}${fresh.has(e.id) ? " new" : ""}`}>
                <span className="dot" aria-hidden="true" />
                <span className="what">
                  <span>{e.summary}</span>
                  <span className="muted small">{names.get(e.actorId) ?? "Someone"} · {ago(e.at)}{e.level === "critical" ? " · important" : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
