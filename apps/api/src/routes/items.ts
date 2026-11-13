// apps/api/src/routes/items.ts - Layer items on a project (needs, execute, observe, normalize),
// approving an option into an immutable decision, and the advisory edit markers.


import { AGREEMENT_EDITION, AcceptInput, AgreeInput, ApproveInput, canonical, finalLines, lineage, refundCredit, priceOf, initialsOf, sha256Hex, signature, depositLines, InvoiceFields, CreateItemInput, IssueInput, changeRecord, itemChanges, assessed, completionAfter, priceCheckDue, proposalRef, resolveTiming, revisions, DecisionFields, Item, OptionFields, PRICE_CHECK_DAYS, PurchaseFields, UpdateItemInput, canApprove, isOwnOrg, newId, rankBetween, settableStatus, todayIn, type Project } from "@1neon/domain";
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
export function replayKey(s: string): string {
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

  /** Keep a locked copy of a signed record; the table is the source, so a failed copy is logged, not fatal */
  async function keep(key: string, record: unknown) {
    try { await k.d.records?.put(key, record); } catch (e) { console.error(JSON.stringify({ level: "error", message: "record copy failed", key, error: String(e) })); }
  }

  /** Logged hours change only in neon1's hands, and only until an issued invoice bills them */
  async function timeOpen(c: Context<Env>, p: Project, item: Item) {
    if (!who(c).actor.operator) fail(403, "neon1_only", "Hours are logged by neon1.");
    const on = item.fields.invoiceId ? await repo.getItem(p.tenantId, p.id, String(item.fields.invoiceId)) : undefined;
    if (on && on.status !== "void") fail(400, "immutable", `These hours are on ${String(on.fields.number ?? "an issued invoice")} and stay as billed. Correct them with a credit.`);
  }

  // Layer items (Needs, Execute, Observe, Normalize)

  app.post("/t/:tid/projects/:pid/items", async (c) => {
    const p = await project(c);
    const input = await body(c, CreateItemInput);
    // Anyone who can read may submit a request (intake); everything else needs write
    need(c, input.kind === "request" ? "comment" : "write");
    if (input.kind === "decision") fail(400, "invalid", "Decisions are recorded by approving an option.");
    if (input.kind === "proposal") fail(400, "invalid", "Proposal revisions are made by issuing the proposal.");
    if (input.kind === "invoice" || input.kind === "payment") fail(400, "invalid", "Invoices and payments are made through Billing.");
    // Agreements and acceptances are recorded by their own routes, by the people allowed to give them
    if (input.kind === "purchase" || input.kind === "handoff") { delete input.fields.agreed; delete input.fields.accepted; }
    // Options are neon1's proposals: neon1 writes, shares, and withdraws them; the client approves one
    if (input.kind === "option" && !who(c).actor.operator) fail(403, "neon1_only", "Options are proposed by neon1. Add a request instead, and they'll come back as options.");
    // Hours are neon1's own record of its work; which invoice bills them is set only by issuing one
    if (input.kind === "time") {
      if (!who(c).actor.operator) fail(403, "neon1_only", "Hours are logged by neon1.");
      delete input.fields.invoiceId;
    }
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
      // Logged hours are work already done, so they never count as something still open
      status: input.status ?? (input.kind === "option" ? "draft" : input.kind === "time" ? "done" : "open"),
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
    if (item.kind === "invoice" || item.kind === "payment") fail(400, "immutable", "Invoices and payments change only through Billing.");
    if (item.kind === "option" && !who(c).actor.operator) fail(403, "neon1_only", "Options are proposed by neon1. Comment on the option to ask for a change.");
    if (item.kind === "time") await timeOpen(c, p, item);
    const input = await body(c, UpdateItemInput);
    if (item.kind === "time" && input.fields) delete input.fields.invoiceId;
    // Agreements and acceptances only come from their routes; an edit keeps whatever was recorded
    if (input.fields) { delete input.fields.agreed; delete input.fields.accepted; }
    // An approved option is part of a decision's record: its terms and status don't change. A revised
    // proposal is a new option, approved on its own
    if (item.status === "approved" && (input.title !== undefined || input.body !== undefined || input.fields !== undefined)) fail(400, "immutable", "This option is approved. Propose a new option to change its terms.");
    // Statuses follow each kind's list; an approval is final and only the approve route grants it
    if (input.status !== undefined && input.status !== item.status) {
      if (item.status === "approved") fail(400, "immutable", "This option is approved. Propose a new option to change course.");
      // A signed acceptance is a record: the step it accepted stays done
      if (item.kind === "handoff" && item.fields.accepted) fail(400, "immutable", "This step was accepted and signed, so it stays done. Add a new step if something needs doing again.");
      if (!settableStatus(item.kind, input.status)) fail(400, "invalid_status", `"${input.status}" isn't a status for this kind of item.`);
    }
    if (input.assigneeId) await activeMembers(p.tenantId, [input.assigneeId]);
    const { version, assigneeId, dueDate, fields, ...patch } = input;
    const next: Item = { ...item, ...defined(patch), version: item.version + 1, updatedAt: now(), updatedBy: actorId(c) };
    if (assigneeId !== undefined) next.assigneeId = assigneeId ?? undefined;
    if (dueDate !== undefined) next.dueDate = dueDate ?? undefined;
    if (fields) {
      // Sent fields replace what was there; a field sent as null is cleared
      const merged: Record<string, unknown> = { ...item.fields, ...fields };
      for (const [key, value] of Object.entries(fields)) if (value === null) delete merged[key];
      next.fields = validateFields(item.kind, merged);
    }
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
    // Payments and issued invoices are records; only neon1's own unissued draft may go
    if (item.kind === "payment" || (item.kind === "invoice" && item.status !== "draft")) fail(400, "immutable", "Issued invoices and payments are kept as a permanent record. Void it with a reason, or issue a credit.");
    if (item.kind === "invoice" && !who(c).actor.operator) fail(403, "neon1_only", "Invoices are drafted by neon1.");
    if (item.status === "approved") fail(400, "immutable", "An approved option is part of a decision's record and stays.");
    if (item.kind === "option" && !who(c).actor.operator) fail(403, "neon1_only", "Options are proposed by neon1. Comment on the option to ask for a change.");
    if (item.kind === "time") await timeOpen(c, p, item);
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
    const items = await repo.listItems(p.tenantId, p.id);
    // Changing course: the decision in force is replaced by this one. An option an earlier change
    // replaced can be chosen again; the one in force can't be approved twice
    const current = currentDecision(items);
    const again = option.status === "approved" && current !== undefined && current.fields.optionId !== option.id;
    if (option.status !== "proposed" && !again) fail(409, "not_proposed", option.status === "approved" ? "This option is already approved." : "Only an option shared for approval can be approved.");
    const input = await body(c, ApproveInput);
    if (input.version !== option.version) fail(409, "conflict", "The option changed since you read it. Review it again before approving.", option);
    // Once the handover is accepted the work is finished, and the decision it finished stays
    if (current && items.some((i) => i.kind === "handoff" && i.fields.accepted)) fail(409, "handover_accepted", "The handover was accepted, so this project's work is finished and its decision stays. Ask neon1 to start a new project for more work.");
    // A change says why, in the decision maker's words; it's signed and kept with the new decision
    if (current && input.reason.length < 3) fail(400, "reason_required", "Say why you're changing the decision. It's kept with the new one, so everyone can see what changed and why.");
    // The revision it's approved from: the latest issued one, which must hold this exact version
    const rev = revisions(items).at(-1);
    if (!rev) fail(409, "not_issued", "neon1 hasn't issued this proposal yet. Options can be approved once it is.");
    const snap = rev.p.snapshot.options.find((o) => o.id === option.id);
    if (!snap) fail(409, "not_in_revision", `This option isn't part of Proposal ${proposalRef(rev.p.number, rev.p.rev)}. Ask neon1 to issue the next revision.`);
    if (snap.version !== option.version) fail(409, "changed_since_issue", `This option changed after Proposal ${proposalRef(rev.p.number, rev.p.rev)} was issued. neon1 issues the next revision before it can be approved.`);
    if (priceCheckDue(rev.p, todayIn(c.get("tenant").timeZone))) fail(409, "price_check", `The prices in Proposal ${proposalRef(rev.p.number, rev.p.rev)} were checked over ${PRICE_CHECK_DAYS} days ago. Ask neon1 to refresh it, then approve.`);
    // A client signs neon1's service agreement (the current edition) before approving paid work
    const tenant = c.get("tenant");
    if (!isOwnOrg(tenant.slug) && !(tenant.agreements ?? []).some((a) => a.ref === AGREEMENT_EDITION)) fail(409, "agreement_needed", `Sign neon1's service agreement (edition ${AGREEMENT_EDITION}) first. It covers every project, and you sign it once.`);
    const of = OptionFields.parse(option.fields);
    const neon1Buys = of.purchases.filter((x) => x.buyer === "neon1");
    const ts = now();
    const by = actorId(c);
    const approver = who(c).user;
    // The terms exactly as approved travel with the decision, so it never depends on the option later
    const terms = { title: option.title, body: option.body, cost: of.cost, timeline: of.timeline, hours: of.hours || undefined, outsideCosts: of.outsideCosts || undefined, result: of.result || undefined, costScore: of.costScore, qualityScore: of.qualityScore, effortScore: of.effortScore, recommended: of.recommended, purchases: of.purchases.length ? of.purchases : undefined, pricing: of.pricing, rateCents: of.rateCents, hoursLow: of.hoursLow, hoursHigh: of.hoursHigh, basis: of.basis?.length ? of.basis : undefined };
    const earlier = items.filter((i) => i.kind === "decision").map((i) => i.id);
    const name = approver.name || approver.email;
    // The approver signs this option ID over a hash of exactly what they agreed to; when neon1 buys
    // items, the same signature agrees to pay them back at cost, and its initials go on each purchase
    const changed = current ? { replaces: current.id, reason: input.reason } : {};
    const signed = signature("approval", snap.code, await sha256Hex(canonical({ code: snap.code, proposal: rev.title, terms, conditions: input.conditions, ...changed })), input.signature, { id: by, name, email: approver.email }, ts, from(c));
    const initials = input.initials || initialsOf(input.signature.typedName);
    const decision = Item.parse({
      tenantId: p.tenantId,
      projectId: p.id,
      id: newId("i"),
      kind: "decision",
      title: `Approved: ${option.title}`,
      body: input.conditions,
      status: "approved",
      rank: ts,
      fields: DecisionFields.parse({ optionId: option.id, optionVersion: option.version, approvedBy: by, approvedAt: ts, conditions: input.conditions, terms, approverName: approver.name || undefined, approverEmail: approver.email, supersedes: earlier.length ? earlier : undefined, reason: current ? input.reason : undefined, proposalId: rev.id, code: snap.code, initials: neon1Buys.length ? initials : undefined, signature: signed }),
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
        fields: PurchaseFields.parse({ estimate: x.estimate, why: x.why, example: x.example, buyer: x.buyer, from: snap.code, agreed: x.buyer === "neon1" ? { by, name, initials, at: ts } : undefined }),
        version: 1, createdAt: ts, updatedAt: ts, updatedBy: by,
      });
    });
    // A change drops neon1's unissued deposit drafts for the decision it replaces: nobody was asked
    // for that money, and the new deposit takes their place
    const replaced = current ? lineage(current, items) : new Set<string>();
    const stale = items.filter((i) => i.kind === "invoice" && i.status === "draft" && i.fields.type === "deposit" && InvoiceFields.parse(i.fields).lines.some((l) => replaced.has(l.ref ?? "")));
    const kept = items.filter((i) => !stale.includes(i));
    // A price in numbers (fixed, or an hourly estimate) asks for a deposit: neon1 gets a draft to check
    // and issue, never sent on its own. After a change, what was invoiced for the earlier decision
    // counts toward it, so the draft asks only for the difference, or nothing
    const deposit = priceOf(of) ? draftInvoice(p, "deposit", depositLines(decision, undefined, [...kept, decision]), ts, by) : undefined;
    const was = current && (current.fields.code ? `${String(current.fields.code)} ` : "") + current.title.replace(/^Approved: /, "");
    await repo.table.write([
      repo.itemOp(approved, { version: option.version }),
      repo.itemOp(decision, { create: true }),
      ...buys.map((b) => repo.itemOp(b, { create: true })),
      ...stale.map((i) => ({ delete: keys.item(p.tenantId, p.id, i.id), guard: { version: i.version } })),
      ...(deposit ? [repo.itemOp(deposit, { create: true })] : []),
      current
        ? repo.auditOp({ tenantId: p.tenantId, actorId: by, action: "decision.changed", target: decision.id, summary: `${p.key}: changed the decision from ${was} to ${snap.code} "${option.title}" (version ${option.version}), signed by ${input.signature.typedName}. Why: ${input.reason}` })
        : repo.auditOp({ tenantId: p.tenantId, actorId: by, action: "decision.approved", target: decision.id, summary: `${p.key}: approved ${snap.code} "${option.title}" (version ${option.version}), signed by ${input.signature.typedName}` }),
    ]);
    await keep(`t/${p.tenantId}/p/${p.id}/decisions/${decision.id}.json`, decision);
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
    const signed = signature("acceptance", it.title, await sha256Hex(canonical({ id: it.id, version: it.version, title: it.title, body: it.body, note: input.note })), input.signature, { id: by, name: u.name || u.email, email: u.email }, ts, from(c));
    const next: Item = { ...it, status: "done", completedAt: completionAfter(it, "done", ts), fields: { ...it.fields, accepted: { by, name: u.name || u.email, at: ts, note: input.note, signature: signed } }, version: it.version + 1, updatedAt: ts, updatedBy: by };
    // The last handover step accepted: neon1 gets a draft of the final invoice for what's left on the price
    const items = await repo.listItems(p.tenantId, p.id);
    const steps = items.filter((i) => i.kind === "handoff").map((i) => (i.id === it.id ? next : i));
    const decision = currentDecision(items);
    const hasFinal = items.some((i) => i.kind === "invoice" && i.status !== "void" && i.fields.type === "final");
    const final = steps.every((i) => i.status === "done") && decision && !hasFinal ? closingDraft(p, decision, items, ts, by) : undefined;
    await repo.table.write([repo.itemOp(next, { version: it.version }), ...(final ? [repo.itemOp(final, { create: true })] : []), repo.auditOp({ tenantId: p.tenantId, actorId: by, action: "handoff.accepted", target: it.id, summary: `${p.key}: ${u.name || u.email} accepted "${it.title}"${input.note ? `: ${input.note}` : ""}, signed by ${input.signature.typedName}` })]);
    await keep(`t/${p.tenantId}/p/${p.id}/acceptances/${it.id}-v${next.version}.json`, next);
    return c.json(next);
  });

  /**
   * Accept the whole handover with one signature: every step that's done and not yet accepted. Each
   * step still gets its own signed record, over its own text, so one can be read without the others
   */
  app.post("/t/:tid/projects/:pid/handover/accept", async (c) => {
    const p = await project(c);
    check(canApprove(who(c).actor, c.get("access"), p.people, isOwnOrg(c.get("tenant").slug)));
    const input = await body(c, AcceptInput.omit({ version: true }));
    const items = await repo.listItems(p.tenantId, p.id);
    const steps = items.filter((i) => i.kind === "handoff");
    const open = steps.filter((i) => i.status !== "done");
    if (open.length) fail(409, "not_done", `${open.length === 1 ? "One step isn't" : `${open.length} steps aren't`} done yet. Accept the finished ones one by one, or come back when every step is done.`);
    const waiting = steps.filter((i) => !i.fields.accepted);
    if (!waiting.length) fail(409, "nothing_to_accept", "Every handover step is already accepted.");
    const u = who(c).user;
    const ts = now();
    const by = actorId(c);
    const name = u.name || u.email;
    const accepted: Item[] = [];
    for (const it of waiting) {
      const signed = signature("acceptance", it.title, await sha256Hex(canonical({ id: it.id, version: it.version, title: it.title, body: it.body, note: input.note })), input.signature, { id: by, name, email: u.email }, ts, from(c));
      accepted.push({ ...it, fields: { ...it.fields, accepted: { by, name, at: ts, note: input.note, signature: signed } }, version: it.version + 1, updatedAt: ts, updatedBy: by });
    }
    // With the handover accepted, neon1 gets a draft of the final invoice for what's left on the price
    const decision = currentDecision(items);
    const hasFinal = items.some((i) => i.kind === "invoice" && i.status !== "void" && i.fields.type === "final");
    const final = decision && !hasFinal ? closingDraft(p, decision, items, ts, by) : undefined;
    await repo.table.write([
      ...accepted.map((next, n) => repo.itemOp(next, { version: waiting[n]!.version })),
      ...(final ? [repo.itemOp(final, { create: true })] : []),
      repo.auditOp({ tenantId: p.tenantId, actorId: by, action: "handoff.accepted", target: accepted[0]!.id, summary: `${p.key}: ${name} accepted the handover (${accepted.length} ${accepted.length === 1 ? "step" : "steps"})${input.note ? `: ${input.note}` : ""}, signed by ${input.signature.typedName}` }),
    ]);
    for (const next of accepted) await keep(`t/${p.tenantId}/p/${p.id}/acceptances/${next.id}-v${next.version}.json`, next);
    return c.json({ accepted, final: Boolean(final) });
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


/** Where a signature came from, for its audit trail */
export function from(c: Context<Env>) {
  return { ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim(), ua: c.req.header("user-agent") };
}

/** The project's current decision: the latest approval no later decision replaced */
export function currentDecision<T extends Pick<Item, "kind" | "id" | "fields" | "createdAt">>(items: T[]): T | undefined {
  const decisions = items.filter((i) => i.kind === "decision");
  const replaced = new Set(decisions.flatMap((d) => (d.fields.supersedes as string[] | undefined) ?? []));
  return decisions.filter((d) => !replaced.has(d.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** A draft invoice for neon1 to check and issue; none when there is nothing to bill */
/**
 * What neon1 gets a draft of when a handover is accepted: the final invoice for what's left on the
 * price or, when the work came to less than what was invoiced (an estimate's hours under the deposit,
 * or a change to a smaller option), the credit that refunds the difference, as the service agreement
 * promises. Nothing when the work is already billed in full
 */
function closingDraft(p: Project, decision: Item, items: Item[], ts: string, by: string): Item | undefined {
  const final = draftInvoice(p, "final", finalLines(decision, items), ts, by);
  if (final) return final;
  const back = refundCredit(decision, items);
  return back && draftInvoice(p, "credit", back.lines, ts, by, { appliesTo: back.appliesTo, note: back.note });
}

export function draftInvoice(p: Project, type: "deposit" | "final" | "progress" | "reimbursement" | "retainer" | "credit", lines: InvoiceFields["lines"], ts: string, by: string, extra: Partial<InvoiceFields> = {}): Item | undefined {
  if (!lines.length) return undefined;
  const names = { deposit: "Deposit", final: "Final invoice", progress: "Progress invoice", reimbursement: "Purchases at cost", retainer: "Care plan", credit: "Credit" } as const;
  return Item.parse({
    tenantId: p.tenantId, projectId: p.id, id: newId("i"), kind: "invoice", title: names[type], body: "", status: "draft", rank: ts,
    fields: InvoiceFields.parse({ type, lines, ...extra }),
    version: 1, createdAt: ts, updatedAt: ts, updatedBy: by,
  });
}
