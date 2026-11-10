// apps/web/src/components/ItemPanel.tsx - One item in a side panel (a bottom sheet on phones): its
// details, status, owner, and due date, then the conversation and history. The pattern Plane, Huly,
// and Linear use, so a list stays short and every detail is one tap away.


import { MetricFields, OptionFields, STATUSES, WORK_STATUSES, type AuditEvent, type Item, type ItemKind } from "@1neon/domain";
import { useQuery } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, HttpError } from "../lib/api.ts";
import { problem, useMembers, useRefresh, useSubmit } from "../lib/hooks.ts";
import { read } from "../lib/reads.ts";
import { gate } from "./Reads.tsx";
import { useOrg, useSession } from "./Shell.tsx";
import { ago, Avatar, ConflictDialog, Dialog, useAsk, useToast } from "./ui.tsx";


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


/** The fields the panel edits, as form values (no owner or due date is an empty string). `f` holds a
 * kind's own fields as text: an option's cost, timeline, scores, and recommendation; a measure's unit,
 * starting point, and target */
type Draft = { title: string; body: string; status: string; assigneeId: string; dueDate: string; f: Record<string, string> };
const draftOf = (i: Item): Draft => ({ title: i.title, body: i.body, status: i.status, assigneeId: i.assigneeId ?? "", dueDate: i.dueDate ?? "", f: kindFields(i) });

/** A kind's own editable fields as text, so they edit like the rest */
function kindFields(i: Item): Record<string, string> {
  if (i.kind === "option") {
    const o = OptionFields.parse(i.fields);
    return { cost: o.cost, timeline: o.timeline, costScore: String(o.costScore), qualityScore: String(o.qualityScore), effortScore: String(o.effortScore), recommended: o.recommended ? "yes" : "" };
  }
  if (i.kind === "metric") {
    const m = MetricFields.parse(i.fields);
    return { unit: m.unit, baseline: m.baseline === undefined ? "" : String(m.baseline), target: m.target === undefined ? "" : String(m.target) };
  }
  return {};
}

/** The text values back as the API's types: scores and numbers as numbers, the recommendation as yes or no */
function typed(key: string, v: string): unknown {
  if (key.endsWith("Score")) return Number(v);
  if (key === "recommended") return v === "yes";
  if (key === "baseline" || key === "target") return v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Number(v);
  return v;
}

/** The PATCH fields for what the draft changed from `from`; empty owner and due date clear them */
export function changesFrom(draft: Draft, from: Item): Record<string, unknown> {
  const was = draftOf(from);
  const out: Record<string, unknown> = {};
  if (draft.title !== was.title) out.title = draft.title;
  if (draft.body !== was.body) out.body = draft.body;
  if (draft.status !== was.status) out.status = draft.status;
  if (draft.assigneeId !== was.assigneeId) out.assigneeId = draft.assigneeId || null;
  if (draft.dueDate !== was.dueDate) out.dueDate = draft.dueDate || null;
  // Only the kind's fields that changed are sent; the API merges them into the rest
  const fields = Object.fromEntries(Object.keys(draft.f).filter((k) => draft.f[k] !== was.f[k]).map((k) => [k, typed(k, draft.f[k]!)]));
  if (Object.keys(fields).length) out.fields = fields;
  return out;
}


/** Who may delete an item: writers, except that options are neon1's, and decisions and approved
 * options are a permanent record (the API enforces the same) */
export function useMayDelete(item: Item) {
  const { canWrite } = useOrg();
  const me = useSession();
  return canWrite && item.kind !== "decision" && item.status !== "approved" && (item.kind !== "option" || me.operator);
}


/** Delete an item after an "are you sure"; the version guard stops deleting something just changed.
 * Resolves true once it's gone */
export function useDeleteItem(path: string) {
  const { org } = useOrg();
  const ask = useAsk();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  return async (item: Item, label: string) => {
    const yes = await ask({
      title: `Delete this ${label.toLowerCase()}?`,
      body: `"${item.title}" and its comments are deleted for everyone on this project. The project's history keeps a note that it was deleted.`,
      yes: "Delete",
      danger: true,
    });
    if (!yes) return false;
    try {
      await api(`${path}/items/${item.id}?version=${item.version}`, { method: "DELETE" });
      toast(`Deleted: ${item.title}`);
      refresh();
      return true;
    } catch (e) {
      toast(e instanceof HttpError && e.status === 409 ? "Someone changed it first. Look at the latest, then delete again if you still want to." : problem(e));
      refresh();
      return false;
    }
  };
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
  const { org, canWrite: writer, canAdmin } = useOrg();
  const me = useSession();
  // Options are neon1's proposals: the client reads, comments on, and approves them, but doesn't edit
  // them. An approved option is part of its decision's record, so nobody edits it
  const canWrite = writer && (item.kind !== "option" || me.operator) && item.status !== "approved";
  const mayDelete = useMayDelete(item);
  const deleteItem = useDeleteItem(path);
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
  // Delete after the are-you-sure, against the version the panel opened with
  const remove = async () => {
    if (await deleteItem(base, label)) onClose();
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
  const ask = useAsk();
  // Deleting a comment asks first, like every delete
  const deleteComment = async (id: string) => {
    if (!(await ask({ title: "Delete this comment?", body: "It's deleted for everyone on this project.", yes: "Delete", danger: true }))) return;
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
      {/* An option's terms and scores, and a measure's unit and range, edit here too */}
      {canWrite && <KindFields kind={item.kind} f={draft.f} onChange={(f) => setDraft({ ...draft, f })} />}
      {item.status === "approved" && <p className="small muted">Approved, so its terms are part of the decision's record and can't change. A different plan is a new option.</p>}
      {(canWrite || mayDelete) && (
        <div className="actions">
          {canWrite && <button className="btn btn-primary" disabled={!dirty || !draft.title.trim() || saving} onClick={() => void save(base.version)}>{saving ? "Saving…" : "Save"}</button>}
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {mayDelete && <button className="btn btn-danger" style={{ marginLeft: "auto" }} onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" /> Delete</button>}
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
      {/* What happened to it and who did it, newest first, worded like Home's recent activity */}
      {(thread.data?.history.length ?? 0) > 0 && (
        <details className="history">
          <summary>History</summary>
          <ul className="feed">{thread.data!.history.map((h) => <li key={h.id}><span>{h.summary} <small className="by">{nameOf(h.actorId)}</small></span><time>{ago(h.at)}</time></li>)}</ul>
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
  // A kind's own fields (cost, scores, unit, and so on), one row each
  for (const k of Object.keys((mine.fields as Record<string, unknown> | undefined) ?? {})) rows.push({ label: k, mine: draft.f[k] ?? "", theirs: t.f[k] ?? "" });
  return rows;
}


// Scores run 1 to 5 where 5 is always the better end, so the words match the option card's meters
const SCORE_CHOICES: Record<string, string[]> = {
  costScore: ["Highest", "High", "Medium", "Low", "Lowest"],
  qualityScore: ["Basic", "Fair", "Good", "Very good", "Best"],
  effortScore: ["Heaviest", "Heavy", "Medium", "Light", "Lightest"],
};


/** The editors for a kind's own fields; kinds without any show nothing */
function KindFields({ kind, f, onChange }: { kind: ItemKind; f: Record<string, string>; onChange: (f: Record<string, string>) => void }) {
  const set = (k: string, v: string) => onChange({ ...f, [k]: v });
  if (kind === "option") return (
    <div className="props">
      <label>Cost<input value={f.cost ?? ""} onChange={(e) => set("cost", e.target.value)} placeholder="e.g. $4,800 fixed" maxLength={80} /></label>
      <label>Timeline<input value={f.timeline ?? ""} onChange={(e) => set("timeline", e.target.value)} placeholder="e.g. 3 weeks" maxLength={80} /></label>
      <label className="check"><input type="checkbox" checked={f.recommended === "yes"} onChange={(e) => set("recommended", e.target.checked ? "yes" : "")} /> Recommended</label>
      {/* The three ratings read as one group, on one line at every width */}
      <fieldset className="ratings">
        <legend>Ratings</legend>
        {(["costScore", "qualityScore", "effortScore"] as const).map((k) => (
          <label key={k}>{{ costScore: "Cost", qualityScore: "Quality", effortScore: "Effort" }[k]}
            <select value={f[k]} onChange={(e) => set(k, e.target.value)}>
              {SCORE_CHOICES[k]!.map((w, i) => <option key={w} value={String(i + 1)}>{w}</option>)}
            </select>
          </label>
        ))}
      </fieldset>
    </div>
  );
  if (kind === "metric") return (
    <div className="props">
      <label>Unit<input value={f.unit ?? ""} onChange={(e) => set("unit", e.target.value)} placeholder="e.g. hours" maxLength={24} /></label>
      <label>Starts at<input inputMode="decimal" value={f.baseline ?? ""} onChange={(e) => set("baseline", e.target.value.replace(/[^\d.-]/g, ""))} /></label>
      <label>Target<input inputMode="decimal" value={f.target ?? ""} onChange={(e) => set("target", e.target.value.replace(/[^\d.-]/g, ""))} /></label>
    </div>
  );
  return null;
}
