// apps/web/src/components/ItemPanel.tsx - One item in a side panel (a bottom sheet on phones): its
// details, status, owner, and due date, then the conversation and history. The pattern Plane, Huly,
// and Linear use, so a list stays short and every detail is one tap away.


import { STATUSES, WORK_STATUSES, type AuditEvent, type Item, type ItemKind } from "@1neon/domain";
import { useQuery } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, HttpError } from "../lib/api.ts";
import { problem, useMembers, useRefresh, useSubmit } from "../lib/hooks.ts";
import { read } from "../lib/reads.ts";
import { gate } from "./Reads.tsx";
import { useOrg, useSession } from "./Shell.tsx";
import { ago, Avatar, ConflictDialog, Dialog, useToast } from "./ui.tsx";


// Plain words for every status a person can pick
export const STATUS_WORDS: Record<string, string> = {
  open: "To do",
  doing: "In progress",
  blocked: "Blocked",
  done: "Done",
  draft: "Draft",
  proposed: "Shared for approval",
  declined: "Declined",
  approved: "Approved",
};


// A comment as the API returns it
interface Comment {
  id: string;
  at: string;
  authorId: string;
  authorName: string;
  body: string;
}


// --- Editing draft ----------------------------------------------------------------


/** The fields the panel edits, as form values (no owner or due date is an empty string) */
type Draft = { title: string; body: string; status: string; assigneeId: string; dueDate: string };
const draftOf = (i: Item): Draft => ({ title: i.title, body: i.body, status: i.status, assigneeId: i.assigneeId ?? "", dueDate: i.dueDate ?? "" });

/** The PATCH fields for what the draft changed from `from`; empty owner and due date clear them */
export function changesFrom(draft: Draft, from: Item): Record<string, unknown> {
  const was = draftOf(from);
  const out: Record<string, unknown> = {};
  if (draft.title !== was.title) out.title = draft.title;
  if (draft.body !== was.body) out.body = draft.body;
  if (draft.status !== was.status) out.status = draft.status;
  if (draft.assigneeId !== was.assigneeId) out.assigneeId = draft.assigneeId || null;
  if (draft.dueDate !== was.dueDate) out.dueDate = draft.dueDate || null;
  return out;
}


/**
 * The panel for one item; closes on Escape, a backdrop tap, or Close.
 *
 * Editing works against the version the panel opened with (`base`), not whatever the 15-second
 * refresh last brought in. A clean draft follows newer versions; a dirty one is never replaced, the
 * panel says a newer version exists, and Save sends the base version so the API's 409 opens the
 * yours-or-theirs choice instead of silently writing over the other person's change
 */
export function ItemPanel({ item, label, path, open, onClose }: { item: Item; label: string; path: string; open: boolean; onClose: () => void }) {
  const { org, canWrite, canAdmin } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const members = useMembers(org.id);
  const [base, setBase] = useState(item);
  const [draft, setDraft] = useState(() => draftOf(item));
  // The newer record from a 409, shown beside the draft until the person chooses
  const [conflict, setConflict] = useState<Item>();
  const [note, setNote] = useState("");
  const [saving, runSave] = useSubmit();
  const [posting, runPost] = useSubmit();
  // Opening (or reopening) starts from the newest record; only the open/close change resets the draft
  useEffect(() => {
    if (!open) return;
    setBase(item);
    setDraft(draftOf(item));
    setConflict(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const dirty = Object.keys(changesFrom(draft, base)).length > 0;
  // A newer record while open: a clean draft moves to it; a dirty draft stays and the notice shows
  useEffect(() => {
    if (open && !dirty && item.version !== base.version) {
      setBase(item);
      setDraft(draftOf(item));
    }
  }, [open, dirty, item, base.version]);
  const newer = item.version > base.version ? item : undefined;
  const nameOf = (uid?: string) => members.data?.find((m) => m.userId === uid)?.name || "Someone";
  // Drop the local edit and continue from the newest record the panel knows of
  const takeTheirs = (theirs: Item) => {
    const latest = theirs.version >= item.version ? theirs : item;
    setBase(latest);
    setDraft(draftOf(latest));
    setConflict(undefined);
  };
  // Comments and history load only while the panel is open
  const thread = useQuery({ queryKey: ["comments", item.id], queryFn: () => read<{ comments: Comment[]; history: AuditEvent[] }>(`${path}/items/${item.id}/comments`, { comments: "array", history: "array" }), enabled: open });

  // While open for editing, show others that this item is being edited; the marker expires on its own
  useEffect(() => {
    if (!open || !canWrite) return;
    const mark = () => void api(`${path}/edits`, { method: "POST", body: { recordId: item.id } }).catch(() => undefined);
    mark();
    const beat = window.setInterval(mark, 45_000);
    return () => {
      window.clearInterval(beat);
      void api(`${path}/edits/${item.id}`, { method: "DELETE" }).catch(() => undefined);
    };
  }, [open, canWrite, item.id, path]);

  // The statuses this kind allows, keeping an approved option's status as it is
  const choices = base.status === "approved" ? ["approved"] : [...(STATUSES[base.kind as ItemKind] ?? WORK_STATUSES)];

  // Save only what the person changed since the base, guarded by `version`: the base on a first save,
  // the newer record after "Keep mine", so only the fields they edited overwrite the other person's
  const save = (version: number) => runSave(async () => {
    try {
      await api(`${path}/items/${item.id}`, { method: "PATCH", body: { version, ...changesFrom(draft, base) } });
      toast("Saved");
      setConflict(undefined);
      onClose();
    } catch (e) {
      // A 409 carries the newer record for items; without it, keep the draft and say what happened
      const theirs = e instanceof HttpError && e.status === 409 ? (e.body.current as Item | undefined) : undefined;
      if (theirs?.id === item.id) setConflict(theirs);
      else toast(e instanceof HttpError && e.status === 409 ? "Someone changed this first. Your text is still here; check the newer version, then save again." : problem(e));
    }
    refresh();
  });
  // Remove after a confirm; the version guard stops removing something just changed
  const remove = async () => {
    if (!confirm(`Remove "${item.title}"?`)) return;
    try {
      await api(`${path}/items/${item.id}?version=${base.version}`, { method: "DELETE" });
      onClose();
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };
  // Add a comment, then reload the thread; one at a time, so a double click posts once
  const comment = () => runPost(async () => {
    try {
      await api(`${path}/items/${item.id}/comments`, { method: "POST", body: { body: note } });
      setNote("");
      void thread.refetch();
    } catch (e) {
      toast(problem(e));
    }
  });
  const deleteComment = async (id: string) => {
    try {
      await api(`${path}/items/${item.id}/comments/${id}`, { method: "DELETE" });
      void thread.refetch();
    } catch (e) {
      toast(problem(e));
    }
  };
  const active = members.data?.filter((m) => m.status !== "deactivated") ?? [];
  return (
    <Dialog open={open} onClose={onClose} label={`${label}: ${item.title}`} className="sheet item-panel">
      {/* The close button takes first focus, so the title isn't selected on open */}
      <div className="panel-head">
        <p className="eyebrow">{label}</p>
        <button className="icon-act" onClick={onClose} aria-label="Close" autoFocus><X size={18} aria-hidden="true" /></button>
      </div>
      {/* Someone saved while this draft was dirty: the draft stays, and the person decides */}
      {canWrite && dirty && newer && (
        <div className="notice newer" role="status">
          <span>{nameOf(newer.updatedBy)} saved a newer version while you were editing. Your changes are kept; Save asks which version to keep.</span>
          <button className="linkish small" type="button" onClick={() => takeTheirs(newer)}>Discard mine and load theirs</button>
        </div>
      )}
      {canWrite ? (
        <textarea className="title-input" aria-label="Title" rows={2} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, " ") })} maxLength={160} />
      ) : <h2>{item.title}</h2>}
      {/* Status, owner, and due date in one compact grid */}
      <div className="props">
        <label>Status
          <select value={draft.status} disabled={!canWrite || base.status === "approved"} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            {[...new Set([draft.status, ...choices])].map((s) => <option key={s} value={s}>{STATUS_WORDS[s] ?? s}</option>)}
          </select>
        </label>
        <label>Owner
          <select value={draft.assigneeId} disabled={!canWrite} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })}>
            <option value="">No one yet</option>
            {active.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}
          </select>
        </label>
        <label>Due
          <input type="date" value={draft.dueDate} disabled={!canWrite} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
        </label>
      </div>
      {canWrite ? (
        <textarea aria-label="Details" placeholder="Details" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4} />
      ) : item.body ? <p className="pre">{item.body}</p> : null}
      {canWrite && (
        <div className="actions">
          <button className="btn btn-primary" disabled={!dirty || !draft.title.trim() || saving} onClick={() => void save(base.version)}>{saving ? "Saving…" : "Save"}</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {item.kind !== "decision" && <button className="icon-act" style={{ marginLeft: "auto" }} onClick={() => void remove()} aria-label={`Remove ${item.title}`} title="Remove"><Trash2 size={16} aria-hidden="true" /></button>}
        </div>
      )}
      {/* The conversation: newest at the bottom, like a chat */}
      <h3 className="section-h">Comments</h3>
      {/* "No comments yet" only once the thread answered; a failure says so with Try again */}
      {gate([thread], { compact: true, what: "Loading comments…" })}
      <ul className="comments">
        {thread.data?.comments.map((cm) => (
          <li key={cm.id}>
            <Avatar id={cm.authorId} name={cm.authorName} size={24} />
            <div>
              <b>{cm.authorName}</b> <time className="muted small">{ago(cm.at)}</time>
              <p className="pre">{cm.body}</p>
            </div>
            {(cm.authorId === me.user.id || canAdmin) && <button className="icon-act" onClick={() => void deleteComment(cm.id)} aria-label="Delete comment" title="Delete"><Trash2 size={14} aria-hidden="true" /></button>}
          </li>
        ))}
        {thread.data && thread.data.comments.length === 0 && <li className="muted small">No comments yet.</li>}
      </ul>
      <form className="comment-box" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void comment(); }}>
        <textarea aria-label="Write a comment" placeholder="Write a comment" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} />
        <button className="btn btn-ghost btn-sm" disabled={!note.trim() || posting}>{posting ? "Sending…" : "Send"}</button>
      </form>
      {/* What happened to it, newest first */}
      {(thread.data?.history.length ?? 0) > 0 && (
        <details className="history">
          <summary>History</summary>
          <ul className="feed">{thread.data!.history.map((h) => <li key={h.id}><span>{h.summary}</span><time>{ago(h.at)}</time></li>)}</ul>
        </details>
      )}
      {/* Yours beside theirs for each field the person changed; Keep mine saves those fields over theirs */}
      <ConflictDialog
        open={Boolean(conflict)}
        who={nameOf(conflict?.updatedBy)}
        fields={conflict ? conflictRows(draft, base, conflict, (uid) => (uid ? members.data?.find((m) => m.userId === uid)?.name || "Someone" : "No one yet")) : []}
        onKeepMine={() => conflict && void save(conflict.version)}
        onTakeTheirs={() => conflict && takeTheirs(conflict)}
        onClose={() => setConflict(undefined)}
      />
    </Dialog>
  );
}


/** One row per field the person changed: their value beside the newer record's, in plain words */
function conflictRows(draft: Draft, base: Item, theirs: Item, person: (uid: string) => string) {
  const mine = changesFrom(draft, base);
  const t = draftOf(theirs);
  const rows: { label: string; mine: string; theirs: string }[] = [];
  if ("title" in mine) rows.push({ label: "Title", mine: draft.title, theirs: t.title });
  if ("body" in mine) rows.push({ label: "Details", mine: draft.body, theirs: t.body });
  if ("status" in mine) rows.push({ label: "Status", mine: STATUS_WORDS[draft.status] ?? draft.status, theirs: STATUS_WORDS[t.status] ?? t.status });
  if ("assigneeId" in mine) rows.push({ label: "Owner", mine: person(draft.assigneeId), theirs: person(t.assigneeId) });
  if ("dueDate" in mine) rows.push({ label: "Due", mine: draft.dueDate, theirs: t.dueDate });
  return rows;
}
