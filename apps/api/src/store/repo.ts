// Entity access over the single table. Every tenant-scoped key is built here, from a
// tenant ID the caller has already authorized; handlers never build keys by hand.
import type { AuditEvent, DocumentRecord, Item, Member, Project, Tenant, User } from "@1neon/domain";
import { newId } from "@1neon/domain";
import { ConflictError, type Guard, type Row, type TableStore, type WriteOp } from "./types.ts";

export const keys = {
  tenant: (tid: string) => ({ PK: `T#${tid}`, SK: "META" }),
  slug: (slug: string) => ({ PK: `SLUG#${slug}`, SK: "META" }),
  clientCounter: { PK: "COUNTER", SK: "CLIENTID" },
  user: (uid: string) => ({ PK: `USER#${uid}`, SK: "PROFILE" }),
  email: (email: string) => ({ PK: `EMAIL#${email.toLowerCase()}`, SK: "USER" }),
  subject: (sub: string) => ({ PK: `SUB#${sub}`, SK: "USER" }),
  member: (tid: string, uid: string) => ({ PK: `T#${tid}`, SK: `MEMBER#${uid}` }),
  project: (tid: string, pid: string) => ({ PK: `T#${tid}`, SK: `PROJ#${pid}` }),
  projectCounter: (tid: string, prefix: string) => ({ PK: `T#${tid}`, SK: `COUNTER#${prefix}` }),
  item: (tid: string, pid: string, iid: string) => ({ PK: `T#${tid}#P#${pid}`, SK: `ITEM#${iid}` }),
  doc: (tid: string, pid: string, did: string) => ({ PK: `T#${tid}#P#${pid}`, SK: `DOC#${did}` }),
  edit: (tid: string, pid: string, recordId: string) => ({ PK: `T#${tid}#P#${pid}`, SK: `EDIT#${recordId}` }),
  audit: (tid: string) => `T#${tid}#AUDIT`,
};

/** Strip storage-only attributes before returning a row as an entity. */
function entity<T>(row: Row | undefined): T | undefined {
  if (!row) return undefined;
  const { PK: _pk, SK: _sk, GSI1PK: _a, GSI1SK: _b, GSI2PK: _c, GSI2SK: _d, ttl: _t, type: _type, n: _n, ...rest } = row;
  return rest as T;
}

export interface EditMarker {
  recordId: string;
  userId: string;
  name: string;
  expiresAt: string;
}

export class Repo {
  constructor(readonly table: TableStore) {}

  // --- Organizations -------------------------------------------------------

  async getTenant(tid: string) {
    return entity<Tenant>(await this.table.get(keys.tenant(tid).PK, "META"));
  }

  async tenantIdForSlug(slug: string) {
    const r = await this.table.get(keys.slug(slug).PK, "META");
    return r?.tenantId as string | undefined;
  }

  async listTenants() {
    return (await this.table.queryIndex("GSI2", "KIND#TENANT")).map((r) => entity<Tenant>(r)!);
  }

  async nextClientNumber() {
    return this.table.increment(keys.clientCounter.PK, keys.clientCounter.SK);
  }

  async createTenant(t: Tenant) {
    await this.table.write([
      { put: { ...keys.tenant(t.id), type: "tenant", GSI2PK: "KIND#TENANT", GSI2SK: t.clientId, ...t }, guard: { create: true } },
      { put: { ...keys.slug(t.slug), tenantId: t.id }, guard: { create: true } },
    ]);
  }

  async saveTenant(t: Tenant, expected: number) {
    await this.table.write([
      { put: { ...keys.tenant(t.id), type: "tenant", GSI2PK: "KIND#TENANT", GSI2SK: t.clientId, ...t }, guard: { version: expected } },
    ]);
  }

  // --- People --------------------------------------------------------------

  async getUser(uid: string) {
    return entity<User>(await this.table.get(keys.user(uid).PK, "PROFILE"));
  }

  async userIdForEmail(email: string) {
    return (await this.table.get(keys.email(email).PK, "USER"))?.userId as string | undefined;
  }

  async userIdForSubject(sub: string) {
    return (await this.table.get(keys.subject(sub).PK, "USER"))?.userId as string | undefined;
  }

  async linkSubject(sub: string, uid: string) {
    await this.table.write([{ put: { ...keys.subject(sub), userId: uid }, guard: { always: true } }]);
  }

  async createUser(u: User) {
    await this.table.write([
      { put: { ...keys.user(u.id), type: "user", ...u }, guard: { create: true } },
      { put: { ...keys.email(u.email), userId: u.id }, guard: { create: true } },
    ]);
  }

  async saveUser(u: User, expected: number) {
    await this.table.write([{ put: { ...keys.user(u.id), type: "user", ...u }, guard: { version: expected } }]);
  }

  async getMember(tid: string, uid: string) {
    const k = keys.member(tid, uid);
    return entity<Member>(await this.table.get(k.PK, k.SK));
  }

  async listMembers(tid: string) {
    return (await this.table.query(`T#${tid}`, "MEMBER#")).map((r) => entity<Member>(r)!);
  }

  /** Every organization a user belongs to (any status). */
  async membershipsOf(uid: string) {
    return (await this.table.queryIndex("GSI1", `USER#${uid}`, "T#")).map((r) => entity<Member>(r)!);
  }

  memberOp(m: Member, guard: Guard): WriteOp {
    return {
      put: { ...keys.member(m.tenantId, m.userId), type: "member", GSI1PK: `USER#${m.userId}`, GSI1SK: `T#${m.tenantId}`, ...m },
      guard,
    };
  }

  async saveMember(m: Member, guard: Guard) {
    await this.table.write([this.memberOp(m, guard)]);
  }

  // --- Projects ------------------------------------------------------------

  async getProject(tid: string, pid: string) {
    const k = keys.project(tid, pid);
    return entity<Project>(await this.table.get(k.PK, k.SK));
  }

  async listProjects(tid: string) {
    return (await this.table.query(`T#${tid}`, "PROJ#")).map((r) => entity<Project>(r)!).filter((p) => !p.deletedAt);
  }

  /** The All clients view: every project in every organization (read only). */
  async listAllProjects() {
    return (await this.table.queryIndex("GSI2", "KIND#PROJECT")).map((r) => entity<Project>(r)!).filter((p) => !p.deletedAt);
  }

  async nextProjectNumber(tid: string, prefix: string) {
    const k = keys.projectCounter(tid, prefix);
    return this.table.increment(k.PK, k.SK);
  }

  projectOp(p: Project, guard: Guard): WriteOp {
    return {
      put: { ...keys.project(p.tenantId, p.id), type: "project", GSI2PK: "KIND#PROJECT", GSI2SK: `${p.tenantId}#${p.id}`, ...p },
      guard,
    };
  }

  async saveProject(p: Project, guard: Guard) {
    await this.table.write([this.projectOp(p, guard)]);
  }

  // --- Layer items and documents ------------------------------------------

  async listItems(tid: string, pid: string) {
    return (await this.table.query(`T#${tid}#P#${pid}`, "ITEM#")).map((r) => entity<Item>(r)!);
  }

  async getItem(tid: string, pid: string, iid: string) {
    const k = keys.item(tid, pid, iid);
    return entity<Item>(await this.table.get(k.PK, k.SK));
  }

  itemOp(i: Item, guard: Guard): WriteOp {
    return { put: { ...keys.item(i.tenantId, i.projectId, i.id), type: "item", ...i }, guard };
  }

  async saveItem(i: Item, guard: Guard) {
    await this.table.write([this.itemOp(i, guard)]);
  }

  async deleteItem(tid: string, pid: string, iid: string, version: number) {
    await this.table.write([{ delete: keys.item(tid, pid, iid), guard: { version } }]);
  }

  async listDocs(tid: string, pid: string) {
    return (await this.table.query(`T#${tid}#P#${pid}`, "DOC#")).map((r) => entity<DocumentRecord>(r)!);
  }

  async getDoc(tid: string, pid: string, did: string) {
    const k = keys.doc(tid, pid, did);
    return entity<DocumentRecord>(await this.table.get(k.PK, k.SK));
  }

  async saveDoc(d: DocumentRecord, guard: Guard) {
    await this.table.write([{ put: { ...keys.doc(d.tenantId, d.projectId, d.id), type: "doc", ...d }, guard }]);
  }

  // --- Edit markers (advisory soft locks) ---------------------------------

  /** Live markers only: a marker's TTL is its expiry, and both backends hide expired rows. */
  async listEdits(tid: string, pid: string): Promise<EditMarker[]> {
    return (await this.table.query(`T#${tid}#P#${pid}`, "EDIT#")).map((r) => entity<EditMarker>(r)!);
  }

  /** Take or renew the marker. Returns the current holder if someone else has it. */
  async markEditing(tid: string, pid: string, marker: EditMarker): Promise<EditMarker | undefined> {
    const k = keys.edit(tid, pid, marker.recordId);
    const row = await this.table.get(k.PK, k.SK);
    const holder = entity<EditMarker>(row);
    if (holder && holder.userId !== marker.userId) return holder;
    const version = Number(row?.version ?? 0);
    try {
      await this.table.write([{ put: { ...k, ...marker, version: version + 1, ttl: Math.ceil(Date.parse(marker.expiresAt) / 1000) }, guard: row ? { version } : { create: true } }]);
    } catch (e) {
      if (e instanceof ConflictError) return entity<EditMarker>(e.current);
      throw e;
    }
    return undefined;
  }

  async clearEditing(tid: string, pid: string, recordId: string, uid: string) {
    const k = keys.edit(tid, pid, recordId);
    const current = await this.table.get(k.PK, k.SK);
    if (current?.userId === uid) await this.table.write([{ delete: k }]);
  }

  // --- Audit ---------------------------------------------------------------

  auditOp(e: Omit<AuditEvent, "id" | "at">): WriteOp {
    const at = new Date().toISOString();
    const id = newId();
    const ttl = Math.floor(Date.now() / 1000) + 3 * 365 * 24 * 3600;
    return { put: { PK: keys.audit(e.tenantId), SK: `${at}#${id}`, type: "audit", id, at, ttl, ...e }, guard: { always: true } };
  }

  async listAudit(tid: string, limit = 50) {
    return (await this.table.query(keys.audit(tid), "", { limit, reverse: true })).map((r) => entity<AuditEvent>(r)!);
  }
}
