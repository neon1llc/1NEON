// apps/api/src/routes/items.ts - Layer items on a project (needs, execute, observe, normalize),
// approving an option into an immutable decision, and the advisory edit markers.


import { AcceptInput, AgreeInput, ApproveInput, CreateItemInput, IssueInput, changeRecord, itemChanges, assessed, completionAfter, priceCheckDue, proposalRef, resolveTiming, revisions, DecisionFields, Item, OptionFields, PRICE_CHECK_DAYS, PurchaseFields, UpdateItemInput, canApprove, isOwnOrg, newId, rankBetween, settableStatus, todayIn, type Project } from "@1neon/domain";
import type { Context } from "hono";
import { z } from "zod";
import { actorId, body, byRank, check, defined, fail, label, need, now, validateFields, who, type Env } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import { keys } from "../store/repo.ts";
import { issueProposal } from "../proposals.ts";


// Edit markers last two minutes; the editor's browser renews them while the form is open
const EDIT_MS = 2 * 60 * 1000;


// A stable key for a create's requestId, the same in the API and the in-browser demo (which runs these
// routes, so no node:crypto): two independent 32-bit FNV-1a passes, about 64 bits, in base 36
function replayKey(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(36).padStart(7, "0") + b.toString(36).padStart(7, "0");
}


export function itemRoutes(app: App, k: Kit) {
  const { repo, project, activeMembers } = k;

  // Layer items (Needs, Execute, Observe, Normalize)

  app.post("/t/:tid/projects/:pid/items", async (c) => {
    const p = await project(c);
    const input = await body(c, CreateItemInput);
    // Anyone who can read may submit a request (intake); everything else needs write
    need(c, input.kind === "request" ? "comment" : "write");
    if (input.kind === "decision") fail(400, "invalid", "Decisions are recorded by approving an option.");
    if (input.kind === "proposal") fail(400, "invalid", "Proposal revisions are made by issuing the proposal.");
    // Agreements and acceptances are recorded by their own routes, by the people allowed to give them
    if (input.kind === "purchase" || input.kind === "handoff") { delete input.fields.agreed; delete input.fields.accepted; }
    // Options are neon1's proposals: neon1 writes, shares, and withdraws them; the client approves one
    if (input.kind === "option" && !who(c).actor.operator) fail(403, "neon1_only", "Options are proposed by neon1. Add a request instead, and they'll come back as options.");
    if (input.status !== undefined && !settableStatus(input.kind, input.status)) fail(400, "invalid_status", `"${input.status}" isn't a status for this kind of item.`);
    if (input.assigneeId) await activeMembers(p.tenantId, [input.assigneeId]);
    const fields = validateFields(input.kind, input.fields);
    // A create with a requestId has an item id derived from it (person, project, request), so a repeat
    // finds the item already made and answers with it, unchanged, instead of making another (EP-04)
    const replayId = input.requestId ? `i_r${replayKey(`${p.tenantId}|${p.id}|${actorId(c)}|${input.requestId}`)}` : undefined;
    if (replayId) {
      const made = await repo.getItem(p.tenantId, p.id, replayId);
      if (made) return c.json(made, 200);
    }
    const items = (await repo.listItems(p.tenantId, p.id)).filter((i) => i.kind === input.kind).sort(byRank);
    const ts = now();
    const { requestId: _request, ...stored } = input;
    void _request;
    const item = Item.parse({
      ...stored,
      fields,
      tenantId: p.tenantId,
      projectId: p.id,
      id: replayId ?? newId("i"),
      status: input.status ?? (input.kind === "option" ? "draft" : "open"),
      rank: rankBetween(items.at(-1)?.rank ?? "", ""),
      version: 1,
      createdAt: ts,
      updatedAt: ts,
      updatedBy: actorId(c),
    });
    // A request timed "this month" or "this quarter" gets an absolute due date now, in the
    // organization's time zone, and keeps the words apart. A date the form already showed the person
    // wins; older tabs that send only the words get it resolved here
    const timing = item.kind === "request" ? resolveTiming(item.fields.due, new Date(ts), c.get("tenant").timeZone) : undefined;
    if (timing) {
      item.requestedTiming = timing.requestedTiming;
      item.dueDate ??= timing.dueDate;
    }
    // Created already done: that is its completion
    item.completedAt = completionAfter(undefined, item.status, ts);
    // A status update is a health assessment: it sets the project's health and records who assessed it
    // and when, in the same transaction, even when the health stays the same (that refreshes it)
    const health = item.kind === "update" ? (item.fields as { health?: Project["health"] }).health : undefined;
    const healthOp = health ? [repo.projectOp({ ...p, health, ...assessed(health, actorId(c), ts), version: p.version + 1, updatedAt: ts, updatedBy: actorId(c) }, { version: p.version })] : [];
    try {
      await repo.table.write([repo.itemOp(item, { create: true }), ...healthOp, repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: `${item.kind}.created`, target: item.id, summary: `${p.key}: added ${label(item.kind)} "${item.title}"` })]);
    } catch (e) {
      // Two copies of the same request racing: the one that lost answers with the winner's item
      const made = replayId ? await repo.getItem(p.tenantId, p.id, replayId) : undefined;
      if (made) return c.json(made, 200);
      throw e;
    }
    return c.json(item, 201);
  });

  // Edit an item. Finishing an edit also clears the caller's edit marker
  app.patch("/t/:tid/projects/:pid/items/:iid", async (c) => {
    need(c, "write");
    const p = await project(c);
    const item = await repo.getItem(p.tenantId, p.id, c.req.param("iid"));
    if (!item) fail(404, "not_found", "That item no longer exists.");
    if (item.kind === "decision") fail(400, "immutable", "Decisions can't be edited. Approve a new option to change the decision.");
    if (item.kind === "proposal") fail(400, "immutable", "An issued revision is a record and stays as issued. Issue the next revision instead.");
    if (item.kind === "option" && !who(c).actor.operator) fail(403, "neon1_only", "Options are proposed by neon1. Comment on the option to ask for a change.");
    const input = await body(c, UpdateItemInput);
    // Agreements and acceptances only come from their routes; an edit keeps whatever was recorded
    if (input.fields) { delete input.fields.agreed; delete input.fields.accepted; }
    // An approved option is part of a decision's record: its terms and status don't change. A revised
    // proposal is a new option, approved on its own
    if (item.status === "approved" && (input.title !== undefined || input.body !== undefined || input.fields !== undefined)) fail(400, "immutable", "This option is approved. Propose a new option to change its terms.");
    // Statuses follow each kind's list; an approval is final and only the approve route grants it
    if (input.status !== undefined && input.status !== item.status) {
      if (item.status === "approved") fail(400, "immutable", "This option is approved. Propose a new option to change course.");
      if (!settableStatus(item.kind, input.status)) fail(400, "invalid_status", `"${input.status}" isn't a status for this kind of item.`);
    }
    if (input.assigneeId) await activeMembers(p.tenantId, [input.assigneeId]);
    const { version, assigneeId, dueDate, fields, ...patch } = input;
    const next: Item = { ...item, ...defined(patch), version: item.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    if (assigneeId !== undefined) next.assigneeId = assigneeId ?? undefined;
    if (dueDate !== undefined) next.dueDate = dueDate ?? undefined;
    if (fields) next.fields = validateFields(item.kind, { ...item.fields, ...fields });
    // Who buys can change before anything is bought; a change of buyer drops an earlier agreement
    if (item.kind === "purchase") {
      const was = PurchaseFields.parse(item.fields), will = PurchaseFields.parse(next.fields);
      if (was.buyer !== will.buyer) delete next.fields.agreed;
      // neon1 buys only with the client's initials on record (paid back at cost, with the receipt)
      if (will.buyer === "neon1" && !next.fields.agreed && (next.status === "bought" || next.status === "done") && item.status !== next.status) fail(409, "needs_agreement", "neon1 buys this only after the client agrees, with their initials, to pay it back at cost.");
    }
    // Completion is its own event: an edit to wording, assignee, or fields never moves it
    next.completedAt = completionAfter(item, next.status, next.updatedAt);
    // Work starting never changes the project's health: that stays the team's assessment
    // What changed, in words: "status To do → Done", "due Nov 3, 2026 → Nov 10, 2026". A save that
    // changed nothing still saves (and moves the version on), but records no activity
    const names = new Map((await repo.listMembers(p.tenantId)).map((m) => [m.userId, m.name || m.email]));
    const record = changeRecord(`${p.key}: updated ${label(item.kind)} "${next.title}"`, itemChanges(item, next, (id) => names.get(id) ?? "someone"));
    await repo.table.write([repo.itemOp(next, { version }), ...(record ? [repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: `${item.kind}.updated`, target: item.id, ...record })] : [])]);
    await repo.clearEditing(p.tenantId, p.id, item.id, actorId(c));
    return c.json(next);
  });

  // Remove an item, guarded by the version the person last saw
  app.delete("/t/:tid/projects/:pid/items/:iid", async (c) => {
    need(c, "write");
    const p = await project(c);
    const item = await repo.getItem(p.tenantId, p.id, c.req.param("iid"));
    if (!item) fail(404, "not_found", "That item no longer exists.");
    if (item.kind === "decision") fail(400, "immutable", "Decisions are kept as a permanent record.");
    if (item.kind === "proposal") fail(400, "immutable", "Issued revisions are kept as a permanent record.");
    if (item.status === "approved") fail(400, "immutable", "An approved option is part of a decision's record and stays.");
    if (item.kind === "option" && !who(c).actor.operator) fail(403, "neon1_only", "Options are proposed by neon1. Comment on the option to ask for a change.");
    const version = Number(c.req.query("version"));
    if (!Number.isInteger(version)) fail(400, "invalid", "Send the version you last saw.");
    await repo.table.write([
      { delete: keys.item(p.tenantId, p.id, item.id), guard: { version } },
      repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: `${item.kind}.deleted`, target: item.id, summary: `${p.key}: removed ${label(item.kind)} "${item.title}"` }),
    ]);
    return c.json({ ok: true });
  });

  /**
   * Approve an option of the issued proposal: records an immutable decision tied to the exact option
   * version and its ID in the revision (0039-r2-B). An option changed since the revision was issued, or
   * a revision past its price check, waits for neon1 to issue the next one. Purchases the option lists
   * become Execute items in the same write; any that neon1 buys need the approver's initials
   */
  app.post("/t/:tid/projects/:pid/items/:iid/approve", async (c) => {
    const p = await project(c);
    // Only a named decision maker approves (or, with none named, the client's own admins)
    check(canApprove(who(c).actor, c.get("access"), p.people, isOwnOrg(c.get("tenant").slug)));
    const option = await repo.getItem(p.tenantId, p.id, c.req.param("iid"));
    if (!option || option.kind !== "option") fail(404, "not_found", "That option no longer exists.");
    if (option.status !== "proposed") fail(409, "not_proposed", option.status === "approved" ? "This option is already approved." : "Only an option shared for approval can be approved.");
    const input = await body(c, ApproveInput);
    if (input.version !== option.version) fail(409, "conflict", "The option changed since you read it. Review it again before approving.", option);
    const items = await repo.listItems(p.tenantId, p.id);
    // The revision it's approved from: the latest issued one, which must hold this exact version
    const rev = revisions(items).at(-1);
    if (!rev) fail(409, "not_issued", "neon1 hasn't issued this proposal yet. Options can be approved once it is.");
    const snap = rev.p.snapshot.options.find((o) => o.id === option.id);
    if (!snap) fail(409, "not_in_revision", `This option isn't part of Proposal ${proposalRef(rev.p.number, rev.p.rev)}. Ask neon1 to issue the next revision.`);
    if (snap.version !== option.version) fail(409, "changed_since_issue", `This option changed after Proposal ${proposalRef(rev.p.number, rev.p.rev)} was issued. neon1 issues the next revision before it can be approved.`);
    if (priceCheckDue(rev.p, todayIn(c.get("tenant").timeZone))) fail(409, "price_check", `The estimates in Proposal ${proposalRef(rev.p.number, rev.p.rev)} were checked over ${PRICE_CHECK_DAYS} days ago. Ask neon1 to refresh it, then approve.`);
    const of = OptionFields.parse(option.fields);
    const neon1Buys = of.purchases.filter((x) => x.buyer === "neon1");
    if (neon1Buys.length && !input.initials) fail(400, "initials_needed", "This option has neon1 buy some items for you, paid back at cost. Add your initials to agree.");
    const ts = now();
    const by = actorId(c);
    const approver = who(c).user;
    // The terms exactly as approved travel with the decision, so it never depends on the option later
    const terms = { title: option.title, body: option.body, cost: of.cost, timeline: of.timeline, hours: of.hours || undefined, outsideCosts: of.outsideCosts || undefined, result: of.result || undefined, costScore: of.costScore, qualityScore: of.qualityScore, effortScore: of.effortScore, recommended: of.recommended, purchases: of.purchases.length ? of.purchases : undefined };
    const earlier = items.filter((i) => i.kind === "decision").map((i) => i.id);
    const name = approver.name || approver.email;
    const decision = Item.parse({
      tenantId: p.tenantId,
      projectId: p.id,
      id: newId("i"),
      kind: "decision",
      title: `Approved: ${option.title}`,
      body: input.conditions,
      status: "approved",
      rank: ts,
      fields: DecisionFields.parse({ optionId: option.id, optionVersion: option.version, approvedBy: by, approvedAt: ts, conditions: input.conditions, terms, approverName: approver.name || undefined, approverEmail: approver.email, supersedes: earlier.length ? earlier : undefined, proposalId: rev.id, code: snap.code, initials: neon1Buys.length ? input.initials : undefined }),
      version: 1,
      createdAt: ts,
      updatedAt: ts,
      updatedBy: by,
    });
    // The option and its decision are written in one transaction, so neither exists without the other
    const approved: Item = { ...option, status: "approved", version: option.version + 1, updatedAt: ts, updatedBy: by };
    // The option's purchases join Execute, unless an earlier approval of the same ID already added them
    const have = new Set(items.filter((i) => i.kind === "purchase").map((i) => `${String(i.fields.from)}|${i.title}`));
    const ranked = items.filter((i) => i.kind === "purchase").sort(byRank);
    let last = ranked.at(-1)?.rank ?? "";
    const buys = of.purchases.filter((x) => !have.has(`${snap.code}|${x.name}`)).map((x) => {
      last = rankBetween(last, "");
      return Item.parse({
        tenantId: p.tenantId, projectId: p.id, id: newId("i"), kind: "purchase", title: x.name, body: "", status: "open", rank: last,
        fields: PurchaseFields.parse({ estimate: x.estimate, why: x.why, example: x.example, buyer: x.buyer, from: snap.code, agreed: x.buyer === "neon1" ? { by, name, initials: input.initials, at: ts } : undefined }),
        version: 1, createdAt: ts, updatedAt: ts, updatedBy: by,
      });
    });
    await repo.table.write([
      repo.itemOp(approved, { version: option.version }),
      repo.itemOp(decision, { create: true }),
      ...buys.map((b) => repo.itemOp(b, { create: true })),
      repo.auditOp({ tenantId: p.tenantId, actorId: by, action: "decision.approved", target: decision.id, summary: `${p.key}: approved ${snap.code} "${option.title}" (version ${option.version})` }),
    ]);
    return c.json({ decision, option: approved, purchases: buys }, 201);
  });

  /**
   * Issue the next revision of the project's proposal: neon1 only. Freezes a copy of everything the
   * proposal shows, numbers it (the project's proposal number, or the next one across neon1), sets the
   * price check date, and marks the earlier revision replaced. The client is told through the bell
   */
  app.post("/t/:tid/projects/:pid/proposals", async (c) => {
    need(c, "write");
    if (!who(c).actor.operator) fail(403, "neon1_only", "Proposals are issued by neon1.");
    const p = await project(c);
    const input = await body(c, IssueInput);
    const u = who(c).user;
    const r = await issueProposal(repo, c.get("tenant"), p, { id: actorId(c), name: u.name }, input.note);
    if (r.error) fail(409, "no_options", "Share at least one option before issuing the proposal.");
    const issued = r.issued;
    return c.json(issued, 201);
  });

  /** A decision maker asks neon1 to refresh a revision past its price check (recorded once per revision) */
  app.post("/t/:tid/projects/:pid/proposals/:iid/refresh", async (c) => {
    const p = await project(c);
    check(canApprove(who(c).actor, c.get("access"), p.people, isOwnOrg(c.get("tenant").slug)));
    const it = await repo.getItem(p.tenantId, p.id, c.req.param("iid"));
    if (!it || it.kind !== "proposal") fail(404, "not_found", "That proposal revision doesn't exist.");
    if (it.fields.refreshAsked) return c.json(it);
    const u = who(c).user;
    const ts = now();
    const next: Item = { ...it, fields: { ...it.fields, refreshAsked: { by: actorId(c), name: u.name || u.email, at: ts } }, version: it.version + 1, updatedAt: ts, updatedBy: actorId(c) };
    await repo.table.write([repo.itemOp(next, { version: it.version }), repo.auditOp({ tenantId: p.tenantId, actorId: actorId(c), action: "proposal.refresh_asked", target: it.id, summary: `${p.key}: ${u.name || u.email} asked neon1 to refresh ${it.title}` })]);
    return c.json(next);
  });

  /** The record a decision maker gives about one item: initials on a purchase neon1 makes, or acceptance of a handover step */
  async function decide(c: Context<Env>, kind: "purchase" | "handoff") {
    const p = await project(c);
    check(canApprove(who(c).actor, c.get("access"), p.people, isOwnOrg(c.get("tenant").slug)));
    const it = await repo.getItem(p.tenantId, p.id, c.req.param("iid")!);
    if (!it || it.kind !== kind) fail(404, "not_found", "That item no longer exists.");
    return { p, it, u: who(c).user, ts: now(), by: actorId(c) };
  }

  app.post("/t/:tid/projects/:pid/items/:iid/agree", async (c) => {
    const { p, it, u, ts, by } = await decide(c, "purchase");
    const input = await body(c, AgreeInput);
    if (input.version !== it.version) fail(409, "conflict", "This purchase changed since you read it. Review it again.", it);
    if (PurchaseFields.parse(it.fields).buyer !== "neon1") fail(400, "invalid", "Only items neon1 buys for you need your agreement.");
    const next: Item = { ...it, fields: { ...it.fields, agreed: { by, name: u.name || u.email, initials: input.initials, at: ts } }, version: it.version + 1, updatedAt: ts, updatedBy: by };
    await repo.table.write([repo.itemOp(next, { version: it.version }), repo.auditOp({ tenantId: p.tenantId, actorId: by, action: "purchase.agreed", target: it.id, summary: `${p.key}: ${u.name || u.email} (${input.initials}) agreed neon1 buys "${it.title}", paid back at cost` })]);
    return c.json(next);
  });

  app.post("/t/:tid/projects/:pid/items/:iid/accept", async (c) => {
    const { p, it, u, ts, by } = await decide(c, "handoff");
    const input = await body(c, AcceptInput);
    if (input.version !== it.version) fail(409, "conflict", "This step changed since you read it. Review it again.", it);
    const next: Item = { ...it, status: "done", completedAt: completionAfter(it, "done", ts), fields: { ...it.fields, accepted: { by, name: u.name || u.email, at: ts, note: input.note } }, version: it.version + 1, updatedAt: ts, updatedBy: by };
    await repo.table.write([repo.itemOp(next, { version: it.version }), repo.auditOp({ tenantId: p.tenantId, actorId: by, action: "handoff.accepted", target: it.id, summary: `${p.key}: ${u.name || u.email} accepted "${it.title}"${input.note ? `: ${input.note}` : ""}` })]);
    return c.json(next);
  });
}


// Registered after the comment routes, where createApp always had them
export function editRoutes(app: App, k: Kit) {
  const { repo, project } = k;

  // Edit markers: advisory "Dana is editing" hints that expire on their own

  app.post("/t/:tid/projects/:pid/edits", async (c) => {
    need(c, "write");
    const p = await project(c);
    const { recordId } = await body(c, z.object({ recordId: z.string().min(1).max(64) }));
    const u = who(c).user;
    const holder = await repo.markEditing(p.tenantId, p.id, { recordId, userId: u.id, name: u.name || u.email, expiresAt: new Date(Date.now() + EDIT_MS).toISOString() });
    return c.json({ ok: !holder, holder });
  });

  app.delete("/t/:tid/projects/:pid/edits/:recordId", async (c) => {
    need(c, "read");
    const p = await project(c);
    await repo.clearEditing(p.tenantId, p.id, c.req.param("recordId"), actorId(c));
    return c.json({ ok: true });
  });
}
