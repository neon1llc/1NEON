// apps/api/src/seed.ts - Demo data for local development and screenshots: neon1 itself plus two
// sample clients.


import { DEFAULT_STAGES, Item, formatClientId, newId, rankBetween, type Member, type Project, type Tenant, type User } from "@1neon/domain";
import type { Repo } from "./store/repo.ts";


// ISO timestamp `offset` days from now, so demo data always looks recent
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();


/** Fill an empty store with demo people, organizations, and projects. Returns them for tests */
export async function seed(repo: Repo, operatorEmail = "pradeep@neon1.tech") {
  const t0 = day(-30);
  // A demo person; `strong` stands in for a passkey or authenticator app
  const user = (email: string, name: string, title: string, strong = false): User => ({
    id: newId("u"), email, name, title, phone: "", operator: false, strongAuth: strong, theme: "awake", menu: "rail", version: 1, createdAt: t0, updatedAt: t0, updatedBy: "seed",
  });
  // People: the operator, an Acme admin and editor, and a Harbor contact who hasn't joined yet
  const pradeep = user(operatorEmail, "Pradeep", "Lead engineer", true);
  const dana = user("dana@acmedental.example", "Dana Kim", "Office manager");
  const raj = user("raj@acmedental.example", "Raj Patel", "Practice owner", true);
  const lee = user("lee@harborauto.example", "Lee Moreno", "Operations lead");
  for (const u of [pradeep, dana, raj, lee]) await repo.createUser(u);

  // Organizations: neon1 itself (N1-0001) and two sample clients
  const org = async (name: string, slug: string): Promise<Tenant> => {
    const n = await repo.nextClientNumber();
    const t: Tenant = { id: newId("t"), slug, clientId: formatClientId(n), name, status: "active", stages: DEFAULT_STAGES, version: 1, createdAt: t0, updatedAt: t0, updatedBy: pradeep.id };
    await repo.createTenant(t);
    return t;
  };
  const neon1 = await org("neon1", "neon1");
  const acme = await org("Acme Dental", "acme-dental");
  const harbor = await org("Harbor Auto Group", "harbor-auto");

  // Memberships, including one still invited
  const member = async (t: Tenant, u: User, access: Member["access"], status: Member["status"] = "joined") => {
    const m: Member = { tenantId: t.id, userId: u.id, email: u.email, name: u.name, title: u.title, access, status, invitedBy: pradeep.id, invitedAt: t0, joinedAt: status === "joined" ? day(-20) : undefined, lastSeenAt: status === "joined" ? day(-1) : undefined, version: 1, createdAt: t0, updatedAt: t0, updatedBy: pradeep.id };
    await repo.saveMember(m, { create: true });
  };
  await member(neon1, pradeep, "admin");
  await member(acme, pradeep, "admin");
  await member(acme, raj, "admin");
  await member(acme, dana, "editor");
  await member(harbor, pradeep, "admin");
  await member(harbor, lee, "admin", "invited");

  let rank = "";
  // Project and item helpers with ranks appended in creation order
  const project = async (t: Tenant, key: string, name: string, stageId: string, health: Project["health"], summary: string, people: Project["people"], daysInStage: number) => {
    rank = rankBetween(rank, "");
    const p: Project = { tenantId: t.id, id: newId("p"), key, name, summary, outcome: "", template: "blank", stageId, stageEnteredAt: day(-daysInStage), health, rank, people, flags: [], archived: false, version: 1, createdAt: t0, updatedAt: day(-daysInStage), updatedBy: pradeep.id, targetDate: day(30).slice(0, 10) };
    await repo.saveProject(p, { create: true });
    await repo.table.write([repo.auditOp({ tenantId: t.id, actorId: pradeep.id, action: "project.created", target: p.id, summary: `Created ${key} ${name}` })]);
    return p;
  };
  let irank = "";
  // A layer item ranked after the last one, so items appear in creation order
  const item = async (p: Project, kind: Item["kind"], title: string, extra: Partial<Item> = {}) => {
    irank = rankBetween(irank, "");
    const i = Item.parse({ tenantId: p.tenantId, projectId: p.id, id: newId("i"), kind, title, body: "", status: "open", rank: irank, fields: {}, version: 1, createdAt: t0, updatedAt: t0, updatedBy: pradeep.id, ...extra });
    await repo.saveItem(i, { create: true });
    return i;
  };

  // Acme: a project at Decide with three options to approve, and measures with baselines
  const intake = await project(acme, "FLOW-1", "Patient intake out of the shared inbox", "decide", "on_track", "Intake runs through one email inbox; staff chase missing documents and retype them into the patient record.", [{ userId: pradeep.id, role: "lead_engineer" }, { userId: raj.id, role: "decision_maker" }, { userId: dana.id, role: "tech_contact" }], 4);
  await item(intake, "discovery", "One real example of how it works today", { status: "done", body: "A new patient emails a photo of their insurance card. Dana saves it, types the details into the record, and replies asking for the missing ID." });
  await item(intake, "requirement", "Patients upload once; nothing is retyped", { fields: { priority: "must" } });
  await item(intake, "requirement", "Staff see at a glance what's complete", { fields: { priority: "should" } });
  await item(intake, "option", "A. Tidy the inbox: rules, templates, and a checklist", { status: "proposed", body: "Fastest, cheapest. Keeps email as the system.", fields: { cost: "$900 fixed", costScore: 5, qualityScore: 2, effortScore: 5, timeline: "1 week", recommended: false } });
  await item(intake, "option", "B. Small intake portal on AWS", { status: "proposed", body: "Patients upload once; the office sees status at a glance. Runs in your AWS account.", fields: { cost: "$6,500 fixed + ~$15/mo", costScore: 3, qualityScore: 5, effortScore: 3, timeline: "4 weeks", recommended: true } });
  await item(intake, "option", "C. Practice-management add-on", { status: "proposed", body: "Vendor module; less control, monthly per-seat fee.", fields: { cost: "$0 setup + $240/mo", costScore: 3, qualityScore: 3, effortScore: 4, timeline: "2 weeks", recommended: false } });
  await item(intake, "metric", "Intake turnaround", { fields: { category: "performance", unit: "hours", direction: "down", baseline: 62, baselineDate: day(-25).slice(0, 10), target: 4, readings: [] } });
  await item(intake, "metric", "Staff minutes per intake", { fields: { category: "performance", unit: "min", direction: "down", baseline: 24, baselineDate: day(-25).slice(0, 10), target: 8, readings: [] } });
  await item(intake, "file_request", "Upload a blank copy of the current intake form", { assigneeId: dana.id });
  await item(intake, "handoff", "Accounts are in the client's name");

  // Acme: work in progress, at risk
  const backup = await project(acme, "SEC-1", "Backups that restore", "build", "at_risk", "Nightly backups exist but have never been restored.", [{ userId: pradeep.id, role: "lead_engineer" }, { userId: dana.id, role: "tech_contact" }], 9);
  await item(backup, "task", "Inventory what's backed up today", { status: "done" });
  await item(backup, "task", "Restore last night's backup to a test machine", { status: "doing", assigneeId: pradeep.id });
  await item(backup, "update", "Restore test blocked on vendor login", { fields: { health: "at_risk" } });
  await item(backup, "metric", "Days since last successful restore test", { fields: { category: "reliability", unit: "days", direction: "down", baseline: 900, target: 30, readings: [{ at: day(-2).slice(0, 10), value: 900, note: "" }] } });

  await project(acme, "AI-1", "Answers from our own policies", "listen", "not_started", "Staff interrupt Raj for policy questions.", [{ userId: pradeep.id, role: "lead_engineer" }], 2);
  // Harbor: a migration in Verify with real readings, plus a new intake
  const mig = await project(harbor, "MIG-1", "Two offices off local servers", "verify", "on_track", "The application, database, and files lived on two local servers.", [{ userId: pradeep.id, role: "lead_engineer" }, { userId: lee.id, role: "tech_contact" }], 6);
  await item(mig, "metric", "Monthly infrastructure cost", { fields: { category: "cost", unit: "$", direction: "down", baseline: 1450, target: 600, readings: [{ at: day(-20).slice(0, 10), value: 1450, note: "" }, { at: day(-5).slice(0, 10), value: 690, note: "first full month on AWS" }] } });
  await item(mig, "check", "Backups restored once as a test", { status: "done" });
  await project(harbor, "NET-1", "Guest Wi-Fi separated from the shop network", "intake", "not_started", "", [], 1);
  await project(neon1, "PRJ-1", "Build 1NEON", "build", "on_track", "The neon1 client portal, built in the open with ourselves as the first client.", [{ userId: pradeep.id, role: "lead_engineer" }], 1);

  return { pradeep, dana, raj, lee, neon1, acme, harbor };
}
