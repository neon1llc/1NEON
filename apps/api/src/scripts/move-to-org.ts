// apps/api/src/scripts/move-to-org.ts - Create an organization with a chosen client ID (for example a
// demo at N1-9999) if it's missing, then move people into it from another organization. Their
// membership in the old organization is deactivated, never deleted, and both sides get audit entries.
// Usage: TABLE_NAME=1neon-prod npx tsx src/scripts/move-to-org.ts <from-slug> <to-slug> "<To name>" <client-id> <email>...
//
// Safe to run again: an existing organization or membership is left as it is.


import { DEFAULT_STAGES, newId, type Member, type Tenant } from "@1neon/domain";
import { DynamoTable } from "../store/dynamo.ts";
import { Repo } from "../store/repo.ts";


// Arguments: where people come from, where they go, and who
const [fromSlug, toSlug, toName, clientId, ...emails] = process.argv.slice(2);
if (!process.env.TABLE_NAME || !fromSlug || !toSlug || !toName || !/^N1-\d{4}$/.test(clientId ?? "") || !emails.length) {
  console.error('Usage: TABLE_NAME=... tsx src/scripts/move-to-org.ts <from-slug> <to-slug> "<To name>" <N1-9999> <email>...');
  process.exit(1);
}
const repo = new Repo(new DynamoTable(process.env.TABLE_NAME));
const now = new Date().toISOString();
const actor = "script";


// The source organization must exist; the target is created on first run
const fromId = await repo.tenantIdForSlug(fromSlug);
if (!fromId) throw new Error(`No organization at ${fromSlug}`);
let toId = await repo.tenantIdForSlug(toSlug);
if (!toId) {
  // The chosen client ID must not belong to another organization
  if ((await repo.listTenants()).some((t) => t.clientId === clientId)) throw new Error(`${clientId} is taken`);
  const t: Tenant = { id: newId("t"), slug: toSlug, clientId: clientId!, name: toName!, status: "active", stages: DEFAULT_STAGES, version: 1, createdAt: now, updatedAt: now, updatedBy: actor };
  await repo.createTenant(t);
  await repo.table.write([repo.auditOp({ tenantId: t.id, actorId: actor, action: "org.created", target: t.id, summary: `Created ${t.name} (${t.clientId})` })]);
  toId = t.id;
  console.log(`created ${t.name} (${t.clientId})`);
}


// Each person: same access and join state in the new organization, deactivated in the old one
for (const raw of emails) {
  const email = raw.toLowerCase();
  const uid = await repo.userIdForEmail(email);
  const old = uid ? await repo.getMember(fromId, uid) : undefined;
  if (!uid || !old) {
    console.log(`skip ${email}: not in ${fromSlug}`);
    continue;
  }
  if (!(await repo.getMember(toId, uid))) {
    const m: Member = { ...old, tenantId: toId, version: 1, createdAt: now, updatedAt: now, updatedBy: actor };
    await repo.table.write([repo.memberOp(m, { create: true }), repo.auditOp({ tenantId: toId, actorId: actor, action: "member.invited", target: uid, summary: `Moved ${email} here from ${fromSlug} as ${old.access}` })]);
  }
  if (old.status !== "deactivated") {
    const off: Member = { ...old, status: "deactivated", version: old.version + 1, updatedAt: now, updatedBy: actor };
    await repo.table.write([repo.memberOp(off, { version: old.version }), repo.auditOp({ tenantId: fromId, actorId: actor, action: "member.updated", target: uid, summary: `Moved ${email} to ${toSlug}` })]);
  }
  console.log(`moved ${email}`);
}
console.log("done");
