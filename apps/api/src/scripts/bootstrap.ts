// apps/api/src/scripts/bootstrap.ts - One-time production bootstrap: the operator's account and the
// neon1 organization (N1-0001).
// Usage: TABLE_NAME=1neon-prod USER_POOL_ID=us-east-1_xxx npx tsx src/scripts/bootstrap.ts you@example.com "Your Name"
//
// Safe to run again: anything that already exists is left as it is.


import { DEFAULT_STAGES, formatClientId, newId, type Member, type Tenant } from "@1neon/domain";
import { CognitoDirectory } from "../services.ts";
import { DynamoTable } from "../store/dynamo.ts";
import { Repo } from "../store/repo.ts";


// Both AWS names come from the environment; the email and name from the command line
const [email, name = ""] = process.argv.slice(2);
if (!email || !process.env.TABLE_NAME || !process.env.USER_POOL_ID) {
  console.error("Usage: TABLE_NAME=... USER_POOL_ID=... tsx src/scripts/bootstrap.ts <email> [name]");
  process.exit(1);
}
const repo = new Repo(new DynamoTable(process.env.TABLE_NAME));
const now = new Date().toISOString();


// The operator's user record; the operator role itself comes from OPERATOR_EMAILS, not from here
let uid = await repo.userIdForEmail(email);
if (!uid) {
  uid = newId("u");
  await repo.createUser({ id: uid, email: email.toLowerCase(), name, title: "", phone: "", operator: false, strongAuth: false, theme: "awake", menu: "default", version: 1, createdAt: now, updatedAt: now, updatedBy: uid });
  console.log(`created user ${email}`);
}


// The Cognito account, so the first email-code sign-in works
await new CognitoDirectory(process.env.USER_POOL_ID).ensureUser(email.toLowerCase());


// neon1 itself as the first organization, with the operator as its admin
if ((await repo.listTenants()).length === 0) {
  const t: Tenant = { id: newId("t"), slug: "neon1", clientId: formatClientId(await repo.nextClientNumber()), name: "neon1", status: "active", stages: DEFAULT_STAGES, version: 1, createdAt: now, updatedAt: now, updatedBy: uid };
  await repo.createTenant(t);
  const m: Member = { tenantId: t.id, userId: uid, email: email.toLowerCase(), name, title: "", access: "admin", status: "invited", invitedBy: uid, invitedAt: now, version: 1, createdAt: now, updatedAt: now, updatedBy: uid };
  await repo.saveMember(m, { create: true });
  console.log(`created organization ${t.name} (${t.clientId})`);
}
console.log("bootstrap done");
