// apps/web/src/pages/Project.tsx - One project: an overview, then a tab per layer (Needs,
// Execute, Observe, Normalize).


import { balanceOf, dollars as wholeDollars, failedOn, invoiceState, InvoiceFields, money as dollars, payableOn, paymentPlan, priceMeaning, priceOf, betterWhen, canApprove, changedSince, currentDecision, todayIn, isClosed, isOwnOrg, KIND_LAYER, metricProgress, MetricFields, OptionFields, priceCheckDue, ProjectRole, proposalRef, PurchaseFields, HandoffFields, revisions, type DocumentRecord, type Item, type ItemKind, type Layer, type Project, type Stage } from "@1neon/domain";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileList, UploadButton } from "../components/Files.tsx";
import { GUIDE, Pick, RequestBuilder, Starters } from "../components/Guide.tsx";
import { ItemPanel, STATUS_WORDS, statusWord, useDeleteItem, useMayDelete } from "../components/ItemPanel.tsx";
import { downloadDocx, FICTIONAL } from "../lib/docx.ts";
import { gate, Stale } from "../components/Reads.tsx";
import { Link, NavLink, useLocation, useParams } from "react-router";
import { useOrg, useSession, useTopBar } from "../components/Shell.tsx";
import { Avatar, ConflictDialog, Dialog, Empty, Health, HEALTH_LABEL, LayerBadge, LAYERS, layerHint, layerName, layerProgress, OnionProgress, Trend, ago, dateLabel, daysSince, layerFromSlug, layerSlug, useToast } from "../components/ui.tsx";
import { api, DEMO, HttpError } from "../lib/api.ts";
import { AgreementNeeded, Hours, Invoices, PriceBasis, SignBox, signReady, useAgreementSigned, type Priced, type SignValue } from "../components/Billing.tsx";
import { firstYear, money, parseCost, type Recurring } from "../lib/cost.ts";
import { handoverSummary } from "../lib/handover.ts";
import { numberProblem, optionalNumber } from "../lib/measures.ts";
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
  constraint: ["Constraint or assumption", "Constraints and assumptions"],
  proposal: ["Proposal revision", "Proposal"],
  task: ["Task", "Tasks"],
  milestone: ["Milestone", "Milestones"],
  change: ["Change", "Changes"],
  update: ["Update", "Status updates"],
  purchase: ["Purchase", "Purchases"],
  invoice: ["Invoice", "Invoices"],
  payment: ["Payment", "Payments"],
  time: ["Hours entry", "Hours"],
  signoff: ["Outside approval", "Outside approvals"],
  metric: ["Measure", "Measures"],
  check: ["Check", "Checks"],
  incident: ["Incident", "Incidents"],
  handoff: ["Handover step", "Handover checklist"],
  runbook: ["Runbook", "Runbooks"],
  training: ["Training", "Training"],
  care: ["Care item", "Care plan"],
  retro: ["Retro note", "Retrospective"],
};
// Kinds shown under a layer tab. Decisions appear as banners, revisions in the proposal strip, and
// invoices, payments, and hours in their own sections under Execute, never as editable rows
const KINDS_IN = (layer: Layer) => (Object.keys(KIND_LAYER) as ItemKind[]).filter((k) => KIND_LAYER[k] === layer && !["decision", "proposal", "invoice", "payment", "time"].includes(k));
// Every work item is done or not done, with a checkbox, so each counted need can be finished. Options
// finish by approval, measures by reaching their target, and decisions and updates are records
const CHECKABLE = new Set<ItemKind>((Object.keys(KIND_LAYER) as ItemKind[]).filter((k) => !["option", "metric", "decision", "update", "purchase", "proposal", "constraint", "invoice", "payment", "time"].includes(k)));


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
          <NavLink key={l} to={`${base}/${layerSlug(l)}`} viewTransition onClick={() => aimBetween(at, i + 1)}><LayerBadge layer={l} /><span className="tab-name">{layerName(l)}<small className="sub"><span className="sr">, </span>{layerHint(l)}</small></span> {prog[l][1] > 0 && <span className="muted" aria-label={`${prog[l][0]} of ${prog[l][1]} done`} title={`${prog[l][0]} of ${prog[l][1]} done`}>{prog[l][0]}/{prog[l][1]}</span>}</NavLink>
        ))}
      </nav>
      {/* The section under the tabs pans by tab order */}
      <div className="slide-stage">
      {tab === "overview" ? <Overview project={p} items={items} /> : layerFromSlug(tab) ? <LayerTab layer={layerFromSlug(tab)!} project={p} items={items} docs={detail.data.docs} edits={detail.data.edits} /> : <Empty text="That section doesn't exist." />}
      </div>
    </>
  );
}


/**
 * The one thing to do next on this project, and who it's waiting on. It follows the work as it happens:
 * an approval, a file sent, or a checked-off item changes it at once (the page refreshes after each
 * action). When nothing is waiting on a person, it names the stage's goal and, for editors, offers the
 * move to the next stage. Stages are found by their IDs and order in Settings, so renaming, reordering,
 * or hiding stages keeps it right: Decide and Closed keep their roles under any name or place
 */
function NextStep({ project: p, items, stage, base }: { project: Project; items: Item[]; stage?: Stage; base: string }) {
  const { org, access, canWrite } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const members = useMembers(org.id);
  const names = new Map(members.data?.map((m) => [m.userId, m.name || m.email]) ?? []);
  const actor = { userId: me.user.id, operator: me.operator, strongSession: false };
  const at = org.stages.findIndex((s) => s.id === p.stageId);
  const closed = isClosed(org.stages, p.stageId);
  // Where a move goes: the next shown stage, or for a closed project the shown stage before it
  const ahead = org.stages.slice(at + 1).find((s) => !s.hidden);
  const back = org.stages.slice(0, at).filter((s) => !s.hidden).at(-1);
  const decideAt = org.stages.findIndex((s) => s.id === "decide");
  const moveTo = async (to: Stage, word: string) => {
    try {
      await api(`/t/${org.id}/projects/${p.id}/move`, { method: "POST", body: { version: p.version, stageId: to.id } });
      toast(`${p.key} ${word} ${to.name}`);
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };
  // Closed ends a project; Reopen puts it back a stage, from where it moves anywhere like any project
  // A closed project leads with the short version of its handover, the line a client forwards on
  if (closed) {
    const h = handoverSummary(items, names);
    const [doneSteps, allSteps] = h.handoff;
    return (
      <div className="next-step handover" data-tour="next-step" role="status">
        <span className="eyebrow">{h.empty ? "Closed" : "Handed over"}</span>
        {!h.empty && (
          <dl className="handover-list">
            {(h.agreed || h.changes.length > 0) && <><dt>What changed</dt><dd>{h.agreed && <b>{h.agreed}</b>}{h.agreed && h.changes.length > 0 && ". "}{h.changes.join(", ")}{h.changes.length > 0 && "."}</dd></>}
            {h.results.length > 0 && <><dt>The result</dt><dd>{h.results.map((r, n) => <span key={r.title}>{n > 0 && "; "}{r.title}: {r.before && r.now ? <>{r.before} to <b>{r.now}</b></> : <b>{r.now ?? r.before}</b>}{r.target && ` (target ${r.target}${r.reached ? ", reached" : ""})`}</span>)}.</dd></>}
            {h.owners.length > 0 && <><dt>Who owns what</dt><dd>{h.owners.map((o, n) => <span key={o.title}>{n > 0 && "; "}{o.title}: {o.owner ?? "no owner named yet"}</span>)}.</dd></>}
            {allSteps > 0 && <><dt>Handover checklist</dt><dd>{doneSteps} of {allSteps} done.</dd></>}
          </dl>
        )}
        <p>{h.empty ? "This project is closed. " : ""}{canWrite ? `Reopen it to pick the work back up in ${back?.name ?? "an earlier stage"}.` : h.empty ? "Nothing more is planned." : "The full handover is under Normalize."}</p>
        {canWrite && back && <button className="btn btn-primary btn-sm" onClick={() => void moveTo(back, "reopened in")}>Reopen</button>}
      </div>
    );
  }
  // Once an option is approved, the others stop asking for a decision. The one named is the current
  // agreement (the decision nothing later replaced), never simply the first approved option (AUTH-P06)
  const approved = currentDecision(items).option;
  const options = items.filter((i) => i.kind === "option");
  const proposed = approved ? [] : options.filter((i) => i.status === "proposed");
  const files = items.filter((i) => i.kind === "file_request" && i.status !== "done");
  const mine = items.filter((i) => i.assigneeId === me.user.id && i.status !== "done");
  const handover = items.filter((i) => i.kind === "handoff");
  const unsigned = handover.filter((i) => !i.fields.accepted);
  const deciders = p.people.filter((x) => x.role === "decision_maker").map((x) => names.get(x.userId) ?? "the decision maker");
  // Moving on past Decide needs an approved option (or a reason, given on the board)
  // neon1 runs the stages of a client's project: Next step offers the move to neon1 (and to anyone in
  // neon1's own organization), and tells a client who has the work
  const drives = canWrite && (me.operator || isOwnOrg(org.slug));
  const gated = Boolean(ahead) && decideAt >= 0 && at <= decideAt && org.stages.indexOf(ahead!) > decideAt && !approved;
  const nextName = ahead?.name;
  // The most pressing step first: a decision, then files, then the caller's own work, then the stage
  let text: ReactNode;
  let action: { to: string; label: string } | undefined;
  let move: Stage | undefined;
  // The issued revision: options are approved from it, unchanged and within its price check
  const cur = revisions(items).at(-1);
  const fresh = cur && !priceCheckDue(cur.p, todayIn(org.timeZone));
  const ready = proposed.filter((o) => cur?.p.snapshot.options.some((x) => x.id === o.id && x.version === o.version));
  const unissued = !approved && proposed.length > 0 && (!cur || changedSince(cur.p, items).any);
  // Money first once anything is billed: the client's open invoices, neon1's drafts to check and issue
  const today = todayIn(org.timeZone);
  // (an invoice a bank payment already covers asks for nothing while the transfer clears)
  const owed = items.filter((i) => i.kind === "invoice" && payableOn(i, items) > 0);
  const drafts = items.filter((i) => i.kind === "invoice" && i.status === "draft");
  const overdue = owed.filter((i) => invoiceState(i, items, today) === "overdue");
  if (!me.operator && owed.length) {
    const refused = owed.find((i) => failedOn(i, items));
    const first = refused ?? overdue[0] ?? owed[0]!;
    const f = InvoiceFields.parse(first.fields);
    text = <>{refused ? <>The bank payment on invoice {f.number} <b>didn't go through</b>, so it's still owed: </> : overdue.length ? <>Invoice {f.number} is <b>overdue</b>: </> : <>Invoice {f.number} is ready: </>}{dollars(payableOn(first, items))}, due {dateLabel(f.dueDate)}.{owed.length > 1 ? ` ${owed.length - 1} more ${owed.length === 2 ? "is" : "are"} open.` : ""}</>;
    action = { to: `${base}/execute#billing`, label: "See and pay" };
  } else if (me.operator && drafts.length) {
    text = <>{drafts.length === 1 ? `A ${String(drafts[0]!.fields.type)} invoice is` : `${drafts.length} invoices are`} drafted. Check {drafts.length === 1 ? "it" : "them"}, then issue.</>;
    action = { to: `${base}/execute#billing`, label: "Check invoices" };
  } else if (unissued && me.operator && canWrite) {
    text = <>Issue the proposal{cur ? `'s next revision, r${cur.p.rev + 1},` : ""} so the client can approve an option.</>;
    action = { to: `${base}/needs#options`, label: cur ? `Issue r${cur.p.rev + 1}` : "Issue the proposal" };
  } else if (proposed.length && canApprove(actor, access, p.people, isOwnOrg(org.slug)).ok) {
    if (ready.length && fresh) text = <>Choose an option: {ready.length} {ready.length === 1 ? "is" : "are"} ready for your approval in Proposal {proposalRef(cur!.p.number, cur!.p.rev)}.</>;
    else if (cur && !fresh) text = <>The prices in Proposal {proposalRef(cur.p.number, cur.p.rev)} are due a price check. Ask neon1 to refresh them, then choose.</>;
    else text = <>neon1 is preparing the proposal. You can read the options now and approve one once it's issued.</>;
    action = { to: `${base}/needs#options`, label: "Compare options" };
  } else if (proposed.length) {
    text = <>Waiting on {deciders.length ? deciders.join(" or ") : "an admin of the client"} to choose an option.</>;
    action = { to: `${base}/needs#options`, label: "See options" };
  } else if (files.length && !me.operator) {
    text = <>Send {files.length} {files.length === 1 ? "file" : "files"} so the work can go on.</>;
    action = { to: `${base}/needs#files`, label: "Upload" };
  } else if (handover.length && unsigned.length && handover.every((i) => i.status === "done") && !me.operator && canApprove(actor, access, p.people, isOwnOrg(org.slug)).ok) {
    // Every handover step is done: the decision maker's one signature accepts them
    text = <>Every handover step is done. Check them, then accept the handover with one signature.</>;
    action = { to: `${base}/normalize`, label: "Review and accept" };
  } else if (mine.length) {
    text = <>You have {mine.length} open {mine.length === 1 ? "item" : "items"} here.</>;
    action = { to: `${base}/${layerSlug(KIND_LAYER[mine[0]!.kind])}#item-${mine[0]!.id}`, label: "Open" };
  } else if (approved && decideAt >= 0 && at <= decideAt && ahead) {
    // The decision is made, so Decide is done: the step is moving on
    text = <><b>{approved.title}</b> is approved. {drives ? <>Next, move the project to <b>{nextName}</b>.</> : <>Next, neon1 moves the project to <b>{nextName}</b>.</>}</>;
    if (drives) move = ahead;
  } else if (me.operator && canWrite && !options.length && at >= 0 && decideAt >= 0 && at <= decideAt && at >= decideAt - 1) {
    text = <>Add options for the client to compare and approve.</>;
    action = { to: `${base}/needs#options`, label: "Add options" };
  } else if (me.operator && canWrite && !approved && options.length && !proposed.length && at <= decideAt) {
    text = <>Share an option with the client so they can approve it.</>;
    action = { to: `${base}/needs#options`, label: "Open options" };
  } else if (stage?.exit && !drives && !me.operator) {
    // A client reads where the work stands and who has it; nothing here is theirs to do
    text = <><b>{stage.name}</b> is with neon1. It's done when: {stage.exit.charAt(0).toLowerCase() + stage.exit.slice(1).replace(/\.$/, "")}.{ahead && !gated ? <> Then neon1 moves the project to <b>{nextName}</b>.</> : ""} Nothing needs you right now.</>;
  } else if (stage?.exit) {
    text = <>To finish <b>{stage.name}</b>: {stage.exit.charAt(0).toLowerCase() + stage.exit.slice(1).replace(/\.$/, "")}.{drives && ahead && !gated ? <> When it is, move it to <b>{nextName}</b>.</> : ""}</>;
    if (drives && !gated) move = ahead;
  } else if (ahead && drives && !gated) {
    text = <>When <b>{stage?.name ?? "this stage"}</b> is done, move the project to <b>{nextName}</b>.</>;
    move = ahead;
  } else {
    text = <>Nothing needs doing right now.</>;
  }
  return (
    <div className="next-step" data-tour="next-step" role="status">
      <span className="eyebrow">Next step</span>
      <p>{text}</p>
      {action && <Link className="btn btn-primary btn-sm" to={action.to}>{action.label} <ArrowRight size={14} aria-hidden="true" /></Link>}
      {move && <button className={`btn ${action ? "btn-ghost" : "btn-primary"} btn-sm`} onClick={() => void moveTo(move, "moved to")}>Move to {move.name} <ArrowRight size={14} aria-hidden="true" /></button>}
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
  // Inline edit of the basics, with the same questions the new-project form asked. `editBase` is the
  // version the edit started from, so a save after someone else's change conflicts instead of
  // silently writing over it
  const basics = () => ({ name: p.name, summary: p.summary, outcome: p.outcome, targetDate: p.targetDate ?? "" });
  const [editing, setEditing] = useState(false);
  const [editBase, setEditBase] = useState(p.version);
  const [draft, setDraft] = useState(basics);
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
      setPost({ title: "", health: post.health }); // reset again from the project when the next update opens
      toast("Update posted");
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  });
  // The current decision (the same one Next step names), measures, and status update feed the overview
  const decision = currentDecision(items).decision;
  const metrics = items.filter((i) => i.kind === "metric");
  const update = items.filter((i) => i.kind === "update").at(-1);
  const names = new Map(members.data?.map((m) => [m.userId, m.name || m.email]) ?? []);

  // Save project fields against `version`; a 409 opens the conflict dialog with the newer version
  const save = async (version: number, patch: Record<string, unknown>) => {
    try {
      await api(`/t/${org.id}/projects/${p.id}`, { method: "PATCH", body: { version, ...patch } });
      if ("summary" in patch || "outcome" in patch || "name" in patch) setEditing(false);
      setConflict(undefined);
      toast("Saved");
    } catch (e) {
      if (e instanceof HttpError && e.status === 409 && e.body.current) setConflict({ current: e.body.current as Project, patch });
      else toast(problem(e));
    }
    refresh();
  };
  // The summary edit started from an older version than the one now on screen
  const newerWhileEditing = editing && p.version > editBase && JSON.stringify(draft) !== JSON.stringify(basics());
  // What the basics still lack, for the reminder to finish them
  const missing = [!p.summary && "what it is", !p.outcome && "what done looks like", metrics.length === 0 && "a measure"].filter(Boolean) as string[];
  // The rows the conflict dialog compares: only the fields this save was changing
  const people = (list: Project["people"]) => list.map((x) => `${names.get(x.userId) ?? "Former member"} (${x.role.replace("_", " ")})`).join(", ");
  const conflictFields = conflict ? [
    ...("name" in conflict.patch ? [{ label: "Name", mine: String(conflict.patch.name), theirs: conflict.current.name }] : []),
    ...("summary" in conflict.patch ? [{ label: "Summary", mine: String(conflict.patch.summary), theirs: conflict.current.summary }] : []),
    ...("outcome" in conflict.patch ? [{ label: "Done when", mine: String(conflict.patch.outcome), theirs: conflict.current.outcome }] : []),
    ...("people" in conflict.patch ? [{ label: "People", mine: people(conflict.patch.people as Project["people"]), theirs: people(conflict.current.people) }] : []),
    ...("health" in conflict.patch ? [{ label: "Health", mine: String(conflict.patch.health).replace("_", " "), theirs: conflict.current.health.replace("_", " ") }] : []),
    ...("archived" in conflict.patch ? [{ label: "Archived", mine: conflict.patch.archived ? "yes" : "no", theirs: conflict.current.archived ? "yes" : "no" }] : []),
    // Calendar dates, shown as dates without a time-zone shift; blank on either side says so (EP-02)
    ...("targetDate" in conflict.patch ? [{ label: "Target date", mine: conflict.patch.targetDate ? dateLabel(String(conflict.patch.targetDate)) : "Not set", theirs: conflict.current.targetDate ? dateLabel(conflict.current.targetDate) : "Not set" }] : []),
  ] : [];
  // A field this list can't describe still gets a row, so Keep mine never sends a change nobody saw
  const described = new Set(["name", "summary", "outcome", "people", "health", "archived", "targetDate"]);
  for (const k of conflict ? Object.keys(conflict.patch).filter((k) => !described.has(k)) : []) conflictFields.push({ label: k, mine: String(conflict!.patch[k] ?? "Not set"), theirs: "see the latest version" });

  return (
    <div className="two">
      {/* Main column: the decision banner, summary and outcome, and measures */}
      <section>
        {decision && <DecisionCard d={decision} names={names} />}
        {/* Editors can change the summary and outcome in place */}
        {/* A project made with only its name gets a standing reminder to finish the basics */}
        {canWrite && !editing && missing.length > 0 && (
          <div className="notice small finish" role="status">
            <span>Still to describe: {missing.join(", ")}. It helps everyone see why this project exists and when it's done.</span>
            <button className="linkish small" onClick={() => { setDraft(basics()); setEditBase(p.version); setEditing(true); }}>Finish now</button>
          </div>
        )}
        {/* Editors change the basics in place, under the same questions the new-project form asked */}
        {editing ? (
          <form className="form" onSubmit={(e) => { e.preventDefault(); if (draft.name.trim()) void save(editBase, { name: draft.name.trim(), summary: draft.summary, outcome: draft.outcome, targetDate: draft.targetDate || null }); }}>
            {newerWhileEditing && <p className="notice newer" role="status">{names.get(p.updatedBy) ?? "Someone"} saved a newer version while you were editing. Your text is kept; Save asks which version to keep.</p>}
            <div><label htmlFor="pn">Name<sup className="req" aria-hidden="true">*</sup></label><input id="pn" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} required /></div>
            <div><label htmlFor="ps">In one or two sentences, what is this?</label><textarea id="ps" value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} maxLength={500} rows={2} /></div>
            <div><label htmlFor="po">What will be true when it's done?</label><textarea id="po" value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })} maxLength={500} rows={2} /></div>
            <div><label htmlFor="pd">Target date</label><input id="pd" type="date" value={draft.targetDate} onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })} style={{ maxWidth: 220 }} /></div>
            <p className="small muted" style={{ margin: 0 }}>The real example is under <Link to={`/o/${org.slug}/projects/${p.key}/${layerSlug("needs")}`}>Needs</Link>, and measures under <Link to={`/o/${org.slug}/projects/${p.key}/${layerSlug("observation")}`}>Observe</Link>, where they can be changed too. The key, {p.key}, stays the same.</p>
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn btn-primary" type="submit" disabled={!draft.name.trim()}>Save</button>
              <button className="btn btn-ghost" type="button" onClick={() => { setEditing(false); setDraft(basics()); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <p className="lead" style={{ marginTop: 0 }}>{p.summary || <span className="muted">No summary yet.</span>}</p>
            <p><b>Done when:</b> {p.outcome || <span className="muted">not written yet</span>}</p>
            {canWrite && <button className="btn btn-ghost" onClick={() => { setDraft(basics()); setEditBase(p.version); setEditing(true); }}>Edit</button>}
          </>
        )}
        <h2 className="section-h">Measures <small>baseline → target</small></h2>
        {metrics.length === 0 ? <Empty text="No measures yet. Add them under Observe." /> : <div className="scores">{metrics.map((m) => <MetricCard key={m.id} item={m} path={`/t/${org.id}/projects/${p.id}`} />)}</div>}
      </section>
      {/* Side column: health, dates, latest update, flags, people, and archiving */}
      <aside>
        <h2 className="section-h" style={{ marginTop: 0 }}>Status</h2>
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="small muted">Health</span>
            {canWrite ? (
              <select aria-label="Health" value={p.health} onChange={(e) => void save(p.version, { health: e.target.value })} style={{ maxWidth: 160 }}>
                <option value="on_track">On track</option><option value="at_risk">At risk</option><option value="off_track">Off track</option><option value="not_started">Not assessed</option>
              </select>
            ) : <Health value={p.health} />}
          </div>
          {/* Health is an assessment, not activity: say who set it and when, so a stale one shows */}
          <p className="small muted" style={{ margin: 0 }}>
            {p.assessedAt
              ? <>Assessed by {p.assessedBy ? names.get(p.assessedBy) ?? "a former member" : "someone"}, {ago(p.assessedAt)}</>
              : p.health === "not_started" ? "Nobody has assessed health yet." : "Assessed before assessments were recorded."}
          </p>
          {/* The target date: editors change it in place; clearing it leaves the project open-ended */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="small muted">Target date</span>
            {canWrite ? (
              <input type="date" aria-label="Target date" value={p.targetDate ?? ""} style={{ width: "auto", minHeight: 36, padding: "4px 10px" }}
                onChange={(e) => void save(p.version, { targetDate: e.target.value || null })} />
            ) : <span className="small">{p.targetDate ? dateLabel(p.targetDate) : "none set"}</span>}
          </div>
          {update && <div className="small"><span className="muted">Latest update ({ago(update.updatedAt)})</span><br />{update.title}</div>}
          {canWrite && <button className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} onClick={() => {
            // A new update starts from the project's health as it is now; an unsent draft keeps its own (EP-01)
            if (!post.title.trim()) setPost({ title: "", health: p.health });
            setPosting(true);
          }}>Post an update</button>}
          {p.flags.length > 0 && <div className="small"><span className="tag warn">sensitive data: {p.flags.join(", ")}</span></div>}
        </div>
        {/* Project roles, with a fallback for people who left the organization */}
        <h2 className="section-h">People {canWrite && <button className="link small" onClick={() => setPeopleOpen(true)}>Edit</button>}</h2>
        {!p.people.some((x) => x.role === "decision_maker") && <p className="notice small">No decision maker yet. An admin of your organization can approve options{(me.operator ? isOwnOrg(org.slug) : access === "admin") ? ", or name a decision maker under People" : ""}.</p>}
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
            <select id="up-h" value={post.health} onChange={(e) => setPost({ ...post, health: e.target.value })} aria-describedby={post.health !== p.health ? "up-h-now" : undefined}>
              <option value="on_track">On track</option><option value="at_risk">At risk</option><option value="off_track">Off track</option><option value="not_started">Not assessed</option>
            </select>
            {/* Posting sets the project's health, so a difference from the current one is said out loud */}
            {post.health !== p.health && <p id="up-h-now" className="small muted" style={{ margin: "4px 0 0" }}>The project is {HEALTH_LABEL[p.health as keyof typeof HEALTH_LABEL]?.toLowerCase() ?? p.health} now; posting changes it.</p>}
          </div>
          <div><label htmlFor="up-t">In a sentence</label><textarea id="up-t" rows={2} style={{ minHeight: 0 }} value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} maxLength={160} placeholder="e.g. migration finished; testing starts Monday" /></div>
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
  // confirm it's them); everyone else edits the other roles around it. In neon1's own organization
  // neon1 is the client, so its operators name the decision maker there too
  const mayName = me.operator ? isOwnOrg(org.slug) : access === "admin";
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
function MetricCard({ item, path, onReading }: { item: Item; path: string; onReading?: (value: number) => Promise<boolean> }) {
  // Fields are validated on read, so a malformed record can't break the page
  const m = MetricFields.parse(item.fields);
  const latest = m.readings.at(-1);
  const pct = metricProgress(m);
  // The reading being typed, and the edit panel (opened from the title, like every item)
  const [value, setValue] = useState("");
  const [readingError, setReadingError] = useState<string>();
  const [savingReading, setSavingReading] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div className="card metric" id={`item-${item.id}`}>
      <div className="card-head">
        <button type="button" className="item-open small" onClick={() => setOpen(true)}>{item.title}</button>
        <DeleteItem item={item} path={path} label="Measure" />
      </div>
      <ItemPanel item={item} label="Measure" path={path} open={open} onClose={() => setOpen(false)} />
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
        <form style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }} onSubmit={(e) => {
          e.preventDefault();
          // A reading that isn't a number says so and keeps the text, rather than doing nothing (EP-08)
          const bad = numberProblem(value, { required: true });
          setReadingError(bad);
          const n = optionalNumber(value);
          if (bad || !n.ok || n.value === undefined || savingReading) return;
          // The box clears only after the reading is saved, and only if it still holds what was sent
          const sent = value;
          setSavingReading(true);
          void onReading(n.value).then((saved) => { setSavingReading(false); if (saved) setValue((now) => (now === sent ? "" : now)); });
        }}>
          <input aria-label={`New reading for ${item.title}`} inputMode="decimal" placeholder={`Today's reading${m.unit ? `, in ${m.unit}` : ""}`} value={value} onChange={(e) => { setValue(e.target.value); setReadingError(undefined); }} style={{ minHeight: 32, padding: "4px 10px" }} aria-invalid={readingError ? true : undefined} aria-describedby={readingError ? `reading-err-${item.id}` : undefined} />
          <button className="btn btn-ghost" style={{ minHeight: 32, padding: "4px 12px" }} disabled={savingReading}>{savingReading ? "Adding…" : "Add"}</button>
          {readingError && <span id={`reading-err-${item.id}`} className="small late" role="alert" style={{ flexBasis: "100%" }}>{readingError}</span>}
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
  // True once saved; on a failure the caller keeps what the person typed (EP-03)
  const patch = async (item: Item, body: Record<string, unknown>): Promise<boolean> => {
    let ok = false;
    try {
      await api(`${path}/items/${item.id}`, { method: "PATCH", body: { version: item.version, ...body } });
      ok = true;
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) toast(`Someone changed "${item.title}" first. Showing the latest now; your entry is still in the box.`);
      else toast(problem(e));
    }
    refresh();
    return ok;
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
            {/* Checkable groups show done of total, like the tabs; options and records show how many */}
            <h2 className="section-h">{KIND_LABEL[kind][1]} <small>{CHECKABLE.has(kind) && list.length ? `${list.filter((i) => i.status === "done").length}/${list.length}` : list.length}</small></h2>
            {/* Options compare side by side, measures show as cards, everything else as rows */}
            {kind === "option" ? (
              <Options items={list} all={items} path={path} project={project} />
            ) : kind === "purchase" ? (
              <div>{list.map((i) => <PurchaseRow key={i.id} item={i} path={path} project={project} receipts={docs.filter((d) => d.itemId === i.id)} onStatus={(status) => void patch(i, { status })} />)}</div>
            ) : kind === "metric" ? (
              list.length ? <div className="scores">{list.map((m) => (
                <MetricCard key={m.id} item={m} path={path} onReading={canWrite ? (value) => {
                  const f = MetricFields.parse(m.fields);
                  return patch(m, { fields: { readings: [...f.readings, { at: todayIn(org.timeZone), value, note: "" }] } });
                } : undefined} />
              ))}</div> : null
            ) : (
              <div>{list.map((i) => (
                <ItemRow key={i.id} item={i} path={path} marker={edits.find((e) => e.recordId === i.id)} locked={kind === "handoff" && Boolean(i.fields.accepted)} onToggle={CHECKABLE.has(kind) && canWrite ? () => void patch(i, { status: i.status === "done" ? "open" : "done" }) : undefined}
                  extra={kind === "file_request" ? <FileAsk item={i} docs={docs.filter((d) => d.itemId === i.id)} />
                    : kind === "discovery" && !i.body.trim() && canWrite ? <Answer question={i.title} onSave={(text) => void patch(i, { body: text, status: "done" })} />
                    : kind === "handoff" ? <Accept item={i} path={path} project={project} />
                    : kind === "request" && i.fields.scope === "yes" ? <span className="tag warn">changes the agreed scope: goes into the next revision</span>
                    : kind === "request" && i.fields.scope === "unsure" ? <span className="tag">may change the agreed scope</span>
                    : undefined} />
              ))}</div>
            )}
            {/* Once every handover step is done, the decision maker accepts them all with one signature */}
            {kind === "handoff" && <AcceptHandover steps={list} path={path} project={project} />}
            {/* Anyone may add a request; options come from neon1; everything else from editors */}
            {(kind === "request" || (canWrite && (kind !== "option" || me.operator))) && <AddItem kind={kind} path={path} taken={list.map((i) => i.title)} decided={Boolean(currentDecision(items).option)} />}
          </section>
        );
      })}
      {/* Execute ends with the money: hours logged against an estimate, then the project's invoices
          (Pay for the client, drafts and payments for neon1) */}
      {layer === "execution" && <Hours items={items} path={path} />}
      {layer === "execution" && <Invoices items={items} path={path} project={project} />}
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
function ItemRow({ item, path, marker, onToggle, locked, extra }: { item: Item; path: string; marker?: EditMarker; onToggle?: () => void; locked?: boolean; extra?: ReactNode }) {
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
      {/* A step accepted with a signature stays ticked: the box shows it and no longer changes */}
      {locked ? <input type="checkbox" checked disabled aria-label={`Done and accepted: ${item.title}`} /> : onToggle ? <input type="checkbox" checked={item.status === "done"} onChange={onToggle} aria-label={`Done: ${item.title}`} /> : <span style={{ width: 18 }} />}
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
          const late = item.status !== "done" && item.dueDate < todayIn(org.timeZone);
          return <span className={`small ${late ? "late" : "muted"}`} title={late ? "Overdue" : "Due"}>{late && <span className="sr">Overdue, </span>}{dateLabel(item.dueDate)}</span>;
        })()}
        {/* A status update says how things stood and when */}
        {item.kind === "update" && <><Health value={String(item.fields.health ?? "on_track") as Project["health"]} /><span className="small muted">{dateLabel(item.createdAt)}</span></>}
        {item.kind === "requirement" && <span className={`tag prio-${String(item.fields.priority ?? "should")}`}>{PRIORITY_WORDS[String(item.fields.priority ?? "should")]}</span>}
        {item.status !== "open" && item.status !== "done" && <span className="tag">{STATUS_WORDS[item.status] ?? item.status}</span>}
        {owner && <Avatar id={owner.userId} name={owner.name || owner.email} size={22} />}
        <DeleteItem item={item} path={path} label={label} />
      </span>
      <ItemPanel item={item} label={label} path={path} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}


/** The inline form that adds an item of one kind. Each kind says what belongs in it, with an example
 * and one-tap starters; requests are a sentence of taps; requirements pick must, should, or could */
// A short, stable fingerprint of a draft's content, for its requestId (not security, just identity)
function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}


// After a decision, a request says whether it changes what was approved; a yes goes into the next revision
const SCOPE = [["yes", "Yes, it changes it"], ["no", "No"], ["unsure", "Not sure"]] as const;

function AddItem({ kind, path, taken, decided }: { kind: ItemKind; path: string; taken: string[]; decided?: boolean }) {
  const { org } = useOrg();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // Closed to a link until someone adds; extra holds the measure, option, and requirement fields
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [extra, setExtra] = useState({ unit: "", baseline: "", target: "", cost: "" });
  const [priority, setPriority] = useState<"must" | "should" | "could" | "">("should");
  const [scope, setScope] = useState<"yes" | "no" | "unsure" | "">("");
  const guide = GUIDE[kind];
  const label = KIND_LABEL[kind][0];
  // One add at a time: a double click or a second Enter can't create the item twice
  const [adding, runAdd] = useSubmit();
  // The latest typed text, read after a send finishes, so a slow reply can tell whether the person kept
  // typing meanwhile (EP-06)
  const latest = useRef({ title, body });
  latest.current = { title, body };
  // A name for this open form's creates: each draft's requestId is it plus the draft's own content, so a
  // retry of the same draft (after a lost reply or a partial batch) is answered with the item already
  // made, while an edited draft counts as a new one (EP-04). A new form gets a new name
  const session = useRef("");
  if (!session.current && open) session.current = Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  const requestId = (d: unknown, n = 0) => `${session.current}-${n}-${hashText(JSON.stringify(d))}`;

  // Each need in a request becomes its own item, sent in order. A failure part-way says how many went,
  // keeps the form, and a retry resends the rest; the ones already sent are recognized, not repeated
  const sendAll = (drafts: { title: string; body: string; dueDate?: string; fields: Record<string, unknown> }[]) => runAdd(async () => {
    let sent = 0;
    try {
      for (const [n, d] of drafts.entries()) {
        await api(`${path}/items`, { method: "POST", body: { kind, ...d, requestId: requestId(d, n) } });
        sent++;
      }
      setOpen(false);
      session.current = "";
      if (drafts.length > 1) toast(`${drafts.length} requests sent`);
    } catch (e) {
      toast(sent ? `${sent} of ${drafts.length} sent. ${problem(e)} Send again to finish; the ones already sent won't repeat.` : problem(e));
    }
    refresh();
  });
  // Send one item, then close the form, unless the person typed something newer while it was sending:
  // then the newer text stays, and the toast says the earlier version was added
  const send = (item: { title: string; body: string; fields: Record<string, unknown> }) => runAdd(async () => {
    const snapshot = { title, body };
    try {
      await api(`${path}/items`, { method: "POST", body: { kind, ...item, requestId: requestId(item) } });
      session.current = "";
      if (latest.current.title === snapshot.title && latest.current.body === snapshot.body) {
        setTitle("");
        setBody("");
        setOpen(false);
      } else {
        toast(`Added "${item.title}". Your newer text is still here.`);
      }
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
  if (kind === "request") return (
    <>
      {decided && <div className="line scope-q"><span className="small">Does this change what was approved?</span><Pick label="Changes what was approved" options={SCOPE} value={scope} onChange={setScope} /></div>}
      <RequestBuilder busy={adding} timeZone={org.timeZone} onSubmit={(ds) => void sendAll(decided && scope ? ds.map((d) => ({ ...d, fields: { ...d.fields, scope } })) : ds)} onCancel={() => setOpen(false)} />
    </>
  );

  // Measure numbers follow the one rule in lib/measures.ts: blank is unset, anything else must be a
  // number, and a problem shows under its field and stops the add rather than dropping the value (EP-08)
  const numBad = kind === "metric" ? { baseline: numberProblem(extra.baseline), target: numberProblem(extra.target) } : {};
  const num = (s: string) => { const n = optionalNumber(s); return n.ok ? n.value : undefined; };
  // Measures, options, and requirements carry extra fields; every kind gets a title and details
  const submit = () => {
    if (numBad.baseline || numBad.target) {
      document.getElementById(numBad.baseline ? "add-now" : "add-target")?.focus();
      return;
    }
    const fields: Record<string, unknown> = {};
    if (kind === "metric") Object.assign(fields, { unit: extra.unit, baseline: num(extra.baseline), target: num(extra.target) });
    if (kind === "option") Object.assign(fields, { cost: extra.cost });
    if (kind === "requirement") Object.assign(fields, { priority: priority || "should" });
    void send({ title: title.trim(), body, fields });
  };
  return (
    <form className="card add-form" onSubmit={(e) => { e.preventDefault(); if (title.trim()) submit(); }}>
      {guide && <p className="small muted hint">{guide.hint}</p>}
      {/* The title wraps as it grows; Enter adds the item, as a one-line field would */}
      <textarea rows={1} className="title-line" aria-label={`${label} title`} placeholder={guide ? `e.g. ${guide.title}` : label} value={title} onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); if (title.trim()) submit(); } }} maxLength={160} required autoFocus />
      {guide && !title && <Starters kind={kind} taken={taken} onPick={setTitle} />}
      {/* Requirements: how much it matters, as three chips */}
      {kind === "requirement" && (
        <div className="line"><span className="small muted">This is a</span><Pick label="Priority" options={PRIORITY} value={priority} onChange={setPriority} /></div>
      )}
      {(!guide || guide.body) && <textarea aria-label="Details" placeholder={guide?.body ? `${guide.body} (optional)` : "Details (optional)"} value={body} onChange={(e) => setBody(e.target.value)} rows={2} />}
      {/* Measures need a unit, a baseline, and a target; options need a cost */}
      {kind === "metric" && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <input aria-label="Unit" placeholder="Unit, e.g. hours" value={extra.unit} onChange={(e) => setExtra({ ...extra, unit: e.target.value })} />
          <input id="add-now" aria-label="Now" placeholder="Now" inputMode="decimal" value={extra.baseline} onChange={(e) => setExtra({ ...extra, baseline: e.target.value })} aria-invalid={numBad.baseline ? true : undefined} aria-describedby={numBad.baseline ? "add-now-err" : undefined} />
          <input id="add-target" aria-label="Target" placeholder="Target" inputMode="decimal" value={extra.target} onChange={(e) => setExtra({ ...extra, target: e.target.value })} aria-invalid={numBad.target ? true : undefined} aria-describedby={numBad.target ? "add-target-err" : undefined} />
        </div>
      )}
      {numBad.baseline && <p id="add-now-err" className="small late" style={{ margin: 0 }}>Now: {numBad.baseline}</p>}
      {numBad.target && <p id="add-target-err" className="small late" style={{ margin: 0 }}>Target: {numBad.target}</p>}
      {kind === "option" && <input aria-label="Cost" placeholder="Cost, e.g. $4,800 fixed" value={extra.cost} onChange={(e) => setExtra({ ...extra, cost: e.target.value })} />}
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


/**
 * The written price split into what's paid once and what repeats, and a first year when both are
 * known. Only shown when the price reads cleanly (lib/cost.ts); the written price above stays the
 * terms, so this says what it assumes and leaves out
 */
function CostSplit({ cost }: { cost: string }) {
  const parts = parseCost(cost);
  if (!parts) return null;
  const year = firstYear(parts);
  const per = (r: Recurring) => `${money(r)} a ${r.per}`;
  return (
    <dl className="cost-split small">
      {parts.oneTime && <div><dt>One-time</dt><dd>{money(parts.oneTime)}</dd></div>}
      {parts.recurring.length > 0 && <div><dt>Recurring</dt><dd>{parts.recurring.map(per).join(" + ")}</dd></div>}
      {year && <div><dt>First year</dt><dd>{money(year)}<span className="muted"> · one-time plus 12 months, USD, before tax</span></dd></div>}
    </dl>
  );
}


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
  const f = d.fields as { approvedBy?: string; approvedAt?: string; optionVersion?: number; approverName?: string; code?: string; initials?: string; signature?: { typedName: string; at: string; hash: string }; terms?: { title: string; body?: string; cost?: string; timeline?: string } };
  const by = f.approverName || names?.get(String(f.approvedBy)) || "a member";
  return (
    <div className={`decision${superseded ? " superseded" : ""}`} id={`item-${d.id}`}>
      <b>{d.title}</b>
      {superseded && <span className="tag" style={{ marginLeft: 8 }}>replaced by a later decision</span>}
      <div className="small muted">by {by} · {ago(String(f.approvedAt))} · {f.code ? <span className="opt-code">{f.code}</span> : `option version ${String(f.optionVersion)}`}{f.signature ? ` · signed "${f.signature.typedName}"` : ""}{f.initials ? ` · initialed ${f.initials} for items neon1 buys` : ""}</div>
      {f.terms ? (
        <div className="small" style={{ margin: "6px 0 0" }}>
          {(f.terms.cost || f.terms.timeline) && <div className="mono">Agreed: {[f.terms.cost, f.terms.timeline].filter(Boolean).join(" · ")}</div>}
          {f.terms.body && <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{f.terms.body}</p>}
          <PriceBasis terms={f.terms as Priced} />
        </div>
      ) : (
        <p className="small muted" style={{ margin: "6px 0 0" }}>This decision was recorded before 1NEON kept a copy of the approved terms, so only the option and version are on record.</p>
      )}
      {d.body && <p className="small" style={{ margin: "6px 0 0" }}>Conditions: {d.body}</p>}
    </div>
  );
}


/**
 * The proposal strip above the options: the issued revision, where it stands (its price check, what
 * changed since, scope changes waiting), and its actions: read or download it, ask for a refresh, or for
 * neon1, issue the next revision. Earlier revisions stay listed, grayed, and open
 */
function ProposalStrip({ all, path, project, decider }: { all: Item[]; path: string; project: Project; decider: boolean }) {
  const { org, canWrite } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [issuing, setIssuing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, run] = useSubmit();
  const revs = revisions(all);
  const cur = revs.at(-1);
  const base = `/o/${org.slug}/projects/${project.key}`;
  const decided = cur && all.some((i) => i.kind === "decision" && i.fields.proposalId === cur.id);
  const stale = cur && !decided && priceCheckDue(cur.p, todayIn(org.timeZone));
  const changes = cur ? changedSince(cur.p, all) : undefined;
  const scopeAsks = all.filter((i) => i.kind === "request" && i.fields.scope === "yes" && i.status !== "done" && (!cur || i.createdAt > cur.p.issuedAt));
  const mayIssue = me.operator && canWrite;
  const issue = () => run(async () => {
    try {
      const r = await api<Item>(`${path}/proposals`, { method: "POST", body: { note } });
      toast(`Issued ${r.title.replace(/-r/, " r")}`);
      setIssuing(false);
      setNote("");
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  });
  const askRefresh = () => run(async () => {
    try {
      await api(`${path}/proposals/${cur!.id}/refresh`, { method: "POST" });
      toast("neon1 is asked to refresh the prices");
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  });
  const docx = async () => {
    try {
      await downloadDocx(cur!.p, cur!.p.snapshot, org.slug, { fictional: DEMO ? FICTIONAL : undefined });
    } catch (e) {
      toast(problem(e));
    }
  };
  const named = (n: Item[]) => n.map((o) => o.title).join(", ");
  return (
    <div className={`card proposal-strip${stale ? " faded" : ""}`} data-tour="proposal">
      {cur ? (
        <>
          <div><b>Proposal {proposalRef(cur.p.number, cur.p.rev)}</b> <span className="small muted">issued {dateLabel(cur.p.issuedAt.slice(0, 10))}{cur.p.issuerName ? ` by ${cur.p.issuerName}` : ""} · estimates checked {dateLabel(cur.p.issuedAt.slice(0, 10))}, recheck after {dateLabel(cur.p.checkBy)}</span></div>
          {cur.p.note && <div className="small">What changed: {cur.p.note}</div>}
          {stale && <div className="small"><span className="tag warn">prices may have changed</span> Approval waits until neon1 refreshes the prices.{cur.p.refreshAsked ? ` ${cur.p.refreshAsked.name} asked for a refresh ${ago(cur.p.refreshAsked.at)}.` : ""}</div>}
          {changes?.any && <div className="small">Changed since r{cur.p.rev}{changes.edited.length ? `: ${named(changes.edited)} edited` : ""}{changes.added.length ? `${changes.edited.length ? ";" : ":"} ${named(changes.added)} added` : ""}{changes.removed.length ? `; ${changes.removed.map((o) => o.title).join(", ")} taken back` : ""}. {mayIssue ? "Issue the next revision to share it for approval." : "neon1 issues the next revision for approval."}</div>}
        </>
      ) : (
        <div><b>Proposal draft</b> <span className="small muted">not issued yet. {mayIssue ? "Issuing freezes a numbered copy the client approves from." : "Options can be read now and approved once neon1 issues it."}</span></div>
      )}
      {scopeAsks.length > 0 && <div className="small"><span className="tag warn">{scopeAsks.length} {scopeAsks.length === 1 ? "request changes" : "requests change"} the agreed scope</span> {mayIssue ? "Answer with the next revision." : "neon1 answers with the next revision."}</div>}
      <div className="acts">
        <Link className="btn btn-ghost btn-sm" to={`${base}/proposal${cur ? "" : "?draft=1"}`}>{cur ? "Read the proposal" : "Preview the draft"}</Link>
        {cur && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void docx()}>Download Word</button>}
        {cur && mayIssue && (changes?.any || scopeAsks.length > 0 || stale) && <Link className="btn btn-ghost btn-sm" to={`${base}/proposal?draft=1`}>Preview r{cur.p.rev + 1}</Link>}
        {mayIssue && (!cur || changes?.any || stale || scopeAsks.length > 0 || cur.p.refreshAsked) && <button type="button" className="btn btn-primary btn-sm" onClick={() => setIssuing(true)}>{cur ? `Issue r${cur.p.rev + 1}` : "Issue the proposal"}</button>}
        {stale && decider && !cur!.p.refreshAsked && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void askRefresh()}>Ask neon1 to refresh</button>}
        {revs.length > 1 && <span className="small muted">Earlier: {revs.slice(0, -1).map((r, i) => <span key={r.id}>{i ? ", " : ""}<Link className="faded-link" to={`${base}/proposal?r=${r.p.rev}`}>r{r.p.rev}</Link></span>)}</span>}
      </div>
      <Dialog open={issuing} onClose={() => setIssuing(false)} label="Issue the proposal">
        <h2>{cur ? `Issue revision ${cur.p.rev + 1}?` : "Issue the proposal?"}</h2>
        <p className="small muted">This freezes a copy of the proposal as it is now, with an ID on every option, and tells the client. Prices are marked checked today and due a recheck in 30 days. Earlier revisions stay readable.</p>
        <label htmlFor="iss-note">What changed (optional)</label>
        <textarea id="iss-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={cur ? "e.g. prices rechecked; option B adds a scanner" : "e.g. first issue"} />
        <div className="actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => void issue()}>{busy ? "Issuing…" : "Issue"}</button>
          <button className="btn btn-ghost" onClick={() => setIssuing(false)}>Cancel</button>
        </div>
      </Dialog>
    </div>
  );
}


/** Options side by side: draft, shared for approval, approved; approving one from the issued revision records a decision */
function Options({ items, all, path, project }: { items: Item[]; all: Item[]; path: string; project: Project }) {
  const { org, access, canWrite } = useOrg();
  const me = useSession();
  const members = useMembers(org.id);
  const names = new Map(members.data?.map((m) => [m.userId, m.name || m.email]) ?? []);
  // Only the named decision maker (or, with none named, a client admin) sees Approve
  const decider = canApprove({ userId: me.user.id, operator: me.operator, strongSession: false }, access, project.people, isOwnOrg(org.slug)).ok;
  const deciders = project.people.filter((x) => x.role === "decision_maker").map((x) => names.get(x.userId) ?? "the decision maker");
  const toast = useToast();
  const refresh = useRefresh(org.id);
  // The option waiting on approval, the conditions being typed, and initials when neon1 buys something
  const [approving, setApproving] = useState<Item>();
  const [conditions, setConditions] = useState("");
  const [sign, setSign] = useState<SignValue>({ typedName: "", consent: false });
  const signed = useAgreementSigned();
  // Which option the typed conditions belong to: reopening the same one keeps them (after a lost
  // reply, say), and another option starts blank
  const [draftFor, setDraftFor] = useState<string>();
  const startApprove = (o: Item) => { if (draftFor !== o.id) { setConditions(""); setSign({ typedName: "", consent: false }); setDraftFor(o.id); } setApproving(o); };
  // The option open in its panel (details, comments, and for neon1 the edit fields)
  const [openId, setOpenId] = useState<string>();
  const opened = items.find((o) => o.id === openId);
  // The issued revision options are approved from, and whether it's past its price check
  const cur = revisions(all).at(-1);
  const stale = cur && priceCheckDue(cur.p, todayIn(org.timeZone));
  const inRev = (o: Item) => cur?.p.snapshot.options.find((x) => x.id === o.id);
  if (!items.length) return <ProposalStripMaybe all={all} path={path} project={project} decider={decider} />;
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
      // Approvals are never retried on their own; a lost reply says so and the page re-reads
      await api(`${path}/items/${o.id}/approve`, { method: "POST", body: { version: o.version, conditions, signature: { typedName: sign.typedName.trim(), consent: sign.consent } } });
      toast(`Approved: ${inRev(o)?.code ?? ""} ${o.title}`);
      setDraftFor(undefined);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409 && e.body.error === "conflict") toast("That option changed since you opened it. Review it again, then approve.");
      else toast(problem(e));
    }
    refresh();
  };
  // Why a shared option can't be approved yet, in words, or undefined when it can
  const held = (o: Item) => {
    const snap = inRev(o);
    if (!cur) return "neon1 issues the proposal before an option can be approved";
    if (!snap) return `not in Proposal ${proposalRef(cur.p.number, cur.p.rev)} yet; neon1 adds it in the next revision`;
    if (snap.version !== o.version) return `changed since r${cur.p.rev}; neon1 issues the next revision`;
    if (stale) return "prices may have changed; ask neon1 to refresh";
    return undefined;
  };
  const a = approving && OptionFields.parse(approving.fields);
  const aCode = approving && inRev(approving)?.code;
  const neon1Buys = a?.purchases.filter((x) => x.buyer === "neon1") ?? [];
  return (
    <>
      <ProposalStrip all={all} path={path} project={project} decider={decider} />
      {/* The one thing that stands between a decision maker and Approve, said before they press it */}
      {!signed && decider && !decided && items.some((o) => o.status === "proposed") && <AgreementNeeded />}
      <div className="options">
        {items.map((o) => {
          // Fields are validated on read, so a malformed option can't break the board
          const f = OptionFields.parse(o.fields);
          const code = inRev(o)?.code;
          const why = o.status === "proposed" ? held(o) : undefined;
          return (
            <article key={o.id} id={`item-${o.id}`} className={`card option${f.recommended ? " rec" : ""}`}>
              <div className="card-head">
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {f.recommended && <span className="tag rec">recommended</span>}
                  <span className={`tag${o.status === "approved" ? " client" : ""}`}>{STATUS_WORDS[o.status]?.toLowerCase() ?? o.status}</span>
                  {code && <span className="opt-code" title="This option's ID in the issued proposal">{code}</span>}
                </span>
                <DeleteItem item={o} path={path} label="Option" />
              </div>
              <h4><button type="button" className="item-open" onClick={() => setOpenId(o.id)}>{o.title}</button></h4>
              {/* The card shows the first paragraph; the panel and the proposal show every detail */}
              {o.body && <p className="small muted" style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>{o.body.split(/\n\s*\n/)[0]}</p>}
              {f.cost && <p className="mono small" style={{ margin: "0 0 8px" }}>{f.cost}{f.timeline ? ` · ${f.timeline}` : ""}{DEMO && <span className="tag" style={{ marginLeft: 6 }}>illustrative</span>}</p>}
              {(f.hours || f.outsideCosts) && <p className="small muted" style={{ margin: "0 0 8px" }}>{[f.hours && `neon1's time: ${f.hours}${f.rateCents && f.pricing === "estimate" ? ` at ${wholeDollars(f.rateCents)} an hour` : ""}`, f.outsideCosts && `Paid directly: ${f.outsideCosts}`].filter(Boolean).join(" · ")}</p>}
              {f.purchases.length > 0 && <p className="small muted" style={{ margin: "0 0 8px" }}>To buy: {f.purchases.map((x) => `${x.name}${x.estimate ? ` (${x.estimate})` : ""}${x.buyer === "neon1" ? ", neon1 buys" : ""}`).join("; ")}</p>}
              <CostSplit cost={f.cost} />
              {/* The reason behind the recommendation, or when a different option is the better pick */}
              {f.why && <p className="small option-why"><b>{f.recommended ? "Why neon1 recommends it" : "When to pick it"}:</b> {f.why}</p>}
              {/* The price is never a bare number: what kind it is, the hours behind it, when it's paid */}
              <PriceBasis terms={f} />
              {/* Cost, quality, and effort, scored so more bars is always better: neon1's own judgment */}
              <p className="assess-h">neon1's assessment</p>
              <Meter label="Cost" value={f.costScore} />
              <Meter label="Quality" value={f.qualityScore} />
              <Meter label="Effort" value={f.effortScore} />
              {/* The decision maker approves a proposed option of the issued revision; editors move drafts along */}
              <div className="option-acts">
                {o.status === "proposed" && decider && !why && <button className={`btn ${decided ? "btn-ghost" : "btn-primary"}`} onClick={() => startApprove(o)}>{decided ? "Choose this instead" : "Approve this option"}</button>}
                {o.status === "proposed" && decider && why && <span className="small muted">Approval waits: {why}.</span>}
                {o.status === "proposed" && !decider && !decided && <span className="small muted">Waiting on {deciders.length ? deciders.join(" or ") : "a client admin"}</span>}
                {/* Sharing an option and taking it back are neon1's to do; the client approves */}
                {canWrite && me.operator && o.status === "draft" && <button className="btn btn-ghost" onClick={() => void setStatus(o, "proposed")}>Share with client</button>}
                {canWrite && me.operator && o.status === "proposed" && <button className="btn btn-ghost" onClick={() => void setStatus(o, "draft")}>Back to draft</button>}
              </div>
            </article>
          );
        })}
      </div>
      {/* What the scores mean, once for all the options */}
      <p className="small muted assess-rubric">
        <b>neon1's assessment</b>, from 1 to 5, where more filled dots is always better. <b>Cost</b>: the total cost. <b>Quality</b>: how fully it meets the agreed requirements. <b>Effort</b>: your team's effort to adopt and run it. The written price on each option is the price you'd accept{DEMO ? "; every figure in this demo is illustrative" : ""}.
      </p>
      {opened && <ItemPanel item={opened} label="Option" path={path} open onClose={() => setOpenId(undefined)} />}
      {/* Approval restates exactly what's being accepted, so nobody recalls terms from another screen */}
      <Dialog open={Boolean(approving)} onClose={() => setApproving(undefined)} label="Approve option">
        <h2>Approve {aCode ?? "this option"}?</h2>
        {approving && a && (
          <dl className="terms-list">
            <dt>Option</dt><dd><b>{approving.title}</b>{aCode && <span className="opt-code"> · {aCode}</span>}</dd>
            {cur && <><dt>From</dt><dd>Proposal {proposalRef(cur.p.number, cur.p.rev)}, issued {dateLabel(cur.p.issuedAt.slice(0, 10))}</dd></>}
            <dt>Price</dt><dd>{a.cost || "not stated"}<CostSplit cost={a.cost} />{priceOf(a) && <div className="small muted">{priceMeaning(priceOf(a)!)}</div>}</dd>
            {priceOf(a) && <><dt>When you pay</dt><dd>{paymentPlan(priceOf(a)!).map((l) => <div key={l}>{l}</div>)}</dd></>}
            {a.timeline && <><dt>Timeline</dt><dd>{a.timeline}</dd></>}
            {a.hours && <><dt>neon1's time</dt><dd>{a.hours}</dd></>}
            {a.outsideCosts && <><dt>Paid directly by you</dt><dd>{a.outsideCosts}</dd></>}
            {a.purchases.length > 0 && <><dt>To buy</dt><dd>{a.purchases.map((x, i) => <div key={i}>{x.name}{x.estimate ? `, ${x.estimate}` : ""}: {x.buyer === "neon1" ? "neon1 buys it, paid back at cost" : "you buy it"}</div>)}</dd></>}
            {a.result && <><dt>Result to check</dt><dd>{a.result}</dd></>}
          </dl>
        )}
        <label htmlFor="cond">Conditions (optional)</label>
        <textarea id="cond" value={conditions} onChange={(e) => setConditions(e.target.value)} maxLength={2000} placeholder="e.g. only if the work happens after 6pm" />
        {neon1Buys.length > 0 && <p className="small">Signing also agrees that neon1 buys {neon1Buys.map((x) => x.name).join(" and ")} for you and is paid back at cost, with the receipt.</p>}
        {signed ? <SignBox id="approve-sign" value={sign} onChange={setSign} /> : <AgreementNeeded />}
        <p className="small muted">Signing approves this option's scope and price under your service agreement. 1NEON keeps a copy of these terms with your signature, who signed and when; none of it can be edited afterwards. Invoices follow as the proposal says.</p>
        <div className="actions">
          <button className="btn btn-primary" disabled={!signed || !signReady(sign)} onClick={() => void approve()}>Sign and approve {aCode ?? ""}</button>
          <button className="btn btn-ghost" onClick={() => setApproving(undefined)}>Cancel</button>
        </div>
      </Dialog>
    </>
  );
}

/** With no options shared yet, the strip shows only once there's a revision to talk about */
function ProposalStripMaybe(props: { all: Item[]; path: string; project: Project; decider: boolean }) {
  return revisions(props.all).length ? <ProposalStrip {...props} /> : null;
}


/**
 * A purchase in Execute: what, the estimate and actual cost, who buys it, the agreement when neon1 buys,
 * and its receipt. Bought or installed without a receipt is flagged, not blocked
 */
function PurchaseRow({ item, path, project, receipts, onStatus }: { item: Item; path: string; project: Project; receipts: DocumentRecord[]; onStatus: (status: string) => void }) {
  const { org, access, canWrite } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [open, setOpen] = useState(false);
  const [initials, setInitials] = useState("");
  const f = PurchaseFields.parse(item.fields);
  const decider = canApprove({ userId: me.user.id, operator: me.operator, strongSession: false }, access, project.people, isOwnOrg(org.slug)).ok;
  const ready = receipts.filter((d) => d.uploaded);
  const needsReceipt = (item.status === "bought" || item.status === "done") && !receipts.length;
  const waitsOnAgreement = f.buyer === "neon1" && !f.agreed;
  const agree = async () => {
    try {
      await api(`${path}/items/${item.id}/agree`, { method: "POST", body: { version: item.version, initials } });
      toast(`Agreed: neon1 buys ${item.title}`);
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };
  return (
    <div className="item" id={`item-${item.id}`}>
      <span style={{ width: 18 }} />
      <div>
        <button type="button" className={`item-open title${item.status === "done" ? " is-done" : ""}`} onClick={() => setOpen(true)}>{item.title}</button>
        <div className="purchase-meta">
          {f.estimate && <span className="muted">Estimate {f.estimate}</span>}
          {f.actual && <span>Paid {f.actual}{f.vendor ? ` at ${f.vendor}` : ""}</span>}
          <span className={`tag${f.buyer === "neon1" ? " warn" : ""}`}>{f.buyer === "neon1" ? "neon1 buys, paid back at cost" : "you buy"}</span>
          {f.from && <span className="opt-code">{f.from}</span>}
          {f.agreed && <span className="small muted">agreed {f.agreed.initials} ({f.agreed.name}), {dateLabel(f.agreed.at.slice(0, 10))}</span>}
          {needsReceipt && <span className="tag warn">receipt missing</span>}
          {ready.map((d) => <span key={d.id} className="tag client">{d.name}</span>)}
        </div>
        {waitsOnAgreement && decider && (
          <form className="line" onSubmit={(e) => { e.preventDefault(); if (initials.trim()) void agree(); }}>
            <label className="small" htmlFor={`ini-${item.id}`}>Your initials to agree neon1 buys it, paid back at cost:</label>
            <input id={`ini-${item.id}`} value={initials} onChange={(e) => setInitials(e.target.value.toUpperCase())} maxLength={8} style={{ width: 80 }} autoComplete="off" />
            <button className="btn btn-ghost btn-sm" disabled={!initials.trim()}>Agree</button>
          </form>
        )}
        {waitsOnAgreement && !decider && <p className="small muted" style={{ margin: "4px 0 0" }}>Waiting on the decision maker's initials before neon1 buys it.</p>}
        <div className="file-ask"><UploadButton target={{ layer: "execution", projectId: item.projectId, itemId: item.id }} label={receipts.length ? "Add another receipt" : "Attach the receipt"} className="chip" /></div>
      </div>
      <span className="item-meta">
        {canWrite ? (
          <select aria-label={`Where ${item.title} stands`} value={item.status} onChange={(e) => onStatus(e.target.value)} disabled={waitsOnAgreement && item.status === "open"} style={{ width: "auto", minHeight: 32, padding: "2px 8px" }}>
            {["open", "bought", "done", "returned"].map((s) => <option key={s} value={s}>{statusWord("purchase", s)}</option>)}
          </select>
        ) : <span className="tag">{statusWord("purchase", item.status)}</span>}
        <DeleteItem item={item} path={path} label="Purchase" />
      </span>
      <ItemPanel item={item} label="Purchase" path={path} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}


/** Under a handover step: who accepted it and when, or Accept for the decision maker */
function Accept({ item, path, project }: { item: Item; path: string; project: Project }) {
  const { org, access } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [sign, setSign] = useState<SignValue>({ typedName: "", consent: false });
  const f = HandoffFields.safeParse(item.fields);
  const accepted = f.success ? f.data.accepted : undefined;
  if (accepted) return <p className="accepted-note">Accepted by {accepted.name}, {dateLabel(accepted.at.slice(0, 10))}{accepted.note ? `: ${accepted.note}` : ""}{accepted.signature ? `, signed "${accepted.signature.typedName}"` : ""}</p>;
  const decider = canApprove({ userId: me.user.id, operator: me.operator, strongSession: false }, access, project.people, isOwnOrg(org.slug)).ok;
  // A step already ticked waits for the one signature under the list; this accepts a step that isn't
  // done yet, on its own, which also marks it done
  if (!decider || item.status === "done") return null;
  const accept = async () => {
    try {
      await api(`${path}/items/${item.id}/accept`, { method: "POST", body: { version: item.version, note, signature: { typedName: sign.typedName.trim(), consent: sign.consent } } });
      toast(`Accepted: ${item.title}`);
      setOpen(false);
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };
  return open ? (
    <form className="accept-form" onSubmit={(e) => { e.preventDefault(); if (signReady(sign)) void accept(); }}>
      <input aria-label="What you checked (optional)" placeholder="What you checked (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <SignBox id={`accept-${item.id}`} value={sign} onChange={setSign} />
      <div className="line">
        <button className="btn btn-primary btn-sm" disabled={!signReady(sign)}>Sign and accept</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  ) : <button type="button" className="chip" onClick={() => setOpen(true)}>Check it and accept</button>;
}


/**
 * Under the handover steps, for the decision maker: once every step is done, one signature accepts
 * them all (each step keeps its own signed record). Until then it says how many steps are left
 */
function AcceptHandover({ steps, path, project }: { steps: Item[]; path: string; project: Project }) {
  const { org, access } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sign, setSign] = useState<SignValue>({ typedName: "", consent: false });
  const waiting = steps.filter((i) => !i.fields.accepted);
  const left = steps.filter((i) => i.status !== "done").length;
  const decider = canApprove({ userId: me.user.id, operator: me.operator, strongSession: false }, access, project.people, isOwnOrg(org.slug)).ok;
  if (!steps.length || !waiting.length) return steps.length ? <p className="accepted-note handover-all">The handover is accepted: every step is signed for.</p> : null;
  if (!decider) return null;
  if (left) return <p className="small muted handover-all">When all {steps.length} steps are done, you can accept the handover with one signature. {left} to go.</p>;
  const accept = async () => {
    setBusy(true);
    try {
      await api(`${path}/handover/accept`, { method: "POST", body: { note, signature: { typedName: sign.typedName.trim(), consent: sign.consent } } });
      toast("Handover accepted");
      setOpen(false);
    } catch (e) {
      toast(problem(e));
    }
    setBusy(false);
    refresh();
  };
  return (
    <div className="handover-all card">
      <p style={{ margin: 0 }}><b>Every step is done.</b> Accept the handover with one signature: it signs for {waiting.length === steps.length ? `all ${steps.length} steps` : `the ${waiting.length} ${waiting.length === 1 ? "step" : "steps"} not yet accepted`}, and neon1 prepares the final invoice.</p>
      {open ? (
        <form className="accept-form" onSubmit={(e) => { e.preventDefault(); if (signReady(sign) && !busy) void accept(); }}>
          <input aria-label="What you checked (optional)" placeholder="What you checked (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <SignBox id="accept-handover" value={sign} onChange={setSign} />
          <div className="line">
            <button className="btn btn-primary btn-sm" disabled={!signReady(sign) || busy}>Sign and accept the handover</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : <div className="actions" style={{ marginTop: 8 }}><button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>Accept the handover</button></div>}
    </div>
  );
}


/** A small trash button on a row or card: deletes after the same are-you-sure as the item's panel.
 * Shown only to people who may delete it (see useMayDelete) */
function DeleteItem({ item, path, label }: { item: Item; path: string; label: string }) {
  const may = useMayDelete(item);
  const remove = useDeleteItem(path);
  if (!may) return null;
  return <button type="button" className="icon-act del" onClick={() => void remove(item, label)} aria-label={`Delete ${item.title}`} title="Delete"><Trash2 size={15} aria-hidden="true" /></button>;
}
