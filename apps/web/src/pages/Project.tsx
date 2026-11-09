// apps/web/src/pages/Project.tsx - One project: an overview, then a tab per layer (Needs,
// Execute, Observe, Normalize).


import { betterWhen, canApprove, KIND_LAYER, metricProgress, MetricFields, OptionFields, ProjectRole, type DocumentRecord, type Item, type ItemKind, type Layer, type Project, type Stage } from "@1neon/domain";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { FileList, UploadButton } from "../components/Files.tsx";
import { GUIDE, Pick, RequestBuilder, Starters } from "../components/Guide.tsx";
import { ItemPanel, STATUS_WORDS } from "../components/ItemPanel.tsx";
import { gate, Stale } from "../components/Reads.tsx";
import { Link, NavLink, useLocation, useParams } from "react-router";
import { useOrg, useSession, useTopBar } from "../components/Shell.tsx";
import { Avatar, ConflictDialog, Dialog, Empty, Health, LayerBadge, LAYERS, layerName, layerProgress, OnionProgress, Trend, ago, dateLabel, daysSince, layerFromSlug, layerSlug, useToast } from "../components/ui.tsx";
import { api, HttpError } from "../lib/api.ts";
import { problem, useMembers, useProject, useProjects, useRefresh, useSubmit } from "../lib/hooks.ts";
import { aimBetween } from "../lib/motion.ts";
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
  // The list first (it turns the key into an ID), then the project; a failure says so with Try again
  const out = { to: `/o/${summary.slug}/projects`, label: "All projects" };
  const waitList = gate([projects], { out });
  if (waitList) return waitList;
  // An unknown key gets a clear empty state, not a spinner
  if (!pid) return <Empty text={`There's no project ${key} in ${org.name}.`} action={<Link className="btn btn-ghost" to={out.to}>All projects</Link>} />;
  const wait = gate([detail], { out });
  if (wait || !detail.data) return wait;
  const { project: p, items } = detail.data;
  // Stage progress: earlier stages are done, the current one is lit
  const stageAt = org.stages.findIndex((s) => s.id === p.stageId);
  // The open tab's position, so moving to a later tab pans left and an earlier one pans right
  const at = tab === "overview" ? 0 : LAYERS.indexOf(tab as Layer) + 1;
  // Item counts for each layer tab
  // A measure counts as done once its latest reading reaches the target
  const prog = layerProgress(items.map((i) => (i.kind === "metric" && (metricProgress(MetricFields.parse(i.fields)) ?? 0) >= 1 ? { ...i, status: "done" } : i)), (k) => KIND_LAYER[k as ItemKind]);
  return (
    <>
      {/* Shown data that a refresh couldn't update is marked, so nobody acts on it unknowingly */}
      <Stale reads={[projects, detail]} />
      {/* Key, current stage with its age, then the name with health and archive state */}
      <p className="mono small muted" style={{ margin: 0 }}>{p.key} · {org.stages[stageAt]?.name} for {daysSince(p.stageEnteredAt)}d</p>
      <h1 className="page-title" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {p.name} <Health value={p.health} />
        <OnionProgress progress={prog} size={44} />
        {p.archived && <span className="tag warn">archived</span>}
      </h1>
      {/* Visible stages plus the project's own even if hidden; "done" counts by position among all stages */}
      <div className="steps" aria-label="Stage" data-tour="stage">
        {org.stages.map((s, i) => (!s.hidden || s.id === p.stageId) && (
          <span key={s.id} className={s.id === p.stageId ? "on" : i < stageAt ? "done" : ""} aria-current={s.id === p.stageId ? "step" : undefined}>{s.name}</span>
        ))}
      </div>
      {/* What to do now, worked out from the stage and the items */}
      <NextStep project={p} items={items} stage={org.stages[stageAt]} base={base} />
      {/* Overview, then one tab per layer with its item count; at is the open tab's position */}
      <nav className="tabs" aria-label="Project sections" data-tour="layers">
        <NavLink to={base} end viewTransition onClick={() => aimBetween(at, 0)} className={() => (tab === "overview" ? "active" : "")}>Overview</NavLink>
        {LAYERS.map((l, i) => (
          <NavLink key={l} to={`${base}/${layerSlug(l)}`} viewTransition onClick={() => aimBetween(at, i + 1)}><LayerBadge layer={l} />{layerName(l)} {prog[l][1] > 0 && <span className="muted" aria-label={`${prog[l][0]} of ${prog[l][1]} done`} title={`${prog[l][0]} of ${prog[l][1]} done`}>{prog[l][0]}/{prog[l][1]}</span>}</NavLink>
        ))}
      </nav>
      {/* The section under the tabs pans by tab order */}
      <div className="slide-stage">
      {tab === "overview" ? <Overview project={p} items={items} /> : layerFromSlug(tab) ? <LayerTab layer={layerFromSlug(tab)!} project={p} items={items} docs={detail.data.docs} edits={detail.data.edits} /> : <Empty text="That section doesn't exist." />}
      </div>
    </>
  );
}


/** The one thing to do next on this project, and who it's waiting on */
function NextStep({ project: p, items, stage, base }: { project: Project; items: Item[]; stage?: Stage; base: string }) {
  const { org, access } = useOrg();
  const me = useSession();
  const members = useMembers(org.id);
  const names = new Map(members.data?.map((m) => [m.userId, m.name || m.email]) ?? []);
  const actor = { userId: me.user.id, operator: me.operator, strongSession: false };
  // Once an option is approved, the others stop asking for a decision
  const decided = items.some((i) => i.kind === "option" && i.status === "approved");
  const proposed = decided ? [] : items.filter((i) => i.kind === "option" && i.status === "proposed");
  const files = items.filter((i) => i.kind === "file_request" && i.status !== "done");
  const mine = items.filter((i) => i.assigneeId === me.user.id && i.status !== "done");
  const deciders = p.people.filter((x) => x.role === "decision_maker").map((x) => names.get(x.userId) ?? "the decision maker");
  // The most pressing step first: a decision, then files, then the caller's own work, then the stage's goal
  let text: ReactNode;
  let action: { to: string; label: string } | undefined;
  if (proposed.length && canApprove(actor, access, p.people).ok) {
    text = <>Choose an option: {proposed.length} {proposed.length === 1 ? "is" : "are"} ready for your approval.</>;
    action = { to: `${base}/needs#options`, label: "Compare options" };
  } else if (proposed.length) {
    text = <>Waiting on {deciders.length ? deciders.join(" or ") : "an admin of the client"} to choose an option.</>;
    action = { to: `${base}/needs#options`, label: "See options" };
  } else if (files.length && !me.operator) {
    text = <>Send {files.length} {files.length === 1 ? "file" : "files"} so the work can go on.</>;
    action = { to: `${base}/needs#files`, label: "Upload" };
  } else if (mine.length) {
    text = <>You have {mine.length} open {mine.length === 1 ? "item" : "items"} here.</>;
    action = { to: `${base}/${layerSlug(KIND_LAYER[mine[0]!.kind])}#item-${mine[0]!.id}`, label: "Open" };
  } else if (stage?.exit) {
    text = <>To finish <b>{stage.name}</b>: {stage.exit.charAt(0).toLowerCase() + stage.exit.slice(1)}.</>;
  } else {
    text = <>Nothing needs doing right now.</>;
  }
  return (
    <div className="next-step" data-tour="next-step" role="status">
      <span className="eyebrow">Next step</span>
      <p>{text}</p>
      {action && <Link className="btn btn-primary btn-sm" to={action.to}>{action.label} <ArrowRight size={14} aria-hidden="true" /></Link>}
    </div>
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
  const { org, canWrite, access } = useOrg();
  const me = useSession();
  const members = useMembers(org.id);
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // Inline edit of summary and outcome. `editBase` is the version the edit started from, so a save
  // after someone else's change conflicts instead of silently writing over it
  const [editing, setEditing] = useState(false);
  const [editBase, setEditBase] = useState(p.version);
  const [draft, setDraft] = useState({ summary: p.summary, outcome: p.outcome });
  // A save that hit a newer version: that version, and the change being saved, until the person chooses
  const [conflict, setConflict] = useState<{ current: Project; patch: Record<string, unknown> }>();
  const [peopleOpen, setPeopleOpen] = useState(false);
  // A written status update with its health, shown on Home; one post at a time
  const [posting, setPosting] = useState(false);
  const [post, setPost] = useState({ title: "", health: p.health as string });
  const [sending, runSend] = useSubmit();
  const postUpdate = () => runSend(async () => {
    try {
      await api(`/t/${org.id}/projects/${p.id}/items`, { method: "POST", body: { kind: "update", title: post.title, fields: { health: post.health } } });
      setPosting(false);
      setPost({ title: "", health: post.health });
      toast("Update posted");
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  });
  // The latest decision, measures, and status update feed the overview
  const decision = items.filter((i) => i.kind === "decision").at(-1);
  const metrics = items.filter((i) => i.kind === "metric");
  const update = items.filter((i) => i.kind === "update").at(-1);
  const names = new Map(members.data?.map((m) => [m.userId, m.name || m.email]) ?? []);

  // Save project fields against `version`; a 409 opens the conflict dialog with the newer version
  const save = async (version: number, patch: Record<string, unknown>) => {
    try {
      await api(`/t/${org.id}/projects/${p.id}`, { method: "PATCH", body: { version, ...patch } });
      if ("summary" in patch || "outcome" in patch) setEditing(false);
      setConflict(undefined);
      toast("Saved");
    } catch (e) {
      if (e instanceof HttpError && e.status === 409 && e.body.current) setConflict({ current: e.body.current as Project, patch });
      else toast(problem(e));
    }
    refresh();
  };
  // The summary edit started from an older version than the one now on screen
  const newerWhileEditing = editing && p.version > editBase && (draft.summary !== p.summary || draft.outcome !== p.outcome);
  // The rows the conflict dialog compares: only the fields this save was changing
  const people = (list: Project["people"]) => list.map((x) => `${names.get(x.userId) ?? "Former member"} (${x.role.replace("_", " ")})`).join(", ");
  const conflictFields = conflict ? [
    ...("summary" in conflict.patch ? [{ label: "Summary", mine: String(conflict.patch.summary), theirs: conflict.current.summary }] : []),
    ...("outcome" in conflict.patch ? [{ label: "Done when", mine: String(conflict.patch.outcome), theirs: conflict.current.outcome }] : []),
    ...("people" in conflict.patch ? [{ label: "People", mine: people(conflict.patch.people as Project["people"]), theirs: people(conflict.current.people) }] : []),
    ...("health" in conflict.patch ? [{ label: "Health", mine: String(conflict.patch.health).replace("_", " "), theirs: conflict.current.health.replace("_", " ") }] : []),
    ...("archived" in conflict.patch ? [{ label: "Archived", mine: conflict.patch.archived ? "yes" : "no", theirs: conflict.current.archived ? "yes" : "no" }] : []),
  ] : [];

  return (
    <div className="two">
      {/* Main column: the decision banner, summary and outcome, and measures */}
      <section>
        {decision && <DecisionCard d={decision} names={names} />}
        {/* Editors can change the summary and outcome in place */}
        {editing ? (
          <form className="form" onSubmit={(e) => { e.preventDefault(); void save(editBase, draft); }}>
            {newerWhileEditing && <p className="notice newer" role="status">{names.get(p.updatedBy) ?? "Someone"} saved a newer version while you were editing. Your text is kept; Save asks which version to keep.</p>}
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
            {canWrite && <button className="btn btn-ghost" onClick={() => { setDraft({ summary: p.summary, outcome: p.outcome }); setEditBase(p.version); setEditing(true); }}>Edit</button>}
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
          {/* The target date: editors change it in place; clearing it leaves the project open-ended */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="small muted">Target date</span>
            {canWrite ? (
              <input type="date" aria-label="Target date" value={p.targetDate ?? ""} style={{ width: "auto", minHeight: 36, padding: "4px 10px" }}
                onChange={(e) => void save(p.version, { targetDate: e.target.value || null })} />
            ) : <span className="small">{p.targetDate ? dateLabel(p.targetDate) : "none set"}</span>}
          </div>
          {update && <div className="small"><span className="muted">Latest update ({ago(update.updatedAt)})</span><br />{update.title}</div>}
          {canWrite && <button className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} onClick={() => setPosting(true)}>Post an update</button>}
          {p.flags.length > 0 && <div className="small"><span className="tag warn">sensitive data: {p.flags.join(", ")}</span></div>}
        </div>
        {/* Project roles, with a fallback for people who left the organization */}
        <h2 className="section-h">People {canWrite && <button className="link small" onClick={() => setPeopleOpen(true)}>Edit</button>}</h2>
        {!p.people.some((x) => x.role === "decision_maker") && <p className="notice small">No decision maker yet. An admin of your organization can approve options{access === "admin" && !me.operator ? ", or name a decision maker under People" : ""}.</p>}
        {p.people.length === 0 ? <p className="muted small">No one on this project yet.</p> : (
          <div className="rows">
            {p.people.map((x) => (
              <div className="row" key={x.userId} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                <Avatar id={x.userId} name={names.get(x.userId) ?? "?"} />
                <span>{names.get(x.userId) ?? (members.data ? "Former member" : "Name not loaded")}</span>
                <span className="s">{ROLE_SHORT[x.role]}</span>
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
      {/* Post an update: one line on how it's going, and the health that goes with it */}
      <Dialog open={posting} onClose={() => setPosting(false)} label="Post an update">
        <h2>How is it going?</h2>
        <form className="form" onSubmit={(e) => { e.preventDefault(); if (post.title.trim()) void postUpdate(); }}>
          <div><label htmlFor="up-h">Health</label>
            <select id="up-h" value={post.health} onChange={(e) => setPost({ ...post, health: e.target.value })}>
              <option value="on_track">On track</option><option value="at_risk">At risk</option><option value="off_track">Off track</option><option value="not_started">Not started</option>
            </select>
          </div>
          <div><label htmlFor="up-t">In a sentence</label><textarea id="up-t" rows={2} style={{ minHeight: 0 }} value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} maxLength={160} placeholder="i.e. migration finished; testing starts Monday" /></div>
          <div className="actions"><button className="btn btn-primary" disabled={!post.title.trim() || sending}>{sending ? "Posting…" : "Post"}</button><button type="button" className="btn btn-ghost" onClick={() => setPosting(false)}>Cancel</button></div>
        </form>
      </Dialog>
      {/* Who's on the project and in what role; the decision maker approves options */}
      <PeopleDialog open={peopleOpen} onClose={() => setPeopleOpen(false)} people={p.people} version={p.version} onSave={(list, version) => { setPeopleOpen(false); void save(version, { people: list }); }} />
      {/* Keep mine saves the same change over their version; Take theirs drops it */}
      <ConflictDialog
        open={Boolean(conflict)}
        who={names.get(conflict?.current.updatedBy ?? "") ?? "Someone"}
        fields={conflictFields}
        onKeepMine={() => conflict && void save(conflict.current.version, conflict.patch)}
        onTakeTheirs={() => { if (conflict && ("summary" in conflict.patch || "outcome" in conflict.patch)) setEditing(false); setConflict(undefined); refresh(); }}
        onClose={() => setConflict(undefined)}
      />
    </div>
  );
}


// Project roles, short, for the People list
const ROLE_SHORT: Record<Project["people"][number]["role"], string> = {
  decision_maker: "Decision maker",
  sponsor: "Sponsor",
  lead_engineer: "Lead engineer",
  tech_contact: "Tech contact",
  stakeholder: "Stakeholder",
  observer: "Observer",
};
// Project roles in plain words
const ROLE_NAMES: Record<Project["people"][number]["role"], string> = {
  decision_maker: "Decision maker (approves options)",
  sponsor: "Sponsor",
  lead_engineer: "Lead engineer",
  tech_contact: "Tech contact",
  stakeholder: "Stakeholder",
  observer: "Observer",
};


/** Add, remove, and set roles for the people on a project. Like the item panel, it works against the
 * version it opened with: a clean list follows newer versions, an edited one stays and says so */
function PeopleDialog({ open, onClose, people, version, onSave }: { open: boolean; onClose: () => void; people: Project["people"]; version: number; onSave: (people: Project["people"], version: number) => void }) {
  const { org, access } = useOrg();
  const me = useSession();
  // Owner policy: only a client admin names or changes the decision maker (the API also asks them to
  // confirm it's them); everyone else edits the other roles around it
  const mayName = access === "admin" && !me.operator;
  const members = useMembers(org.id);
  const [base, setBase] = useState({ people, version });
  const [draft, setDraft] = useState(people);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.people);
  // Opening starts from the newest list; only the open/close change resets the draft
  useEffect(() => {
    if (!open) return;
    setBase({ people, version });
    setDraft(people);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // A newer project while open: an untouched list follows it, an edited one is kept
  useEffect(() => {
    if (open && !dirty && version !== base.version) {
      setBase({ people, version });
      setDraft(people);
    }
  }, [open, dirty, people, version, base.version]);
  const active = members.data?.filter((m) => m.status !== "deactivated") ?? [];
  const name = (uid: string) => active.find((m) => m.userId === uid)?.name || active.find((m) => m.userId === uid)?.email || "Former member";
  const addable = active.filter((m) => !draft.some((d) => d.userId === m.userId));
  return (
    <Dialog open={open} onClose={onClose} label="People on this project">
      <h2>People on this project</h2>
      {dirty && version > base.version && <p className="notice newer" role="status">Someone changed this project while you were editing. Your list is kept; Save asks which to keep.</p>}
      {!mayName && <p className="small muted">Only an admin of this organization can name or change the decision maker.</p>}
      <div className="people-edit">
        {draft.map((d, i) => {
          // Without the right to name, a decision maker's row stays as it is, and nobody else can become one
          const locked = !mayName && d.role === "decision_maker";
          return (
            <div key={d.userId} className="pe-row">
              <span>{name(d.userId)}</span>
              <select aria-label={`Role for ${name(d.userId)}`} value={d.role} disabled={locked} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, role: e.target.value as typeof d.role } : x)))}>
                {ProjectRole.options.map((r) => <option key={r} value={r} disabled={!mayName && r === "decision_maker" && d.role !== r}>{ROLE_NAMES[r]}</option>)}
              </select>
              <button className="btn btn-ghost btn-sm" disabled={locked} onClick={() => setDraft(draft.filter((_, j) => j !== i))} aria-label={`Remove ${name(d.userId)}`}>Remove</button>
            </div>
          );
        })}
        {addable.length > 0 && (
          <select aria-label="Add a person" value="" onChange={(e) => e.target.value && setDraft([...draft, { userId: e.target.value, role: mayName && !draft.some((x) => x.role === "decision_maker") ? "decision_maker" : "stakeholder" }])}>
            <option value="">+ Add someone…</option>
            {addable.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}
          </select>
        )}
      </div>
      <div className="actions">
        <button className="btn btn-primary" onClick={() => onSave(draft, base.version)}>Save</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
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
      <div className="range">{latest ? `Latest, ${dateLabel(latest.at)}` : "Where it starts; no readings yet"}</div>
      <div className="range">
        {latest && <>From {m.baseline ?? "?"} · </>}Target {m.target ?? "?"} {m.unit} · {betterWhen(m) === "down" ? "lower is better" : "higher is better"}
      </div>
      {/* The trend once there's something to trend; a lone starting dot says nothing */}
      {latest && <Trend baseline={m.baseline} target={m.target} readings={m.readings} unit={m.unit} />}
      {pct !== undefined && <div className="progress" role="img" aria-label={`${Math.round(pct * 100)} percent of the way`}><i style={{ width: `${pct * 100}%` }} /></div>}
      {/* Editors log a reading dated today */}
      {onReading && (
        <form style={{ display: "flex", gap: 6, marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); const n = Number(value); if (value.trim() && !Number.isNaN(n)) { onReading(n); setValue(""); } }}>
          <input aria-label={`New reading for ${item.title}`} inputMode="decimal" placeholder={`Today's reading${m.unit ? `, in ${m.unit}` : ""}`} value={value} onChange={(e) => setValue(e.target.value)} style={{ minHeight: 32, padding: "4px 10px" }} />
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
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // Every item call goes through this project's API path
  const path = `/t/${org.id}/projects/${project.id}`;
  const decisions = items.filter((i) => i.kind === "decision");
  // A link to one item (#item-…) or a group (#options) scrolls to it and flashes it once
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    const t = setTimeout(() => el.classList.remove("flash"), 2200);
    return () => clearTimeout(t);
  }, [hash, items.length]);

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
        <DecisionCard key={d.id} d={d} superseded={decisions.some((x) => (x.fields.supersedes as string[] | undefined)?.includes(d.id))} />
      ))}
      {KINDS_IN(layer).map((kind) => {
        const list = items.filter((i) => i.kind === kind);
        // Viewers see only groups with content, plus Requests, which they may add to
        if (!list.length && !canWrite && kind !== "request") return null;
        return (
          <section className="kind-group" key={kind} id={kind === "option" ? "options" : kind === "file_request" ? "files" : undefined}>
            <h2 className="section-h">{KIND_LABEL[kind][1]} <small>{list.length}</small></h2>
            {/* Options compare side by side, measures show as cards, everything else as rows */}
            {kind === "option" ? (
              <Options items={list} path={path} project={project} />
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
                  extra={kind === "file_request" ? <FileAsk item={i} docs={docs.filter((d) => d.itemId === i.id)} />
                    : kind === "discovery" && !i.body.trim() && canWrite ? <Answer question={i.title} onSave={(text) => void patch(i, { body: text, status: "done" })} />
                    : undefined} />
              ))}</div>
            )}
            {/* Anyone may add a request; options come from neon1; everything else from editors */}
            {(kind === "request" || (canWrite && (kind !== "option" || me.operator))) && <AddItem kind={kind} path={path} taken={list.map((i) => i.title)} />}
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
  // Ready files count as sent; ones still in their malware check say so
  const sent = docs.filter((d) => d.uploaded);
  const checking = docs.filter((d) => d.state === "checking");
  return (
    <div className="file-ask">
      {sent.map((d) => <span key={d.id} className="tag client">{d.name}</span>)}
      {checking.map((d) => <span key={d.id} className="tag">{d.name} · checking</span>)}
      <UploadButton target={{ layer: "needs", projectId: item.projectId, itemId: item.id }} label={sent.length ? "Send another" : "Upload"} className="chip" />
    </div>
  );
}


/** One item in a list: check it off, or tap it to open its panel with details and comments */
function ItemRow({ item, path, marker, onToggle, extra }: { item: Item; path: string; marker?: EditMarker; onToggle?: () => void; extra?: ReactNode }) {
  const { org } = useOrg();
  const me = useSession();
  const members = useMembers(org.id);
  const [open, setOpen] = useState(false);
  // Someone else's live marker on this item, if any
  const otherEditing = marker && marker.userId !== me.user.id ? marker : undefined;
  const owner = members.data?.find((m) => m.userId === item.assigneeId);
  const label = KIND_LABEL[item.kind][0];
  return (
    <div className="item" id={`item-${item.id}`}>
      {/* A checkbox for checkable kinds, an empty cell otherwise */}
      {onToggle ? <input type="checkbox" checked={item.status === "done"} onChange={onToggle} aria-label={`Done: ${item.title}`} /> : <span style={{ width: 18 }} />}
      <div>
        <button type="button" className={`item-open title${item.status === "done" ? " is-done" : ""}`} onClick={() => setOpen(true)}>{item.title}</button>
        {item.body && <div className="body clamp">{item.body}</div>}
        {otherEditing && <div className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}><Avatar id={otherEditing.userId} name={otherEditing.name} editing size={18} /> {otherEditing.name} is editing</div>}
        {extra}
      </div>
      {/* Owner, due date, and status at a glance */}
      <span className="item-meta">
        {/* Due date, in red once it has passed and the item isn't done */}
        {item.dueDate && (() => {
          const late = item.status !== "done" && item.dueDate < new Date().toISOString().slice(0, 10);
          return <span className={`small ${late ? "late" : "muted"}`} title={late ? "Overdue" : "Due"}>{late && <span className="sr">Overdue, </span>}{dateLabel(item.dueDate)}</span>;
        })()}
        {/* A status update says how things stood and when */}
        {item.kind === "update" && <><Health value={String(item.fields.health ?? "on_track") as Project["health"]} /><span className="small muted">{dateLabel(item.createdAt)}</span></>}
        {item.kind === "requirement" && <span className={`tag prio-${String(item.fields.priority ?? "should")}`}>{PRIORITY_WORDS[String(item.fields.priority ?? "should")]}</span>}
        {item.status !== "open" && item.status !== "done" && <span className="tag">{STATUS_WORDS[item.status] ?? item.status}</span>}
        {owner && <Avatar id={owner.userId} name={owner.name || owner.email} size={22} />}
      </span>
      <ItemPanel item={item} label={label} path={path} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}


/** The inline form that adds an item of one kind. Each kind says what belongs in it, with an example
 * and one-tap starters; requests are a sentence of taps; requirements pick must, should, or could */
function AddItem({ kind, path, taken }: { kind: ItemKind; path: string; taken: string[] }) {
  const { org } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // Closed to a link until someone adds; extra holds the measure, option, and requirement fields
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [extra, setExtra] = useState({ unit: "", baseline: "", target: "", cost: "" });
  const [priority, setPriority] = useState<"must" | "should" | "could" | "">("should");
  const guide = GUIDE[kind];
  const label = KIND_LABEL[kind][0];
  // One add at a time: a double click or a second Enter can't create the item twice
  const [adding, runAdd] = useSubmit();

  // Each need in a request becomes its own item, sent in order, then the form closes
  const sendAll = (drafts: { title: string; body: string; dueDate?: string; fields: Record<string, unknown> }[]) => runAdd(async () => {
    try {
      for (const d of drafts) await api(`${path}/items`, { method: "POST", body: { kind, ...d } });
      setOpen(false);
      if (drafts.length > 1) toast(`${drafts.length} requests sent`);
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  });
  // Send one item, then close the form
  const send = (item: { title: string; body: string; fields: Record<string, unknown> }) => runAdd(async () => {
    try {
      await api(`${path}/items`, { method: "POST", body: { kind, ...item } });
      setTitle("");
      setBody("");
      setOpen(false);
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  });

  // On an empty group, starters show even while closed, so the common answers are one tap away
  if (!open) {
    return (
      <div className="add-row">
        <button className="linkish small" onClick={() => setOpen(true)}>+ Add {label.toLowerCase()}</button>
        {guide && kind !== "request" && !taken.length && <Starters kind={kind} taken={taken} onPick={(s) => { setTitle(s); setOpen(true); }} />}
      </div>
    );
  }
  // Requests are built as one guided sentence
  if (kind === "request") return <RequestBuilder busy={adding} onSubmit={(ds) => void sendAll(ds)} onCancel={() => setOpen(false)} />;

  // Blank or non-numeric values are left unset
  const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));
  // Measures, options, and requirements carry extra fields; every kind gets a title and details
  const submit = () => {
    const fields: Record<string, unknown> = {};
    if (kind === "metric") Object.assign(fields, { unit: extra.unit, baseline: num(extra.baseline), target: num(extra.target) });
    if (kind === "option") Object.assign(fields, { cost: extra.cost });
    if (kind === "requirement") Object.assign(fields, { priority: priority || "should" });
    void send({ title: title.trim(), body, fields });
  };
  return (
    <form className="card add-form" onSubmit={(e) => { e.preventDefault(); if (title.trim()) submit(); }}>
      {guide && <p className="small muted hint">{guide.hint}</p>}
      <input aria-label={`${label} title`} placeholder={guide ? `i.e. ${guide.title}` : label} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required autoFocus />
      {guide && !title && <Starters kind={kind} taken={taken} onPick={setTitle} />}
      {/* Requirements: how much it matters, as three chips */}
      {kind === "requirement" && (
        <div className="line"><span className="small muted">This is a</span><Pick label="Priority" options={PRIORITY} value={priority} onChange={setPriority} /></div>
      )}
      {(!guide || guide.body) && <textarea aria-label="Details" placeholder={guide?.body ? `${guide.body} (optional)` : "Details (optional)"} value={body} onChange={(e) => setBody(e.target.value)} rows={2} />}
      {/* Measures need a unit, a baseline, and a target; options need a cost */}
      {kind === "metric" && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <input aria-label="Unit" placeholder="Unit, i.e. hours" value={extra.unit} onChange={(e) => setExtra({ ...extra, unit: e.target.value })} />
          <input aria-label="Now" placeholder="Now" inputMode="decimal" value={extra.baseline} onChange={(e) => setExtra({ ...extra, baseline: e.target.value })} />
          <input aria-label="Target" placeholder="Target" inputMode="decimal" value={extra.target} onChange={(e) => setExtra({ ...extra, target: e.target.value })} />
        </div>
      )}
      {kind === "option" && <input aria-label="Cost" placeholder="Cost, i.e. $4,800 fixed" value={extra.cost} onChange={(e) => setExtra({ ...extra, cost: e.target.value })} />}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={!title.trim() || adding}>{adding ? "Adding…" : "Add"}</button>
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}


// Requirement priority, in MoSCoW order, and the short word each row shows
const PRIORITY = [["must", "must have"], ["should", "should have"], ["could", "nice to have"]] as const;
const PRIORITY_WORDS: Record<string, string> = { must: "must", should: "should", could: "nice" };


/** An unanswered discovery question answers in place: one short box, saved as the answer */
function Answer({ question, onSave }: { question: string; onSave: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form className="answer" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSave(text.trim()); }}>
      <textarea aria-label={`Answer: ${question}`} placeholder="Answer in your own words. A real example helps most." value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} />
      {text.trim() && <button className="btn btn-primary btn-sm" type="submit">Save answer</button>}
    </form>
  );
}


/** A 1 to 5 bar; cost and effort are inverted so more bars always means better */
// Scores are 1 to 5 where 5 is always the better end; each shows as a plain word
const SCORE_WORDS = {
  Cost: ["Highest", "High", "Medium", "Low", "Lowest"],
  Quality: ["Basic", "Fair", "Good", "Very good", "Best"],
  Effort: ["Heaviest", "Heavy", "Medium", "Light", "Lightest"],
} as const;


/** One score as a word, with five dots where filled dots mean better */
function Meter({ label, value }: { label: keyof typeof SCORE_WORDS; value: number }) {
  const word = SCORE_WORDS[label][Math.min(5, Math.max(1, value)) - 1];
  return (
    <div className="meter">
      <span>{label}</span>
      <b className={value >= 4 ? "good" : value <= 2 ? "weak" : ""}>{word}</b>
      <span className="bar" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= value ? "on" : ""} />)}</span>
    </div>
  );
}


/**
 * One decision as it was agreed: the terms copied at approval, who approved and when. Older decisions
 * made before terms were copied say so plainly rather than showing today's option as the agreement
 */
function DecisionCard({ d, names, superseded }: { d: Item; names?: Map<string, string>; superseded?: boolean }) {
  const f = d.fields as { approvedBy?: string; approvedAt?: string; optionVersion?: number; approverName?: string; terms?: { title: string; body?: string; cost?: string; timeline?: string } };
  const by = f.approverName || names?.get(String(f.approvedBy)) || "a member";
  return (
    <div className={`decision${superseded ? " superseded" : ""}`}>
      <b>{d.title}</b>
      {superseded && <span className="tag" style={{ marginLeft: 8 }}>replaced by a later decision</span>}
      <div className="small muted">by {by} · {ago(String(f.approvedAt))} · option version {String(f.optionVersion)}</div>
      {f.terms ? (
        <div className="small" style={{ margin: "6px 0 0" }}>
          {(f.terms.cost || f.terms.timeline) && <div className="mono">Agreed: {[f.terms.cost, f.terms.timeline].filter(Boolean).join(" · ")}</div>}
          {f.terms.body && <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{f.terms.body}</p>}
        </div>
      ) : (
        <p className="small muted" style={{ margin: "6px 0 0" }}>This decision was recorded before 1NEON kept a copy of the approved terms, so only the option and version are on record.</p>
      )}
      {d.body && <p className="small" style={{ margin: "6px 0 0" }}>Conditions: {d.body}</p>}
    </div>
  );
}


/** Options side by side: draft, shared for approval, approved; approving records a decision */
function Options({ items, path, project }: { items: Item[]; path: string; project: Project }) {
  const { org, access, canWrite } = useOrg();
  const me = useSession();
  const members = useMembers(org.id);
  const names = new Map(members.data?.map((m) => [m.userId, m.name || m.email]) ?? []);
  // Only the named decision maker (or, with none named, a client admin) sees Approve
  const decider = canApprove({ userId: me.user.id, operator: me.operator, strongSession: false }, access, project.people).ok;
  const deciders = project.people.filter((x) => x.role === "decision_maker").map((x) => names.get(x.userId) ?? "the decision maker");
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // The option waiting on approval, and the conditions being typed
  const [approving, setApproving] = useState<Item>();
  const [conditions, setConditions] = useState("");
  if (!items.length) return null;
  // After a decision, the other options can still be chosen instead, but quietly
  const decided = items.some((o) => o.status === "approved");
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
              <Meter label="Cost" value={f.costScore} />
              <Meter label="Quality" value={f.qualityScore} />
              <Meter label="Effort" value={f.effortScore} />
              {/* The decision maker approves a proposed option; editors move drafts along */}
              <div className="option-acts">
                {o.status === "proposed" && decider && <button className={`btn ${decided ? "btn-ghost" : "btn-primary"}`} onClick={() => { setConditions(""); setApproving(o); }}>{decided ? "Choose this instead" : "Approve this option"}</button>}
                {o.status === "proposed" && !decider && !decided && <span className="small muted">Waiting on {deciders.length ? deciders.join(" or ") : "a client admin"}</span>}
                {/* Sharing an option and taking it back are neon1's to do; the client approves */}
                {canWrite && me.operator && o.status === "draft" && <button className="btn btn-ghost" onClick={() => void setStatus(o, "proposed")}>Share with client</button>}
                {canWrite && me.operator && o.status === "proposed" && <button className="btn btn-ghost" onClick={() => void setStatus(o, "draft")}>Back to draft</button>}
              </div>
            </article>
          );
        })}
      </div>
      {/* Approval confirmation with optional conditions */}
      <Dialog open={Boolean(approving)} onClose={() => setApproving(undefined)} label="Approve option">
        <h2>Approve "{approving?.title}"?</h2>
        <p className="muted small">This records a decision with a copy of this exact version's terms (title, description, cost, and timeline). Neither the decision nor the approved option can be edited afterwards; a change needs a new option and a new approval.</p>
        <label htmlFor="cond">Conditions (optional)</label>
        <textarea id="cond" value={conditions} onChange={(e) => setConditions(e.target.value)} maxLength={2000} placeholder="i.e. only if the work happens after 6pm" />
        <div className="actions">
          <button className="btn btn-primary" onClick={() => void approve()}>Approve</button>
          <button className="btn btn-ghost" onClick={() => setApproving(undefined)}>Cancel</button>
        </div>
      </Dialog>
    </>
  );
}
