// apps/web/src/live/seed.ts - The live playback's starting point: neon1, and a new client, Maple
// Street Bakery. The whole project starts with Maria signed up and nothing else; each short demo
// starts where its one thing begins (an invitation waiting in her inbox, or her account with no
// second step yet).


import { DEFAULT_STAGES, formatClientId, newId, type Member, type Tenant, type User } from "@1neon/domain";
import { inviteEmail } from "../../../api/src/emails.ts";
import type { MemoryMailer } from "../../../api/src/local.ts";
import type { Repo } from "../../../api/src/store/repo.ts";
import type { LiveSession } from "./signin.ts";
import { PLAY } from "./where.ts";


// The people in the story, by email
export const PRADEEP = "pradeep@neon1.tech";
export const MARIA = "maria@maplestreetbakery.example";
export const SAM = "sam@maplestreetbakery.example";


/**
 * neon1 and the bakery. Returns the session a short demo starts with (Maria's, not yet confirmed),
 * or nothing for the whole project, which signs in by picking a person
 */
export async function liveSeed(repo: Repo, mailer: MemoryMailer): Promise<LiveSession | undefined> {
  const invite = PLAY.show === "invite";
  const short = PLAY.show !== "project";
  const t0 = new Date(Date.now() - 86_400_000).toISOString();
  const user = (email: string, name: string, title: string, fresh = false): User => ({
    id: newId("u"), email, name, title, phone: "", operator: false,
    // The whole project's Maria is set up already; a short demo's Maria has no second step yet,
    // and an invitee hasn't seen the welcome tour
    strongAuth: !short, theme: "awake", menu: "default", tour: fresh ? undefined : "done",
    version: 1, createdAt: t0, updatedAt: t0, updatedBy: "seed",
  });
  const pradeep = { ...user(PRADEEP, "Pradeep", "Lead engineer"), strongAuth: true };
  // An invitee has no name yet, so the welcome asks for it the first time she signs in
  const maria = { ...user(MARIA, "Maria Lopez", "Owner", invite), ...(invite ? { name: "" } : {}) };
  for (const u of [pradeep, maria]) await repo.createUser(u);
  // An organization with the default stages
  const org = async (name: string, slug: string): Promise<Tenant> => {
    const t: Tenant = { id: newId("t"), slug, clientId: formatClientId(await repo.nextClientNumber()), name, status: "active", stages: DEFAULT_STAGES, version: 1, createdAt: t0, updatedAt: t0, updatedBy: pradeep.id };
    await repo.createTenant(t);
    return t;
  };
  const neon1 = await org("neon1", "neon1");
  const bakery = await org("Maple Street Bakery", "maple-street");
  // Both of them are in the bakery; Maria is its admin (invited, not yet joined, in the invite demo)
  const member = async (t: Tenant, u: User, access: Member["access"], joined = true) => {
    const seen = joined ? new Date().toISOString() : undefined;
    await repo.saveMember({ tenantId: t.id, userId: u.id, email: u.email, name: u.name, title: u.title, access, status: joined ? "joined" : "invited", invitedBy: pradeep.id, invitedAt: t0, joinedAt: joined ? t0 : undefined, lastSeenAt: seen, seenAt: seen, version: 1, createdAt: t0, updatedAt: t0, updatedBy: pradeep.id }, { create: true });
  };
  await member(neon1, pradeep, "admin");
  await member(bakery, pradeep, "admin");
  await member(bakery, maria, "admin", !invite);
  // The invitation, waiting in her inbox, written by the same template real invites use
  if (invite) {
    const mail = inviteEmail({ orgName: bakery.name, inviter: pradeep.name, url: `${location.origin}/1NEON/live/?email=${encodeURIComponent(MARIA)}`, at: new Date(Date.now() - 4 * 60_000) });
    await mailer.send(MARIA, mail.subject, mail.text, mail.html);
  }
  // A short demo that starts signed in starts in a session that hasn't confirmed it's her
  if (short && !invite) {
    await repo.saveSession("live-seed", maria.id, false);
    return { id: "live-seed", email: MARIA };
  }
  return undefined;
}
