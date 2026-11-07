// apps/web/src/pages/Project.tsx - One project: an overview, then a tab per layer (Needs,
// Execute, Observe, Normalize).


import { KIND_LAYER, metricProgress, MetricFields, OptionFields, type DocumentRecord, type Item, type ItemKind, type Layer, type Project } from "@1neon/domain";
import { useEffect, useState, type ReactNode } from "react";
import { FileList, UploadButton } from "../components/Files.tsx";
import { Link, NavLink, useParams } from "react-router";
import { useOrg, useSession, useTopBar } from "../components/Shell.tsx";
import { Avatar, ConflictDialog, Dialog, Empty, Health, LayerBadge, LAYERS, layerName, ago, daysSince, useToast } from "../components/ui.tsx";
import { api, HttpError } from "../lib/api.ts";
import { problem, useMembers, useProject, useProjects, useRefresh } from "../lib/hooks.ts";
import type { EditMarker } from "../lib/types.ts";


// Singular and plural labels for each kind of item
const KIND_LABEL: Record<ItemKind, [string, string]> = {
  request: ["Request", "Requests"],
  discovery: ["Question", "Discovery"],
  asset: ["System or account", "Systems and accounts"],
  requirement: ["Requirement", "Requirements"],
  option: ["Option", "Options"],
  decision: ["Decision", "Decisions"],
  file_request: ["File needed", "Files needed"],
  task: ["Task", "Tasks"],
  milestone: ["Milestone", "Milestones"],
  change: ["Change", "Changes"],
  update: ["Update", "Status updates"],
  metric: ["Measure", "Measures"],
  check: ["Check", "Checks"],
  incident: ["Incident", "Incidents"],
  handoff: ["Handoff step", "Handoff checklist"],
  runbook: ["Runbook", "Runbooks"],
  training: ["Training", "Training"],
  care: ["Care item", "Care plan"],
  retro: ["Retro note", "Retrospective"],
};
// Kinds shown under a layer tab. Decisions appear as banners, never as editable rows
const KINDS_IN = (layer: Layer) => (Object.keys(KIND_LAYER) as ItemKind[]).filter((k) => KIND_LAYER[k] === layer && k !== "decision");
// Kinds that are done or not done, shown with a checkbox
const CHECKABLE = new Set<ItemKind>(["task", "milestone", "check", "handoff", "file_request", "requirement", "discovery", "care"]);


/** A project by key (FLOW-1): the key resolves to an ID through the project list */
export function ProjectPage() {
  const { org, summary } = useOrg();
  const { key, tab = "overview" } = useParams();
  const projects = useProjects(org.id);
  // The key resolves to an ID through the project list
  const pid = projects.data?.find((p) => p.key === key)?.id;
  const detail = useProject(org.id, pid);
  const base = `/o/${summary.slug}/projects/${key}`;
  // Breadcrumb plus the avatars of anyone editing in this project
  useTopBar(
    <span>
      <Link to={`/o/${summary.slug}/projects`}>Projects</Link> / {key}
      {detail.data && <Presence edits={detail.data.edits} />}
    </span>,
    [key, summary.slug, detail.data?.edits.map((e) => e.userId + e.recordId).join()],
  );
  // An unknown key gets a clear empty state, not a spinner
  if (projects.data && !pid) return <Empty text={`There's no project ${key} in ${org.name}.`} action={<Link className="btn btn-ghost" to={`/o/${summary.slug}/projects`}>All projects</Link>} />;
  if (!detail.data) return <p className="muted" aria-busy="true">Loading…</p>;
  const { project: p, items } = detail.data;
  // Stage progress: earlier stages are done, the current one is lit
  const stageAt = org.stages.findIndex((s) => s.id === p.stageId);
  // Item counts for each layer tab
  const count = (l: Layer) => items.filter((i) => KIND_LAYER[i.kind] === l).length;
  return (
    <>
      {/* Key, current stage with its age, then the name with health and archive state */}
      <p className="mono small muted" style={{ margin: 0 }}>{p.key} · {org.stages[stageAt]?.name} for {daysSince(p.stageEnteredAt)}d</p>
      <h1 className="page-title" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {p.name} <Health value={p.health} />
        {p.archived && <span className="tag warn">archived</span>}
      </h1>
      {/* Visible stages, with the current one marked for screen readers */}
      <div className="steps" aria-label="Stage">
        {org.stages.filter((s) => !s.hidden).map((s, i) => (
          <span key={s.id} className={s.id === p.stageId ? "on" : i < stageAt ? "done" : ""} aria-current={s.id === p.stageId ? "step" : undefined}>{s.name}</span>
        ))}
      </div>
      {/* Overview, then one tab per layer with its item count */}
      <nav className="tabs" aria-label="Project sections">
        <NavLink to={base} end className={() => (tab === "overview" ? "active" : "")}>Overview</NavLink>
        {LAYERS.map((l) => (
          <NavLink key={l} to={`${base}/${l}`}><LayerBadge layer={l} />{layerName(l)} <span className="muted">{count(l)}</span></NavLink>
        ))}
      </nav>
      {tab === "overview" ? <Overview project={p} items={items} /> : LAYERS.includes(tab as Layer) ? <LayerTab layer={tab as Layer} project={p} items={items} docs={detail.data.docs} edits={detail.data.edits} /> : <Empty text="That section doesn't exist." />}
    </>
  );
}


/** Everyone else editing something in this project, once each */
function Presence({ edits }: { edits: EditMarker[] }) {
  // The caller's own markers aren't shown back to them
  const me = useSession();
  const others = [...new Map(edits.filter((e) => e.userId !== me.user.id).map((e) => [e.userId, e])).values()];
  if (!others.length) return null;
  return (
    <span className="avs" style={{ marginLeft: 12, display: "inline-flex", verticalAlign: "middle" }}>
      {others.map((e) => <Avatar key={e.userId} id={e.userId} name={e.name} editing size={22} />)}
    </span>
  );
}


// --- Overview ---------------------------------------------------------------------


/** Overview: decision, summary and outcome, measures, status, and people */
function Overview({ project: p, items }: { project: Project; items: Item[] }) {
  const { org, canWrite } = useOrg();
  const members = useMembers(org.id);
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // Inline edit of summary and outcome, and the newer version when a save conflicts
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ summary: p.summary, outcome: p.outcome });
  const [conflict, setConflict] = useState<Project>();
  // The latest decision, measures, and status update feed the overview
  const decision = items.filter((i) => i.kind === "decision").at(-1);
  const metrics = items.filter((i) => i.kind === "metric");
  const update = items.filter((i) => i.kind === "update").at(-1);
  const names = new Map(members.data?.map((m) => [m.userId, m.name || m.email]) ?? []);

  // Save project fields; a 409 opens the conflict dialog with the newer version
  const save = async (version: number, patch: Record<string, unknown>) => {
    try {
      await api(`/t/${org.id}/projects/${p.id}`, { method: "PATCH", body: { version, ...patch } });
      setEditing(false);
      setConflict(undefined);
      toast("Saved");
    } catch (e) {
      if (e instanceof HttpError && e.status === 409 && e.body.current) setConflict(e.body.current as Project);
      else toast(problem(e));
    }
    refresh();
  };

  return (
    <div className="two">
      {/* Main column: the decision banner, summary and outcome, and measures */}
      <section>
        {decision && (
          <div className="decision">
            <b>{decision.title}</b>
            <div className="small muted">
              by {names.get(String(decision.fields.approvedBy)) ?? "a member"} · {ago(String(decision.fields.approvedAt))} · option version {String(decision.fields.optionVersion)}
            </div>
            {decision.body && <p className="small" style={{ margin: "6px 0 0" }}>Conditions: {decision.body}</p>}
          </div>
        )}
        {/* Editors can change the summary and outcome in place */}
        {editing ? (
          <form className="form" onSubmit={(e) => { e.preventDefault(); void save(p.version, draft); }}>
            <div><label htmlFor="ps">What is this?</label><textarea id="ps" value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} maxLength={500} /></div>
            <div><label htmlFor="po">Done when</label><textarea id="po" value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })} maxLength={500} /></div>
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn btn-primary" type="submit">Save</button>
              <button className="btn btn-ghost" type="button" onClick={() => { setEditing(false); setDraft({ summary: p.summary, outcome: p.outcome }); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <p className="lead" style={{ marginTop: 0 }}>{p.summary || <span className="muted">No summary yet.</span>}</p>
            <p><b>Done when:</b> {p.outcome || <span className="muted">not written yet</span>}</p>
            {canWrite && <button className="btn btn-ghost" onClick={() => { setDraft({ summary: p.summary, outcome: p.outcome }); setEditing(true); }}>Edit</button>}
          </>
        )}
        <h2 className="section-h">Measures <small>baseline → target</small></h2>
        {metrics.length === 0 ? <Empty text="No measures yet. Add them under Observe." /> : <div className="scores">{metrics.map((m) => <MetricCard key={m.id} item={m} />)}</div>}
      </section>
      {/* Side column: health, dates, latest update, flags, people, and archiving */}
      <aside>
        <h2 className="section-h" style={{ marginTop: 0 }}>Status</h2>
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="small muted">Health</span>
            {canWrite ? (
              <select aria-label="Health" value={p.health} onChange={(e) => void save(p.version, { health: e.target.value })} style={{ maxWidth: 160 }}>
                <option value="on_track">On track</option><option value="at_risk">At risk</option><option value="off_track">Off track</option><option value="not_started">Not started</option>
              </select>
            ) : <Health value={p.health} />}
          </div>
          <div className="small"><span className="muted">Target date</span> {p.targetDate ?? "none set"}</div>
          {update && <div className="small"><span className="muted">Latest update ({ago(update.updatedAt)})</span><br />{update.title}</div>}
          {p.flags.length > 0 && <div className="small"><span className="tag warn">sensitive data: {p.flags.join(", ")}</span></div>}
        </div>
        {/* Project roles, with a fallback for people who left the organization */}
        <h2 className="section-h">People</h2>
        {p.people.length === 0 ? <p className="muted small">No roles assigned yet.</p> : (
          <div className="rows">
            {p.people.map((x) => (
              <div className="row" key={x.userId} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                <Avatar id={x.userId} name={names.get(x.userId) ?? "?"} />
                <span>{names.get(x.userId) ?? "Former member"}</span>
                <span className="s">{x.role.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        )}
        {canWrite && (
          <p className="small" style={{ marginTop: 18 }}>
            <button className="linkish" onClick={() => void save(p.version, { archived: !p.archived })}>{p.archived ? "Restore from archive" : "Archive this project"}</button>
          </p>
        )}
      </aside>
      {/* Keep mine saves again over their version; Take theirs drops the draft */}
      <ConflictDialog
        open={Boolean(conflict)}
        who={names.get(conflict?.updatedBy ?? "") ?? "Someone"}
        fields={conflict ? [{ label: "Summary", mine: draft.summary, theirs: conflict.summary }, { label: "Done when", mine: draft.outcome, theirs: conflict.outcome }] : []}
        onKeepMine={() => conflict && void save(conflict.version, draft)}
        onTakeTheirs={() => { setConflict(undefined); setEditing(false); refresh(); }}
        onClose={() => setConflict(undefined)}
      />
    </div>
  );
}


/** A measure: latest reading (or the baseline), the range, and progress toward the target */
function MetricCard({ item, onReading }: { item: Item; onReading?: (value: number) => void }) {
  // Fields are validated on read, so a malformed record can't break the page
  const m = MetricFields.parse(item.fields);
  const latest = m.readings.at(-1);
  const pct = metricProgress(m);
  // The reading being typed
  const [value, setValue] = useState("");
  return (
    <div className="card metric">
      <div className="small">{item.title}</div>
      <div className="val">{latest ? `${latest.value}${m.unit ? ` ${m.unit}` : ""}` : m.baseline !== undefined ? `${m.baseline}${m.unit ? ` ${m.unit}` : ""}` : "–"}</div>
      <div className="range">{latest ? `latest, ${latest.at}` : "baseline, no readings yet"}</div>
      <div className="range">
        {m.baseline ?? "?"} → {m.target ?? "?"} {m.unit} · {m.direction === "down" ? "lower is better" : "higher is better"}
      </div>
      {pct !== undefined && <div className="progress" role="img" aria-label={`${Math.round(pct * 100)} percent of the way`}><i style={{ width: `${pct * 100}%` }} /></div>}
      {/* Editors log a reading dated today */}
      {onReading && (
        <form style={{ display: "flex", gap: 6, marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); const n = Number(value); if (value.trim() && !Number.isNaN(n)) { onReading(n); setValue(""); } }}>
          <input aria-label={`New reading for ${item.title}`} inputMode="decimal" placeholder="Today's reading" value={value} onChange={(e) => setValue(e.target.value)} style={{ minHeight: 32, padding: "4px 10px" }} />
          <button className="btn btn-ghost" style={{ minHeight: 32, padding: "4px 12px" }}>Add</button>
        </form>
      )}
    </div>
  );
}


// --- Layer tabs ---------------------------------------------------------------------


/** One layer's items, grouped by kind, with add forms for people who can write */
function LayerTab({ layer, project, items, docs, edits }: { layer: Layer; project: Project; items: Item[]; docs: DocumentRecord[]; edits: EditMarker[] }) {
  const { org, canWrite } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // Every item call goes through this project's API path
  const path = `/t/${org.id}/projects/${project.id}`;
  const decisions = items.filter((i) => i.kind === "decision");

  // Quick edits (done, readings): on a conflict, say so and show the latest instead of a dialog
  const patch = async (item: Item, body: Record<string, unknown>) => {
    try {
      await api(`${path}/items/${item.id}`, { method: "PATCH", body: { version: item.version, ...body } });
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) toast(`Someone changed "${item.title}" first. Showing the latest now.`);
      else toast(problem(e));
    }
    refresh();
  };

  return (
    <>
      {/* Approved decisions sit at the top of Needs as read-only banners */}
      {layer === "needs" && decisions.map((d) => (
        <div className="decision" key={d.id}><b>{d.title}</b><div className="small muted">{ago(String(d.fields.approvedAt))} · option version {String(d.fields.optionVersion)}</div></div>
      ))}
      {KINDS_IN(layer).map((kind) => {
        const list = items.filter((i) => i.kind === kind);
        // Viewers see only groups with content, plus Requests, which they may add to
        if (!list.length && !canWrite && kind !== "request") return null;
        return (
          <section className="kind-group" key={kind}>
            <h2 className="section-h">{KIND_LABEL[kind][1]} <small>{list.length}</small></h2>
            {/* Options compare side by side, measures show as cards, everything else as rows */}
            {kind === "option" ? (
              <Options items={list} path={path} />
            ) : kind === "metric" ? (
              list.length ? <div className="scores">{list.map((m) => (
                <MetricCard key={m.id} item={m} onReading={canWrite ? (value) => {
                  const f = MetricFields.parse(m.fields);
                  void patch(m, { fields: { readings: [...f.readings, { at: new Date().toISOString().slice(0, 10), value, note: "" }] } });
                } : undefined} />
              ))}</div> : null
            ) : (
              <div>{list.map((i) => (
                <ItemRow key={i.id} item={i} path={path} marker={edits.find((e) => e.recordId === i.id)} onToggle={CHECKABLE.has(kind) && canWrite ? () => void patch(i, { status: i.status === "done" ? "open" : "done" }) : undefined}
                  extra={kind === "file_request" ? <FileAsk item={i} docs={docs.filter((d) => d.itemId === i.id)} /> : undefined} />
              ))}</div>
            )}
            {(canWrite || kind === "request") && <AddItem kind={kind} path={path} />}
          </section>
        );
      })}
      {/* Every file filed under this layer of the project; anyone in the organization can add one */}
      <section className="kind-group">
        <h2 className="section-h">Files <small>{docs.filter((d) => d.uploaded && d.layer === layer).length}</small></h2>
        <FileList docs={docs.filter((d) => d.layer === layer)} empty={`No ${layerName(layer)} files yet.`} />
        <div className="actions" style={{ marginTop: 10 }}><UploadButton target={{ layer, projectId: project.id }} label={`Upload ${layerName(layer)} files`} /></div>
      </section>
    </>
  );
}


/** Under a "file needed" item: what's been sent so far, and an Upload that checks the item off */
function FileAsk({ item, docs }: { item: Item; docs: DocumentRecord[] }) {
  const sent = docs.filter((d) => d.uploaded);
  return (
    <div className="file-ask">
      {sent.map((d) => <span key={d.id} className="tag client">{d.name}</span>)}
      <UploadButton target={{ layer: "needs", projectId: item.projectId, itemId: item.id }} label={sent.length ? "Send another" : "Upload"} className="chip" />
    </div>
  );
}


/** One item: view, edit with presence and conflict handling, check off, or remove */
function ItemRow({ item, path, marker, onToggle, extra }: { item: Item; path: string; marker?: EditMarker; onToggle?: () => void; extra?: ReactNode }) {
  const { org, canWrite } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // Inline edit state, and the newer version when a save conflicts
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: item.title, body: item.body });
  const [conflict, setConflict] = useState<Item>();
  const members = useMembers(org.id);
  // Names for the conflict dialog; anyone unknown is "Someone"
  const nameOf = (uid?: string) => members.data?.find((m) => m.userId === uid)?.name || "Someone";
  // Someone else's live marker on this item, if any
  const otherEditing = marker && marker.userId !== me.user.id ? marker : undefined;

  // While editing, hold an edit marker so others see it, renew it, and release it on close
  useEffect(() => {
    if (!editing) return;
    // Advisory marker: others see who is editing; it expires on its own if this tab closes
    void api<{ ok: boolean; holder?: EditMarker }>(`${path}/edits`, { method: "POST", body: { recordId: item.id } }).catch(() => undefined);
    // Renew the marker every minute, well inside its two-minute expiry
    const beat = window.setInterval(() => void api(`${path}/edits`, { method: "POST", body: { recordId: item.id } }).catch(() => undefined), 45_000);
    return () => {
      window.clearInterval(beat);
      void api(`${path}/edits/${item.id}`, { method: "DELETE" }).catch(() => undefined);
    };
  }, [editing, item.id, path]);

  // Save title and details against the version read; a 409 opens the conflict dialog
  const save = async (version: number) => {
    try {
      await api(`${path}/items/${item.id}`, { method: "PATCH", body: { version, title: draft.title, body: draft.body } });
      setEditing(false);
      setConflict(undefined);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409 && e.body.current) setConflict(e.body.current as Item);
      else toast(problem(e));
    }
    refresh();
  };
  // Remove after confirming; the version guard stops removing an item someone just changed
  const remove = async () => {
    if (!confirm(`Remove "${item.title}"?`)) return;
    try {
      await api(`${path}/items/${item.id}?version=${item.version}`, { method: "DELETE" });
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };

  return (
    <div className="item">
      {/* A checkbox for checkable kinds, an empty cell otherwise */}
      {onToggle ? <input type="checkbox" checked={item.status === "done"} onChange={onToggle} aria-label={`Done: ${item.title}`} /> : <span style={{ width: 18 }} />}
      {/* Edit form with a warning when someone else is editing too; otherwise the item and who is on it */}
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); void save(item.version); }} style={{ display: "grid", gap: 8 }}>
          {otherEditing && <p className="notice small" style={{ margin: 0 }}>{otherEditing.name} is editing this too. If you both save, you'll choose which to keep.</p>}
          <input aria-label="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={160} required autoFocus />
          <textarea aria-label="Details" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" type="submit">Save</button>
            <button className="btn btn-ghost" type="button" onClick={() => { setEditing(false); setDraft({ title: item.title, body: item.body }); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <div>
          <div className="title" style={item.status === "done" ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>{item.title}</div>
          {item.body && <div className="body">{item.body}</div>}
          {otherEditing && <div className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}><Avatar id={otherEditing.userId} name={otherEditing.name} editing size={18} /> {otherEditing.name} is editing</div>}
          {extra}
        </div>
      )}
      {/* Edit and Remove for editors */}
      {!editing && canWrite ? (
        <span style={{ display: "flex", gap: 6 }}>
          <button className="linkish small" onClick={() => { setDraft({ title: item.title, body: item.body }); setEditing(true); }}>Edit</button>
          <button className="linkish small" onClick={() => void remove()} aria-label={`Remove ${item.title}`}>Remove</button>
        </span>
      ) : <span />}
      <ConflictDialog
        open={Boolean(conflict)}
        who={nameOf(conflict?.updatedBy)}
        fields={conflict ? [{ label: "Title", mine: draft.title, theirs: conflict.title }, { label: "Details", mine: draft.body, theirs: conflict.body }] : []}
        onKeepMine={() => conflict && void save(conflict.version)}
        onTakeTheirs={() => { setConflict(undefined); setEditing(false); refresh(); }}
        onClose={() => setConflict(undefined)}
      />
    </div>
  );
}


/** The inline form that adds an item of one kind */
function AddItem({ kind, path }: { kind: ItemKind; path: string }) {
  const { org } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // Closed to a link until someone adds; extra holds the measure and option fields
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [extra, setExtra] = useState({ unit: "", baseline: "", target: "", cost: "" });
  if (!open) return <button className="linkish small" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>+ Add {KIND_LABEL[kind][0].toLowerCase()}</button>;
  // Blank or non-numeric values are left unset
  const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));
  // Measures and options carry extra fields; every kind gets a title and details
  const submit = async () => {
    const fields: Record<string, unknown> = {};
    if (kind === "metric") Object.assign(fields, { unit: extra.unit, baseline: num(extra.baseline), target: num(extra.target) });
    if (kind === "option") Object.assign(fields, { cost: extra.cost });
    try {
      await api(`${path}/items`, { method: "POST", body: { kind, title: title.trim(), body, fields } });
      setTitle("");
      setBody("");
      setOpen(false);
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };
  return (
    <form className="card" style={{ display: "grid", gap: 8, marginTop: 10, padding: 14 }} onSubmit={(e) => { e.preventDefault(); if (title.trim()) void submit(); }}>
      <input aria-label={`${KIND_LABEL[kind][0]} title`} placeholder={`${KIND_LABEL[kind][0]}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required autoFocus />
      <textarea aria-label="Details" placeholder="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 60 }} />
      {/* Measures need a unit, a baseline, and a target; options need a cost */}
      {kind === "metric" && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <input aria-label="Unit" placeholder="Unit" value={extra.unit} onChange={(e) => setExtra({ ...extra, unit: e.target.value })} />
          <input aria-label="Now" placeholder="Now" inputMode="decimal" value={extra.baseline} onChange={(e) => setExtra({ ...extra, baseline: e.target.value })} />
          <input aria-label="Target" placeholder="Target" inputMode="decimal" value={extra.target} onChange={(e) => setExtra({ ...extra, target: e.target.value })} />
        </div>
      )}
      {kind === "option" && <input aria-label="Cost" placeholder="Cost, such as $4,800 fixed" value={extra.cost} onChange={(e) => setExtra({ ...extra, cost: e.target.value })} />}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" type="submit">Add</button>
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}


/** A 1 to 5 bar; cost and effort are inverted so more bars always means better */
function Meter({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const v = invert ? 6 - value : value;
  return (
    <div className="meter" role="img" aria-label={`${label}: ${value} of 5`}>
      <span>{label}</span>
      <span className="bar">{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= v ? "on" : ""} />)}</span>
    </div>
  );
}


/** Options side by side: draft, shared for approval, approved; approving records a decision */
function Options({ items, path }: { items: Item[]; path: string }) {
  const { org, canWrite } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // The option waiting on approval, and the conditions being typed
  const [approving, setApproving] = useState<Item>();
  const [conditions, setConditions] = useState("");
  if (!items.length) return null;
  // Move an option between draft, proposed, and declined
  const setStatus = async (o: Item, status: string) => {
    try {
      await api(`${path}/items/${o.id}`, { method: "PATCH", body: { version: o.version, status } });
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };
  // Approve the exact version on screen; if it changed meanwhile, the API refuses and we say so
  const approve = async () => {
    const o = approving;
    setApproving(undefined);
    if (!o) return;
    try {
      await api(`${path}/items/${o.id}/approve`, { method: "POST", body: { version: o.version, conditions } });
      toast(`Approved: ${o.title}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) toast("That option changed since you opened it. Review it again, then approve.");
      else toast(problem(e));
    }
    refresh();
  };
  return (
    <>
      <div className="options">
        {items.map((o) => {
          // Fields are validated on read, so a malformed option can't break the board
          const f = OptionFields.parse(o.fields);
          return (
            <article key={o.id} className={`card option${f.recommended ? " rec" : ""}`}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {f.recommended && <span className="tag rec">recommended</span>}
                <span className={`tag${o.status === "approved" ? " client" : ""}`}>{o.status}</span>
              </div>
              <h4>{o.title}</h4>
              {o.body && <p className="small muted" style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>{o.body}</p>}
              {f.cost && <p className="mono small" style={{ margin: "0 0 8px" }}>{f.cost}{f.timeline ? ` · ${f.timeline}` : ""}</p>}
              {/* Cost, quality, and effort, scored so more bars is always better */}
              <Meter label="Cost" value={f.costScore} invert />
              <Meter label="Quality" value={f.qualityScore} />
              <Meter label="Effort" value={f.effortScore} invert />
              {/* Anyone may approve a proposed option; editors move drafts along */}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {o.status === "proposed" && <button className="btn btn-primary" onClick={() => { setConditions(""); setApproving(o); }}>Approve</button>}
                {canWrite && o.status === "draft" && <button className="btn btn-ghost" onClick={() => void setStatus(o, "proposed")}>Share with client</button>}
                {canWrite && o.status === "proposed" && <button className="btn btn-ghost" onClick={() => void setStatus(o, "draft")}>Back to draft</button>}
              </div>
            </article>
          );
        })}
      </div>
      {/* Approval confirmation with optional conditions */}
      <Dialog open={Boolean(approving)} onClose={() => setApproving(undefined)} label="Approve option">
        <h2>Approve "{approving?.title}"?</h2>
        <p className="muted small">This records a decision tied to this exact version of the option. It can't be edited afterwards; a later change needs a new approval.</p>
        <label htmlFor="cond">Conditions (optional)</label>
        <textarea id="cond" value={conditions} onChange={(e) => setConditions(e.target.value)} maxLength={2000} placeholder="Approved if the work happens after 6pm." />
        <div className="actions">
          <button className="btn btn-primary" onClick={() => void approve()}>Approve</button>
          <button className="btn btn-ghost" onClick={() => setApproving(undefined)}>Cancel</button>
        </div>
      </Dialog>
    </>
  );
}
