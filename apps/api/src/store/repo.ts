// apps/api/src/store/repo.ts - Entity access over the single table. Every tenant-scoped key is
// built here, from a tenant ID the caller has already authorized; handlers never build keys by
// hand.


import type { AuditEvent, CalEvent, DocumentRecord, Item, Member, Project, Tenant, User } from "@1neon/domain";
import { newId, themeOf } from "@1neon/domain";
import { ConflictError, type Guard, type Row, type TableStore, type WriteOp } from "./types.ts";


// Key layout. Tenant data lives under T#{tid}, project contents under T#{tid}#P#{pid},
// so one query reads a whole project and no key can point into another tenant
export const keys = {
  tenant: (tid: string) => ({ PK: `T#${tid}`, SK: "META" }),
  // Global lookups: slug, email, and Cognito subject point at a tenant or user ID
  slug: (slug: string) => ({ PK: `SLUG#${slug}`, SK: "META" }),
  clientCounter: { PK: "COUNTER", SK: "CLIENTID" },
  // Proposal numbers run across all of neon1 (0039, 0040, ...), one per project
  proposalCounter: { PK: "COUNTER", SK: "PROPOSAL" },
  user: (uid: string) => ({ PK: `USER#${uid}`, SK: "PROFILE" }),
  email: (email: string) => ({ PK: `EMAIL#${email.toLowerCase()}`, SK: "USER" }),
  subject: (sub: string) => ({ PK: `SUB#${sub}`, SK: "USER" }),
  // One sign-in session, by the token family's origin_jti: how strongly it was signed in
  session: (jti: string) => ({ PK: `SESSION#${jti}`, SK: "META" }),
  // A person's authenticator app secret, kept apart from the profile so it never leaves the API
  totp: (uid: string) => ({ PK: `USER#${uid}`, SK: "TOTP" }),
  // An authenticator being set up: its own row, so starting (or abandoning) setup never touches the active one
  totpPending: (uid: string) => ({ PK: `USER#${uid}`, SK: "TOTP#PENDING" }),
  // The earliest proof that still counts for this person; raised when a factor is removed or replaced
  assurance: (uid: string) => ({ PK: `USER#${uid}`, SK: "ASSURANCE" }),
  // One texted code waiting to be used, per purpose: confirming it's you, or proving a new number
  smsChallenge: (uid: string, purpose: "confirm" | "verify") => ({ PK: `USER#${uid}`, SK: purpose === "confirm" ? "SMSCONFIRM" : "SMSVERIFY" }),
  // The person's recent code texts (time, number, purpose), kept apart from the codes themselves so
  // using or replacing a code never resets the hourly limit; expires an hour after the latest send
  smsSent: (uid: string) => ({ PK: `USER#${uid}`, SK: "SMSSENT" }),
  // Security events about one person's sign-in methods, newest last
  security: (uid: string, at: string, id: string) => ({ PK: `USER#${uid}`, SK: `SEC#${at}#${id}` }),
  // Inside one tenant
  member: (tid: string, uid: string) => ({ PK: `T#${tid}`, SK: `MEMBER#${uid}` }),
  project: (tid: string, pid: string) => ({ PK: `T#${tid}`, SK: `PROJ#${pid}` }),
  projectCounter: (tid: string, prefix: string) => ({ PK: `T#${tid}`, SK: `COUNTER#${prefix}` }),
  // One revision for the whole membership list: every change that could alter who is an admin bumps
  // it in the same transaction, so two changes to different people can't both pass the admin check
  membershipRev: (tid: string) => ({ PK: `T#${tid}`, SK: "MEMBERSHIP#REV" }),
  // A create request's idempotency key, pointing at what it made (kept a day)
  idempotency: (tid: string, key: string) => ({ PK: `T#${tid}`, SK: `IDEM#${key}` }),
  // Inside one project
  item: (tid: string, pid: string, iid: string) => ({ PK: `T#${tid}#P#${pid}`, SK: `ITEM#${iid}` }),
  // General files, with no project, share the "_" partition
  doc: (tid: string, pid: string | undefined, did: string) => ({ PK: `T#${tid}#P#${pid ?? "_"}`, SK: `DOC#${did}` }),
  edit: (tid: string, pid: string, recordId: string) => ({ PK: `T#${tid}#P#${pid}`, SK: `EDIT#${recordId}` }),
  // Comments on one item, in time order
  comment: (tid: string, pid: string, iid: string, at: string, cid: string) => ({ PK: `T#${tid}#P#${pid}`, SK: `COMMENT#${iid}#${at}#${cid}` }),
  audit: (tid: string) => `T#${tid}#AUDIT`,
  // The organization's own calendar events, in its partition beside its projects
  calEvent: (tid: string, eid: string) => ({ PK: `T#${tid}`, SK: `CAL#${eid}` }),
};


// How long a passkey or authenticator check keeps a session trusted for admin actions
export const STEP_UP_MS = 12 * 60 * 60 * 1000;


/** Strip storage-only attributes before returning a row as an entity */
function entity<T>(row: Row | undefined): T | undefined {
  if (!row) return undefined;
  const { PK: _pk, SK: _sk, GSI1PK: _a, GSI1SK: _b, GSI2PK: _c, GSI2SK: _d, ttl: _t, type: _type, n: _n, ...rest } = row;
  return rest as T;
}


/** A comment on an item: who wrote it, when, and the text */
export interface Comment {
  tenantId: string;
  projectId: string;
  itemId: string;
  id: string;
  at: string;
  authorId: string;
  authorName: string;
  body: string;
}


/** An authenticator app: its secret, whether setup finished, the last code used, and lockout state */
export interface TotpRecord {
  secret: string;
  confirmed: boolean;
  lastCounter: number;
  fails: number;
  lockedUntil?: string;
  version: number;
}


/** An authenticator setup in progress: bound to the session that started it, short-lived, and
 * limited in tries. It becomes the active record only through activateTotp */
export interface PendingTotp {
  secret: string;
  // The origin_jti of the session that started setup ("dev" locally)
  jti: string;
  expiresAt: string;
  attempts: number;
  version: number;
}


// Setup must finish within ten minutes, in five tries
export const PENDING_TOTP_MS = 10 * 60 * 1000;
export const PENDING_TOTP_TRIES = 5;


/** "Dana is editing this": advisory only; saves are still guarded by version */
export interface EditMarker {
  recordId: string;
  userId: string;
  name: string;
  expiresAt: string;
}


/** Typed reads and writes for every entity; the `*Op` methods build writes to combine in one transaction */
export class Repo {
  constructor(readonly table: TableStore) {}

  // --- Organizations -------------------------------------------------------

  // One organization by ID
  async getTenant(tid: string) {
    return entity<Tenant>(await this.table.get(keys.tenant(tid).PK, "META"));
  }

  // Resolve a URL slug to its organization
  async tenantIdForSlug(slug: string) {
    const r = await this.table.get(keys.slug(slug).PK, "META");
    return r?.tenantId as string | undefined;
  }

  // Every organization, ordered by client ID, for the operator
  async listTenants() {
    return (await this.table.queryIndex("GSI2", "KIND#TENANT")).map((r) => entity<Tenant>(r)!);
  }

  // Client IDs (N1-0001) come from an atomic counter
  async nextClientNumber() {
    return this.table.increment(keys.clientCounter.PK, keys.clientCounter.SK);
  }

  // Proposal numbers continue after neon1's 2025 proposals: the first is PROPOSAL_FIRST
  async nextProposalNumber(first: number) {
    return first - 1 + (await this.table.increment(keys.proposalCounter.PK, keys.proposalCounter.SK));
  }

  // Tenant and slug claim land together, so two organizations can't share an address
  async createTenant(t: Tenant) {
    await this.table.write([
      { put: { ...keys.tenant(t.id), type: "tenant", GSI2PK: "KIND#TENANT", GSI2SK: t.clientId, ...t }, guard: { create: true } },
      { put: { ...keys.slug(t.slug), tenantId: t.id }, guard: { create: true } },
    ]);
  }

  // The tenant's write, for a transaction with other rows (an agreement signature and its audit)
  tenantOp(t: Tenant, guard: { version: number }): WriteOp {
    return { put: { ...keys.tenant(t.id), type: "tenant", GSI2PK: "KIND#TENANT", GSI2SK: t.clientId, ...t }, guard };
  }

  // Lands only if the stored version still matches `expected`
  async saveTenant(t: Tenant, expected: number) {
    await this.table.write([
      { put: { ...keys.tenant(t.id), type: "tenant", GSI2PK: "KIND#TENANT", GSI2SK: t.clientId, ...t }, guard: { version: expected } },
    ]);
  }

  // --- People --------------------------------------------------------------

  // One person's profile, with a legacy stored theme read as today's value
  async getUser(uid: string) {
    const user = entity<User>(await this.table.get(keys.user(uid).PK, "PROFILE"));
    return user && { ...user, theme: themeOf(user.theme) };
  }

  // Email and subject lookups resolve sign-in to our user record
  async userIdForEmail(email: string) {
    return (await this.table.get(keys.email(email).PK, "USER"))?.userId as string | undefined;
  }

  // Repeat sign-ins resolve by Cognito subject, which never changes
  async userIdForSubject(sub: string) {
    return (await this.table.get(keys.subject(sub).PK, "USER"))?.userId as string | undefined;
  }

  // Remember a subject after the first email match; relinking is harmless
  async linkSubject(sub: string, uid: string) {
    await this.table.write([{ put: { ...keys.subject(sub), userId: uid }, guard: { always: true } }]);
  }

  // A session's assurance. The row lives as long as its refresh token (30 days), but a passkey or
  // authenticator check only counts for STEP_UP_MS; after that admin actions ask again. `strongAt`
  // is when the proof happened, compared with the person's assurance floor
  async saveSession(jti: string, userId: string, strong: boolean, opts: { strongAt?: string; strongUntil?: string } = {}) {
    await this.table.write([this.sessionOp(jti, userId, strong, opts)]);
  }

  /** The session write on its own, so a proof can land in the same transaction that uses up a code */
  sessionOp(jti: string, userId: string, strong: boolean, opts: { strongAt?: string; strongUntil?: string } = {}): WriteOp {
    const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const strongAt = strong ? opts.strongAt ?? new Date().toISOString() : undefined;
    const strongUntil = strong ? opts.strongUntil ?? new Date(Date.now() + STEP_UP_MS).toISOString() : undefined;
    return { put: { ...keys.session(jti), userId, strong, strongAt, strongUntil, ttl }, guard: { always: true } };
  }

  // The session row itself, for keeping its expiry when a factor change re-stamps it
  async getSession(jti: string) {
    const row = await this.table.get(keys.session(jti).PK, "META");
    return row && { userId: String(row.userId), strong: row.strong === true, strongAt: row.strongAt as string | undefined, strongUntil: row.strongUntil as string | undefined };
  }

  // Strong only when this very session proved a passkey or authenticator, for this person, recently,
  // and after the person's last factor removal or replacement. Rows without an expiry (written
  // before the time limit) read as not strong, so this fails closed
  async sessionStrong(jti: string | undefined, userId: string) {
    if (!jti) return false;
    const row = await this.table.get(keys.session(jti).PK, "META");
    const until = typeof row?.strongUntil === "string" ? Date.parse(row.strongUntil) : NaN;
    if (!(row?.userId === userId && row?.strong === true && until > Date.now())) return false;
    // Only strong sessions pay for the second read
    const floor = await this.table.get(keys.assurance(userId).PK, keys.assurance(userId).SK);
    if (typeof floor?.notBefore !== "string") return true;
    const at = typeof row.strongAt === "string" ? Date.parse(row.strongAt) : NaN;
    // Strictly after: a proof in the same millisecond as the change doesn't survive it
    return at > Date.parse(floor.notBefore);
  }

  // Every proof made before `at` stops counting, for every session of this person
  async raiseAssuranceFloor(userId: string, at: string) {
    await this.table.write([{ put: { ...keys.assurance(userId), notBefore: at }, guard: { always: true } }]);
  }

  // Sign-out forgets the session's assurance at once, even while its last access token lives
  async deleteSession(jti: string) {
    await this.table.write([{ delete: keys.session(jti) }]);
  }

  // The authenticator app record, if any
  async getTotp(uid: string): Promise<TotpRecord | undefined> {
    const row = await this.table.get(keys.totp(uid).PK, "TOTP");
    return row ? { secret: String(row.secret), confirmed: row.confirmed === true, lastCounter: Number(row.lastCounter ?? -1), fails: Number(row.fails ?? 0), lockedUntil: row.lockedUntil as string | undefined, version: Number(row.version ?? 0) } : undefined;
  }

  // Save it, guarded by version so two code checks can't both count
  async saveTotp(uid: string, t: TotpRecord, guard: Guard) {
    await this.table.write([{ put: { ...keys.totp(uid), ...t }, guard }]);
  }

  // Remove the authenticator app and any setup in progress, together
  async deleteTotp(uid: string) {
    await this.table.write([{ delete: keys.totp(uid) }, { delete: keys.totpPending(uid) }]);
  }

  // The setup in progress, if it hasn't expired (its TTL hides it once it has)
  async getPendingTotp(uid: string): Promise<PendingTotp | undefined> {
    const k = keys.totpPending(uid);
    const row = await this.table.get(k.PK, k.SK);
    return row ? { secret: String(row.secret), jti: String(row.jti), expiresAt: String(row.expiresAt), attempts: Number(row.attempts ?? 0), version: Number(row.version ?? 0) } : undefined;
  }

  // Start or count a try on a setup; the TTL removes an abandoned one on its own
  async savePendingTotp(uid: string, p: PendingTotp, guard: Guard) {
    await this.table.write([{ put: { ...keys.totpPending(uid), ...p, ttl: Math.ceil(Date.parse(p.expiresAt) / 1000) }, guard }]);
  }

  // Finish setup: the new active record and the end of the pending one land together or not at all
  async activateTotp(uid: string, pending: PendingTotp, active: TotpRecord, guard: Guard) {
    await this.table.write([{ put: { ...keys.totp(uid), ...active }, guard }, { delete: keys.totpPending(uid), guard: { version: pending.version } }]);
  }

  // A record that a sign-in method changed; kept three years, never shown to other people
  async securityEvent(uid: string, action: string, summary: string) {
    const at = new Date().toISOString();
    const id = newId();
    const ttl = Math.floor(Date.now() / 1000) + 3 * 365 * 24 * 3600;
    await this.table.write([{ put: { ...keys.security(uid, at, id), type: "security", action, summary, at, ttl }, guard: { always: true } }]);
  }

  // A person's security events, oldest first
  async listSecurityEvents(uid: string) {
    return (await this.table.query(`USER#${uid}`, "SEC#")).map((r) => ({ action: String(r.action), summary: String(r.summary), at: String(r.at) }));
  }

  // User and email claim land together, so an email maps to exactly one person
  async createUser(u: User) {
    await this.table.write([
      { put: { ...keys.user(u.id), type: "user", ...u }, guard: { create: true } },
      { put: { ...keys.email(u.email), userId: u.id }, guard: { create: true } },
    ]);
  }

  // Lands only if the stored version still matches `expected`
  async saveUser(u: User, expected: number) {
    await this.table.write([this.userOp(u, expected)]);
  }

  /** The profile write on its own, for combining with another write in one transaction */
  userOp(u: User, expected: number): WriteOp {
    return { put: { ...keys.user(u.id), type: "user", ...u }, guard: { version: expected } };
  }

  // One person's membership in one organization
  async getMember(tid: string, uid: string) {
    const k = keys.member(tid, uid);
    return entity<Member>(await this.table.get(k.PK, k.SK));
  }

  // Everyone in an organization, invited and removed included
  async listMembers(tid: string) {
    return (await this.table.query(`T#${tid}`, "MEMBER#")).map((r) => entity<Member>(r)!);
  }

  /** Every organization a user belongs to (any status) */
  async membershipsOf(uid: string) {
    return (await this.table.queryIndex("GSI1", `USER#${uid}`, "T#")).map((r) => entity<Member>(r)!);
  }

  // Memberships are indexed by user (GSI1) for the organization chooser
  memberOp(m: Member, guard: Guard): WriteOp {
    return {
      put: { ...keys.member(m.tenantId, m.userId), type: "member", GSI1PK: `USER#${m.userId}`, GSI1SK: `T#${m.tenantId}`, ...m },
      guard,
    };
  }

  // The membership list's revision (0 when never written)
  async membershipRev(tid: string) {
    const k = keys.membershipRev(tid);
    return Number((await this.table.get(k.PK, k.SK))?.version ?? 0);
  }

  // Bump the revision read before the change; a concurrent membership change makes this guard fail
  membershipRevOp(tid: string, rev: number): WriteOp {
    return { put: { ...keys.membershipRev(tid), version: rev + 1 }, guard: rev ? { version: rev } : { create: true } };
  }

  // What an earlier request with this key created, if anything
  async idempotent(tid: string, key: string) {
    const k = keys.idempotency(tid, key);
    const row = await this.table.get(k.PK, k.SK);
    return row && { userId: String(row.userId), projectId: String(row.projectId) };
  }

  // Claim a key in the same transaction as the create it names
  idempotencyOp(tid: string, key: string, userId: string, projectId: string): WriteOp {
    return { put: { ...keys.idempotency(tid, key), userId, projectId, ttl: Math.floor(Date.now() / 1000) + 24 * 3600 }, guard: { create: true } };
  }

  // Membership write on its own, outside a transaction
  async saveMember(m: Member, guard: Guard) {
    await this.table.write([this.memberOp(m, guard)]);
  }

  // --- Projects ------------------------------------------------------------

  // One project, soft-deleted ones included
  async getProject(tid: string, pid: string) {
    const k = keys.project(tid, pid);
    return entity<Project>(await this.table.get(k.PK, k.SK));
  }

  // An organization's live projects; soft-deleted ones stay stored but hidden
  async listProjects(tid: string) {
    return (await this.table.query(`T#${tid}`, "PROJ#")).map((r) => entity<Project>(r)!).filter((p) => !p.deletedAt);
  }

  /** The All clients view: every project in every organization (read only) */
  async listAllProjects() {
    return (await this.table.queryIndex("GSI2", "KIND#PROJECT")).map((r) => entity<Project>(r)!).filter((p) => !p.deletedAt);
  }

  // Per-tenant, per-prefix counters give keys like FLOW-1, FLOW-2
  async nextProjectNumber(tid: string, prefix: string) {
    const k = keys.projectCounter(tid, prefix);
    return this.table.increment(k.PK, k.SK);
  }

  // Projects are indexed (GSI2) for the operator's All clients view
  projectOp(p: Project, guard: Guard): WriteOp {
    return {
      put: { ...keys.project(p.tenantId, p.id), type: "project", GSI2PK: "KIND#PROJECT", GSI2SK: `${p.tenantId}#${p.id}`, ...p },
      guard,
    };
  }

  // Project write on its own, outside a transaction
  async saveProject(p: Project, guard: Guard) {
    await this.table.write([this.projectOp(p, guard)]);
  }

  // --- Layer items and documents ------------------------------------------

  // Every layer item in a project, from one partition
  async listItems(tid: string, pid: string) {
    return (await this.table.query(`T#${tid}#P#${pid}`, "ITEM#")).map((r) => entity<Item>(r)!);
  }

  // One layer item
  async getItem(tid: string, pid: string, iid: string) {
    const k = keys.item(tid, pid, iid);
    return entity<Item>(await this.table.get(k.PK, k.SK));
  }

  // Item write to combine with others in one transaction
  itemOp(i: Item, guard: Guard): WriteOp {
    return { put: { ...keys.item(i.tenantId, i.projectId, i.id), type: "item", ...i }, guard };
  }

  // Item write on its own
  async saveItem(i: Item, guard: Guard) {
    await this.table.write([this.itemOp(i, guard)]);
  }

  // Hard delete, guarded so a stale page can't remove a newer edit
  async deleteItem(tid: string, pid: string, iid: string, version: number) {
    await this.table.write([{ delete: keys.item(tid, pid, iid), guard: { version } }]);
  }

  // A project's document records, or the general ones without a project (the files live in S3)
  async listDocs(tid: string, pid: string | undefined) {
    return (await this.table.query(`T#${tid}#P#${pid ?? "_"}`, "DOC#")).map((r) => entity<DocumentRecord>(r)!);
  }

  // One document record
  async getDoc(tid: string, pid: string | undefined, did: string) {
    const k = keys.doc(tid, pid, did);
    return entity<DocumentRecord>(await this.table.get(k.PK, k.SK));
  }

  // Document record write to combine with others in one transaction
  docOp(d: DocumentRecord, guard: Guard): WriteOp {
    return { put: { ...keys.doc(d.tenantId, d.projectId, d.id), type: "doc", ...d }, guard };
  }

  // Document record write; the guard keeps scan results and renames from crossing
  async saveDoc(d: DocumentRecord, guard: Guard) {
    await this.table.write([this.docOp(d, guard)]);
  }

  // --- Comments -----------------------------------------------------------

  // An item's comments, oldest first
  async listComments(tid: string, pid: string, iid: string): Promise<Comment[]> {
    return (await this.table.query(`T#${tid}#P#${pid}`, `COMMENT#${iid}#`)).map((r) => entity<Comment>(r)!);
  }

  // A new comment
  commentOp(c: Comment): WriteOp {
    return { put: { ...keys.comment(c.tenantId, c.projectId, c.itemId, c.at, c.id), type: "comment", ...c }, guard: { create: true } };
  }

  // Remove one comment
  async deleteComment(c: Comment) {
    await this.table.write([{ delete: keys.comment(c.tenantId, c.projectId, c.itemId, c.at, c.id) }]);
  }

  // --- Edit markers (advisory soft locks) ---------------------------------

  /** Live markers only: a marker's TTL is its expiry, and both backends hide expired rows */
  async listEdits(tid: string, pid: string): Promise<EditMarker[]> {
    return (await this.table.query(`T#${tid}#P#${pid}`, "EDIT#")).map((r) => entity<EditMarker>(r)!);
  }

  /** Take or renew the marker. Returns the current holder if someone else has it */
  async markEditing(tid: string, pid: string, marker: EditMarker): Promise<EditMarker | undefined> {
    const k = keys.edit(tid, pid, marker.recordId);
    const row = await this.table.get(k.PK, k.SK);
    const holder = entity<EditMarker>(row);
    if (holder && holder.userId !== marker.userId) return holder;
    // Our own or an expired marker: renew it, guarded so two takers can't both win
    const version = Number(row?.version ?? 0);
    try {
      await this.table.write([{ put: { ...k, ...marker, version: version + 1, ttl: Math.ceil(Date.parse(marker.expiresAt) / 1000) }, guard: row ? { version } : { create: true } }]);
    } catch (e) {
      if (e instanceof ConflictError) return entity<EditMarker>(e.current);
      throw e;
    }
    return undefined;
  }

  // Release a marker, but only one the caller holds
  async clearEditing(tid: string, pid: string, recordId: string, uid: string) {
    const k = keys.edit(tid, pid, recordId);
    const current = await this.table.get(k.PK, k.SK);
    if (current?.userId === uid) await this.table.write([{ delete: k }]);
  }

  // --- Calendar events -----------------------------------------------------

  // Every calendar event of the organization's own
  async listCalEvents(tid: string) {
    return (await this.table.query(`T#${tid}`, "CAL#")).map((r) => entity<CalEvent>(r)!);
  }

  async getCalEvent(tid: string, eid: string) {
    const k = keys.calEvent(tid, eid);
    return entity<CalEvent>(await this.table.get(k.PK, k.SK));
  }

  calEventOp(e: CalEvent, guard: Guard): WriteOp {
    return { put: { ...keys.calEvent(e.tenantId, e.id), type: "calevent", ...e }, guard };
  }

  // --- Audit ---------------------------------------------------------------

  // Audit rows sort by time within the tenant and expire after three years. `at` is passed only for a
  // moment already fixed elsewhere (a proposal's issue time, the seeded examples); everything else is now
  auditOp(e: Omit<AuditEvent, "id" | "at">, at = new Date().toISOString()): WriteOp {
    const id = newId();
    const ttl = Math.floor(Date.now() / 1000) + 3 * 365 * 24 * 3600;
    return { put: { PK: keys.audit(e.tenantId), SK: `${at}#${id}`, type: "audit", id, at, ttl, ...e }, guard: { always: true } };
  }

  // Newest audit events first
  async listAudit(tid: string, limit = 50) {
    return (await this.table.query(keys.audit(tid), "", { limit, reverse: true })).map((r) => entity<AuditEvent>(r)!);
  }
}
