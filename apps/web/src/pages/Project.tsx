// One project: an overview, then a tab per layer (Needs, Execution, Observation, Next).
import { KIND_LAYER, metricProgress, MetricFields, OptionFields, type Item, type ItemKind, type Layer, type Project } from "@1neon/domain";
import { useEffect, useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import { useOrg, useSession, useTopBar } from "../components/Shell.tsx";
import { Avatar, ConflictDialog, Dialog, Empty, Health, LayerBadge, LAYERS, layerName, ago, daysSince, useToast } from "../components/ui.tsx";
import { api, HttpError } from "../lib/api.ts";
import { problem, useMembers, useProject, useProjects, useRefresh } from "../lib/hooks.ts";
import type { EditMarker } from "../lib/types.ts";

const KIND_LABEL: Record<ItemKind, [string, string]> = {
  request: ["Request", "Requests"],
  discovery: ["Question", "Discovery"],
  asset: ["System or account", "Systems and accounts"],
  requirement: ["Requirement", "Requirements"],
  option: ["Option", "Options"],
  decision: ["Decision", "Decisions"],
  file_request: ["File request", "Files we need"],
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
const KINDS_IN = (layer: Layer) => (Object.keys(KIND_LAYER) as ItemKind[]).filter((k) => KIND_LAYER[k] === layer && k !== "decision");
const CHECKABLE = new Set<ItemKind>(["task", "milestone", "check", "handoff", "file_request", "requirement", "discovery", "care"]);

export function ProjectPage() {
  const { org, summary } = useOrg();
  const { key, tab = "overview" } = useParams();
  const projects = useProjects(org.id);
  const pid = projects.data?.find((p) => p.key === key)?.id;
  const detail = useProject(org.id, pid);
  const base = `/o/${summary.slug}/projects/${key}`;
  useTopBar(
    <span>
      <Link to={`/o/${summary.slug}/projects`}>Projects</Link> / {key}
      {detail.data && <Presence edits={detail.data.edits} />}
    </span>,
    [key, summary.slug, detail.data?.edits.map((e) => e.userId + e.recordId).join()],
  );
  if (projects.data && !pid) return <Empty text={`There's no project ${key} in ${org.name}.`} action={<Link className="btn btn-ghost" to={`/o/${summary.slug}/projects`}>All projects</Link>} />;
  if (!detail.data) return <p className="muted" aria-busy="true">Loading…</p>;
  const { project: p, items } = detail.data;
  const stageAt = org.stages.findIndex((s) => s.id === p.stageId);
  const count = (l: Layer) => items.filter((i) => KIND_LAYER[i.kind] === l).length;
  return (
    <>
      <p className="mono small muted" style={{ margin: 0 }}>{p.key} · {org.stages[stageAt]?.name} for {daysSince(p.stageEnteredAt)}d</p>
      <h1 className="page-title" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {p.name} <Health value={p.health} />
        {p.archived && <span className="tag warn">archived</span>}
      </h1>
      <div className="steps" aria-label="Stage">
        {org.stages.filter((s) => !s.hidden).map((s, i) => (
          <span key={s.id} className={s.id === p.stageId ? "on" : i < stageAt ? "done" : ""} aria-current={s.id === p.stageId ? "step" : undefined}>{s.name}</span>
        ))}
      </div>
      <nav className="tabs" aria-label="Project sections">
        <NavLink to={base} end className={() => (tab === "overview" ? "active" : "")}>Overview</NavLink>
        {LAYERS.map((l) => (
          <NavLink key={l} to={`${base}/${l}`}><LayerBadge layer={l} />{layerName(l)} <span className="muted">{count(l)}</span></NavLink>
        ))}
      </nav>
      {tab === "overview" ? <Overview project={p} items={items} /> : LAYERS.includes(tab as Layer) ? <LayerTab layer={tab as Layer} project={p} items={items} edits={detail.data.edits} /> : <Empty text="That section doesn't exist." />}
    </>
  );
}

function Presence({ edits }: { edits: EditMarker[] }) {
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

function Overview({ project: p, items }: { project: Project; items: Item[] }) {
  const { org, canWrite } = useOrg();
  const members = useMembers(org.id);
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ summary: p.summary, outcome: p.outcome });
  const [conflict, setConflict] = useState<Project>();
  const decision = items.filter((i) => i.kind === "decision").at(-1);
  const metrics = items.filter((i) => i.kind === "metric");
  const update = items.filter((i) => i.kind === "update").at(-1);
  const names = new Map(members.data?.map((m) => [m.userId, m.name || m.email]) ?? []);

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
        {metrics.length === 0 ? <Empty text="No measures yet. Add them under Observation." /> : <div className="scores">{metrics.map((m) => <MetricCard key={m.id} item={m} />)}</div>}
      </section>
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

function MetricCard({ item, onReading }: { item: Item; onReading?: (value: number) => void }) {
  const m = MetricFields.parse(item.fields);
  const latest = m.readings.at(-1);
  const pct = metricProgress(m);
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

function LayerTab({ layer, project, items, edits }: { layer: Layer; project: Project; items: Item[]; edits: EditMarker[] }) {
  const { org, canWrite } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const path = `/t/${org.id}/projects/${project.id}`;
  const decisions = items.filter((i) => i.kind === "decision");

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
      {layer === "needs" && decisions.map((d) => (
        <div className="decision" key={d.id}><b>{d.title}</b><div className="small muted">{ago(String(d.fields.approvedAt))} · option version {String(d.fields.optionVersion)}</div></div>
      ))}
      {KINDS_IN(layer).map((kind) => {
        const list = items.filter((i) => i.kind === kind);
        if (!list.length && !canWrite && kind !== "request") return null;
        return (
          <section className="kind-group" key={kind}>
            <h2 className="section-h">{KIND_LABEL[kind][1]} <small>{list.length}</small></h2>
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
              <div>{list.map((i) => <ItemRow key={i.id} item={i} path={path} marker={edits.find((e) => e.recordId === i.id)} onToggle={CHECKABLE.has(kind) && canWrite ? () => void patch(i, { status: i.status === "done" ? "open" : "done" }) : undefined} />)}</div>
            )}
            {(canWrite || kind === "request") && <AddItem kind={kind} path={path} />}
          </section>
        );
      })}
    </>
  );
}

function ItemRow({ item, path, marker, onToggle }: { item: Item; path: string; marker?: EditMarker; onToggle?: () => void }) {
  const { org, canWrite } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: item.title, body: item.body });
  const [conflict, setConflict] = useState<Item>();
  const members = useMembers(org.id);
  const nameOf = (uid?: string) => members.data?.find((m) => m.userId === uid)?.name || "Someone";
  const otherEditing = marker && marker.userId !== me.user.id ? marker : undefined;

  useEffect(() => {
    if (!editing) return;
    // Advisory marker: others see who is editing; it expires on its own if this tab closes.
    void api<{ ok: boolean; holder?: EditMarker }>(`${path}/edits`, { method: "POST", body: { recordId: item.id } }).catch(() => undefined);
    const beat = window.setInterval(() => void api(`${path}/edits`, { method: "POST", body: { recordId: item.id } }).catch(() => undefined), 45_000);
    return () => {
      window.clearInterval(beat);
      void api(`${path}/edits/${item.id}`, { method: "DELETE" }).catch(() => undefined);
    };
  }, [editing, item.id, path]);

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
      {onToggle ? <input type="checkbox" checked={item.status === "done"} onChange={onToggle} aria-label={`Done: ${item.title}`} /> : <span style={{ width: 18 }} />}
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
        </div>
      )}
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

function AddItem({ kind, path }: { kind: ItemKind; path: string }) {
  const { org } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [extra, setExtra] = useState({ unit: "", baseline: "", target: "", cost: "" });
  if (!open) return <button className="linkish small" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>+ Add {KIND_LABEL[kind][0].toLowerCase()}</button>;
  const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));
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

function Meter({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const v = invert ? 6 - value : value;
  return (
    <div className="meter" role="img" aria-label={`${label}: ${value} of 5`}>
      <span>{label}</span>
      <span className="bar">{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= v ? "on" : ""} />)}</span>
    </div>
  );
}

function Options({ items, path }: { items: Item[]; path: string }) {
  const { org, canWrite } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [approving, setApproving] = useState<Item>();
  const [conditions, setConditions] = useState("");
  if (!items.length) return null;
  const setStatus = async (o: Item, status: string) => {
    try {
      await api(`${path}/items/${o.id}`, { method: "PATCH", body: { version: o.version, status } });
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };
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
              <Meter label="Cost" value={f.costScore} invert />
              <Meter label="Quality" value={f.qualityScore} />
              <Meter label="Effort" value={f.effortScore} invert />
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {o.status === "proposed" && <button className="btn btn-primary" onClick={() => { setConditions(""); setApproving(o); }}>Approve</button>}
                {canWrite && o.status === "draft" && <button className="btn btn-ghost" onClick={() => void setStatus(o, "proposed")}>Share with client</button>}
                {canWrite && o.status === "proposed" && <button className="btn btn-ghost" onClick={() => void setStatus(o, "draft")}>Back to draft</button>}
              </div>
            </article>
          );
        })}
      </div>
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
