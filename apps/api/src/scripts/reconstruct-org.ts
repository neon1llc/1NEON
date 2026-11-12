// apps/api/src/scripts/reconstruct-org.ts - Rebuild past organizations from notes, when the original
// records are gone. Each organization carries a provenance note shown on every page; its people are
// kept on file only (no account can be made for them, and nothing is ever sent to them); its projects
// sit in the closing stage (or where an ongoing one stands) with their layers filled from the notes.
//
// Usage: TABLE_NAME=1neon-prod npx tsx src/scripts/reconstruct-org.ts <records.json> [--write]
// Without --write it only prints what it would create. The JSON stays private: never commit one.
//
// Safe to run again: an organization whose slug exists is skipped whole.


import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  DEFAULT_STAGES,
  ItemKind,
  ProjectRole,
  AccessLevel,
  email,
  formatClientId,
  itemFields,
  newId,
  rankBetween,
  Item as ItemSchema,
  Member as MemberSchema,
  Project as ProjectSchema,
  Tenant as TenantSchema,
  type Item,
  type Member,
  type Project,
  type Tenant,
} from "@1neon/domain";
import { DynamoTable } from "../store/dynamo.ts";
import { Repo } from "../store/repo.ts";


// --- Input: the private records file -----------------------------------------

const Person = z.object({ email, name: z.string().max(80), title: z.string().max(80).default(""), access: AccessLevel.default("viewer") });
const InItem = z.object({
  kind: ItemKind,
  title: z.string().min(1).max(160),
  body: z.string().max(20_000).default(""),
  status: z.string().max(24).default("done"),
  fields: z.record(z.string(), z.unknown()).default({}),
});
const InProject = z.object({
  prefix: z.string().regex(/^[A-Z][A-Z0-9]{1,5}$/),
  name: z.string().min(1).max(120),
  summary: z.string().max(500).default(""),
  outcome: z.string().max(500).default(""),
  // Where the project stands; past work sits in Closed, an engagement still going sits where it is
  stage: z.enum(DEFAULT_STAGES.map((s) => s.id) as [string, ...string[]]).default("closed"),
  people: z.array(z.object({ email, role: ProjectRole })).default([]),
  items: z.array(InItem).default([]),
});
const InOrg = z.object({
  slug: z.string(),
  name: z.string(),
  clientId: z.string().regex(/^N1-\d{4}$/).optional(),
  people: z.array(Person).default([]),
  projects: z.array(InProject).default([]),
});
const Records = z.object({
  // Where the notes came from, in words, and the person who kept them (joins each org as its lead)
  source: z.string().min(1).max(200),
  lead: email,
  orgs: z.array(InOrg).min(1),
});


// --- Arguments ---------------------------------------------------------------

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const write = args.includes("--write");
if (!file || !process.env.TABLE_NAME) {
  console.error("Usage: TABLE_NAME=... tsx src/scripts/reconstruct-org.ts <records.json> [--write]");
  process.exit(1);
}
const input = Records.parse(JSON.parse(readFileSync(file, "utf8")));
const repo = new Repo(new DynamoTable(process.env.TABLE_NAME));
const now = new Date().toISOString();
const today = now.slice(0, 10);
const actor = "script";
const say = (s: string) => console.log(`${write ? "" : "[dry run] "}${s}`);


// The lead must already have an account (the operator); they join each org as an admin
const leadId = await repo.userIdForEmail(input.lead);
if (!leadId) throw new Error(`No user for ${input.lead}; run bootstrap first`);
const tenants = await repo.listTenants();


for (const o of input.orgs) {
  if (await repo.tenantIdForSlug(o.slug)) {
    say(`skip ${o.slug}: already exists`);
    continue;
  }
  if (o.clientId && tenants.some((t) => t.clientId === o.clientId)) throw new Error(`${o.clientId} is taken`);
  const clientId = o.clientId ?? (write ? formatClientId(await repo.nextClientNumber()) : "N1-next");
  const note = `Reconstructed on ${today} from Pradeep's project notes. The original records were lost, so details may differ from what happened.`;
  const t: Tenant = TenantSchema.parse({
    id: newId("t"), slug: o.slug, clientId: write ? clientId : "N1-0000", name: o.name, status: "active", stages: DEFAULT_STAGES,
    provenance: { kind: "reconstructed", source: input.source, at: today, note },
    version: 1, createdAt: now, updatedAt: now, updatedBy: actor,
  });
  say(`org ${t.name} (${clientId}) at ${t.slug}`);
  if (write) {
    await repo.createTenant(t);
    await repo.table.write([repo.auditOp({ tenantId: t.id, actorId: actor, action: "org.reconstructed", target: t.id, summary: `Reconstructed ${t.name} from ${input.source}` })]);
  }

  // People: the lead as a joined admin; everyone else on file, with a record-only user if they're new
  const ids = new Map<string, string>([[input.lead, leadId]]);
  const lead: Member = MemberSchema.parse({ tenantId: t.id, userId: leadId, email: input.lead, name: "", title: "", access: "admin", status: "joined", invitedBy: actor, invitedAt: now, joinedAt: now, version: 1, createdAt: now, updatedAt: now, updatedBy: actor });
  if (write) await repo.saveMember(lead, { create: true });
  for (const p of o.people) {
    let uid = await repo.userIdForEmail(p.email);
    if (!uid) {
      uid = newId("u");
      if (write) await repo.createUser({ id: uid, email: p.email, name: p.name, title: p.title, phone: "", operator: false, strongAuth: false, theme: "awake", menu: "default", recordOnly: true, version: 1, createdAt: now, updatedAt: now, updatedBy: actor });
    }
    ids.set(p.email, uid);
    const m: Member = MemberSchema.parse({ tenantId: t.id, userId: uid, email: p.email, name: p.name, title: p.title, access: p.access, status: "on_file", invitedBy: actor, invitedAt: now, version: 1, createdAt: now, updatedAt: now, updatedBy: actor });
    say(`  person ${p.name} <${p.email}> ${p.title ? `(${p.title}) ` : ""}${p.access}, on file`);
    if (write) await repo.saveMember(m, { create: true });
  }

  // Projects in their stage, ranked in the order given, with their items
  let rank = "";
  for (const [n, ip] of o.projects.entries()) {
    rank = rankBetween(rank, "");
    const people = ip.people.map((x) => {
      const uid = ids.get(x.email);
      if (!uid) throw new Error(`${x.email} is on ${ip.name} but not in ${o.name}'s people`);
      return { userId: uid, role: x.role };
    });
    if (!people.some((x) => x.userId === leadId)) people.unshift({ userId: leadId, role: "lead_engineer" });
    const num = write ? await repo.nextProjectNumber(t.id, ip.prefix) : n + 1;
    const p: Project = ProjectSchema.parse({
      tenantId: t.id, id: newId("p"), key: `${ip.prefix}-${num}`, name: ip.name, summary: ip.summary, outcome: ip.outcome, template: "blank",
      stageId: ip.stage, stageEnteredAt: now, health: "not_started", rank, people, flags: [], archived: false,
      version: 1, createdAt: now, updatedAt: now, updatedBy: actor,
    });
    say(`  project ${p.key} ${p.name} [${ip.stage}]: ${people.length} people, ${ip.items.length} items`);
    if (write) await repo.saveProject(p, { create: true });
    let irank = "";
    for (const ii of ip.items) {
      irank = rankBetween(irank, "");
      const schema = itemFields[ii.kind];
      const fields = schema ? (schema.parse(ii.fields) as Record<string, unknown>) : ii.fields;
      const i: Item = ItemSchema.parse({ tenantId: t.id, projectId: p.id, id: newId("i"), kind: ii.kind, title: ii.title, body: ii.body, status: ii.status, rank: irank, fields, version: 1, createdAt: now, updatedAt: now, updatedBy: actor });
      say(`    ${i.kind}: ${i.title}`);
      if (write) await repo.saveItem(i, { create: true });
    }
  }
}
say("done");
