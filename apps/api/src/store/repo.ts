// apps/api/src/store/repo.ts - Entity access over the single table. Every tenant-scoped key is
// built here, from a tenant ID the caller has already authorized; handlers never build keys by
// hand.


import type { AuditEvent, DocumentRecord, Item, Member, Project, Tenant, User } from "@1neon/domain";
import { newId, themeOf } from "@1neon/domain";
import { ConflictError, type Guard, type Row, type TableStore, type WriteOp } from "./types.ts";


// Key layout. Tenant data lives under T#{tid}, project contents under T#{tid}#P#{pid},
// so one query reads a whole project and no key can point into another tenant
export const keys = {
  tenant: (tid: string) => ({ PK: `T#${tid}`, SK: "META" }),
  // Global lookups: slug, email, and Cognito subject point at a tenant or user ID
  slug: (slug: string) => ({ PK: `SLUG#${slug}`, SK: "META" }),
  clientCounter: { PK: "COUNTER", SK: "CLIENTID" },
  user: (uid: string) => ({ PK: `USER#${uid}`, SK: "PROFILE" }),
  email: (email: string) => ({ PK: `EMAIL#${email.toLowerCase()}`, SK: "USER" }),
  subject: (sub: string) => ({ PK: `SUB#${sub}`, SK: "USER" }),
  // One sign-in session, by the token family's origin_jti: how strongly it was signed in
  session: (jti: string) => ({ PK: `SESSION#${jti}`, SK: "META" }),
  // A person's authenticator app secret, kept apart from the profile so it never leaves the API
  totp: (uid: string) => ({ PK: `USER#${uid}`, SK: "TOTP" }),
  // Inside one tenant
  member: (tid: string, uid: string) => ({ PK: `T#${tid}`, SK: `MEMBER#${uid}` }),
  project: (tid: string, pid: string) => ({ PK: `T#${tid}`, SK: `PROJ#${pid}` }),
  projectCounter: (tid: string, prefix: string) => ({ PK: `T#${tid}`, SK: `COUNTER#${prefix}` }),
  // Inside one project
  item: (tid: string, pid: string, iid: string) => ({ PK: `T#${tid}#P#${pid}`, SK: `ITEM#${iid}` }),
  // General files, with no project, share the "_" partition
  doc: (tid: string, pid: string | undefined, did: string) => ({ PK: `T#${tid}#P#${pid ?? "_"}`, SK: `DOC#${did}` }),
  edit: (tid: string, pid: string, recordId: string) => ({ PK: `T#${tid}#P#${pid}`, SK: `EDIT#${recordId}` }),
  audit: (tid: string) => `T#${tid}#AUDIT`,
};


/** Strip storage-only attributes before returning a row as an entity */
function entity<T>(row: Row | undefined): T | undefined {
  if (!row) return undefined;
  const { PK: _pk, SK: _sk, GSI1PK: _a, GSI1SK: _b, GSI2PK: _c, GSI2SK: _d, ttl: _t, type: _type, n: _n, ...rest } = row;
  return rest as T;
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

  // Tenant and slug claim land together, so two organizations can't share an address
  async createTenant(t: Tenant) {
    await this.table.write([
      { put: { ...keys.tenant(t.id), type: "tenant", GSI2PK: "KIND#TENANT", GSI2SK: t.clientId, ...t }, guard: { create: true } },
      { put: { ...keys.slug(t.slug), tenantId: t.id }, guard: { create: true } },
    ]);
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

  // A session's sign-in method; it lives as long as its refresh token (30 days)
  async saveSession(jti: string, userId: string, strong: boolean) {
    const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    await this.table.write([{ put: { ...keys.session(jti), userId, strong, ttl }, guard: { always: true } }]);
  }

  // Strong only when this very session signed in with a passkey, for this person
  async sessionStrong(jti: string | undefined, userId: string) {
    if (!jti) return false;
    const row = await this.table.get(keys.session(jti).PK, "META");
    return row?.userId === userId && row?.strong === true;
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

  // Remove the authenticator app
  async deleteTotp(uid: string) {
    await this.table.write([{ delete: keys.totp(uid) }]);
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
    await this.table.write([{ put: { ...keys.user(u.id), type: "user", ...u }, guard: { version: expected } }]);
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

  // --- Audit ---------------------------------------------------------------

  // Audit rows sort by time within the tenant and expire after three years
  auditOp(e: Omit<AuditEvent, "id" | "at">): WriteOp {
    const at = new Date().toISOString();
    const id = newId();
    const ttl = Math.floor(Date.now() / 1000) + 3 * 365 * 24 * 3600;
    return { put: { PK: keys.audit(e.tenantId), SK: `${at}#${id}`, type: "audit", id, at, ttl, ...e }, guard: { always: true } };
  }

  // Newest audit events first
  async listAudit(tid: string, limit = 50) {
    return (await this.table.query(keys.audit(tid), "", { limit, reverse: true })).map((r) => entity<AuditEvent>(r)!);
  }
}
