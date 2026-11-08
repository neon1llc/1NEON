// apps/web/src/live/seed.ts - The live playback's starting point: neon1, and a new client, Maple
// Street Bakery, with its owner signed up and nothing else yet. The playback builds the rest.


import { DEFAULT_STAGES, formatClientId, newId, type Member, type Tenant, type User } from "@1neon/domain";
import type { Repo } from "../../../api/src/store/repo.ts";


// The people in the story, by email
export const PRADEEP = "pradeep@neon1.tech";
export const MARIA = "maria@maplestreetbakery.example";
export const SAM = "sam@maplestreetbakery.example";


/** neon1 and the bakery; Maria owns the bakery and has finished the welcome tour */
export async function liveSeed(repo: Repo) {
  const t0 = new Date(Date.now() - 86_400_000).toISOString();
  const user = (email: string, name: string, title: string): User => ({
    id: newId("u"), email, name, title, phone: "", operator: false, strongAuth: true, theme: "awake", menu: "rail", tour: "done", version: 1, createdAt: t0, updatedAt: t0, updatedBy: "seed",
  });
  const pradeep = user(PRADEEP, "Pradeep", "Lead engineer");
  const maria = user(MARIA, "Maria Lopez", "Owner");
  for (const u of [pradeep, maria]) await repo.createUser(u);
  // An organization with the default stages
  const org = async (name: string, slug: string): Promise<Tenant> => {
    const t: Tenant = { id: newId("t"), slug, clientId: formatClientId(await repo.nextClientNumber()), name, status: "active", stages: DEFAULT_STAGES, version: 1, createdAt: t0, updatedAt: t0, updatedBy: pradeep.id };
    await repo.createTenant(t);
    return t;
  };
  const neon1 = await org("neon1", "neon1");
  const bakery = await org("Maple Street Bakery", "maple-street");
  // Both of them are in the bakery; Maria is its admin
  const member = async (t: Tenant, u: User, access: Member["access"]) => {
    await repo.saveMember({ tenantId: t.id, userId: u.id, email: u.email, name: u.name, title: u.title, access, status: "joined", invitedBy: pradeep.id, invitedAt: t0, joinedAt: t0, lastSeenAt: new Date().toISOString(), seenAt: new Date().toISOString(), version: 1, createdAt: t0, updatedAt: t0, updatedBy: pradeep.id }, { create: true });
  };
  await member(neon1, pradeep, "admin");
  await member(bakery, pradeep, "admin");
  await member(bakery, maria, "admin");
}
