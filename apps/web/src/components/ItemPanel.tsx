// apps/web/src/components/ItemPanel.tsx - One item in a side panel (a bottom sheet on phones): its
// details, status, owner, and due date, then the conversation and history. The pattern Plane, Huly,
// and Linear use, so a list stays short and every detail is one tap away.


import { STATUSES, WORK_STATUSES, type AuditEvent, type Item, type ItemKind } from "@1neon/domain";
import { useQuery } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, HttpError } from "../lib/api.ts";
import { problem, useMembers, useRefresh } from "../lib/hooks.ts";
import { useOrg, useSession } from "./Shell.tsx";
import { ago, Avatar, Dialog, useToast } from "./ui.tsx";


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


/** The panel for one item; closes on Escape, a backdrop tap, or Close */
export function ItemPanel({ item, label, path, open, onClose }: { item: Item; label: string; path: string; open: boolean; onClose: () => void }) {
  const { org, canWrite, canAdmin } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const members = useMembers(org.id);
  const [draft, setDraft] = useState({ title: item.title, body: item.body, status: item.status, assigneeId: item.assigneeId ?? "", dueDate: item.dueDate ?? "" });
  const [note, setNote] = useState("");
  // Start from the latest version each time the panel opens
  useEffect(() => {
    if (open) setDraft({ title: item.title, body: item.body, status: item.status, assigneeId: item.assigneeId ?? "", dueDate: item.dueDate ?? "" });
  }, [open, item]);
  // Comments and history load only while the panel is open
  const thread = useQuery({ queryKey: ["comments", item.id], queryFn: () => api<{ comments: Comment[]; history: AuditEvent[] }>(`${path}/items/${item.id}/comments`), enabled: open });

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
  const choices = item.status === "approved" ? ["approved"] : [...(STATUSES[item.kind as ItemKind] ?? WORK_STATUSES)];
  const dirty = draft.title !== item.title || draft.body !== item.body || draft.status !== item.status || draft.assigneeId !== (item.assigneeId ?? "") || draft.dueDate !== (item.dueDate ?? "");

  // Save only what changed, against the version on screen
  const save = async () => {
    const body: Record<string, unknown> = { version: item.version };
    if (draft.title !== item.title) body.title = draft.title;
    if (draft.body !== item.body) body.body = draft.body;
    if (draft.status !== item.status) body.status = draft.status;
    if (draft.assigneeId !== (item.assigneeId ?? "")) body.assigneeId = draft.assigneeId || null;
    if (draft.dueDate !== (item.dueDate ?? "")) body.dueDate = draft.dueDate || null;
    try {
      await api(`${path}/items/${item.id}`, { method: "PATCH", body });
      toast("Saved");
      onClose();
    } catch (e) {
      toast(e instanceof HttpError && e.status === 409 ? "Someone changed this first. The latest is showing now; make your change again." : problem(e));
    }
    refresh();
  };
  // Remove after a confirm; the version guard stops removing something just changed
  const remove = async () => {
    if (!confirm(`Remove "${item.title}"?`)) return;
    try {
      await api(`${path}/items/${item.id}?version=${item.version}`, { method: "DELETE" });
      onClose();
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };
  // Add a comment, then reload the thread
  const comment = async () => {
    try {
      await api(`${path}/items/${item.id}/comments`, { method: "POST", body: { body: note } });
      setNote("");
      void thread.refetch();
    } catch (e) {
      toast(problem(e));
    }
  };
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
      {canWrite ? (
        <textarea className="title-input" aria-label="Title" rows={2} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, " ") })} maxLength={160} />
      ) : <h2>{item.title}</h2>}
      {/* Status, owner, and due date in one compact grid */}
      <div className="props">
        <label>Status
          <select value={draft.status} disabled={!canWrite || item.status === "approved"} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
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
          <button className="btn btn-primary" disabled={!dirty || !draft.title.trim()} onClick={() => void save()}>Save</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {item.kind !== "decision" && <button className="icon-act" style={{ marginLeft: "auto" }} onClick={() => void remove()} aria-label={`Remove ${item.title}`} title="Remove"><Trash2 size={16} aria-hidden="true" /></button>}
        </div>
      )}
      {/* The conversation: newest at the bottom, like a chat */}
      <h3 className="section-h">Comments</h3>
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
        <button className="btn btn-ghost btn-sm" disabled={!note.trim()}>Send</button>
      </form>
      {/* What happened to it, newest first */}
      {(thread.data?.history.length ?? 0) > 0 && (
        <details className="history">
          <summary>History</summary>
          <ul className="feed">{thread.data!.history.map((h) => <li key={h.id}><span>{h.summary}</span><time>{ago(h.at)}</time></li>)}</ul>
        </details>
      )}
    </Dialog>
  );
}
