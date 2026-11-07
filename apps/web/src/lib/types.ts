// apps/web/src/lib/types.ts - Response shapes from the API, built on the shared domain types.


import type { AccessLevel, AuditEvent, DocumentRecord, Item, Member, Project, Stage, Tenant, User } from "@1neon/domain";


/** An organization in the chooser: its handles and the caller's access */
export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  clientId: string;
  access?: AccessLevel;
}


/** GET /me */
export interface Me {
  user: User;
  operator: boolean;
  // This session signed in with a passkey, so admin actions are open
  strongSession?: boolean;
  orgs: OrgSummary[];
}


/** GET /t/:tid */
export interface OrgResponse {
  org: Tenant;
  access: AccessLevel;
}


/** GET /t/:tid/workspace */
export interface Workspace {
  counts: { projects: number; deciding: number; building: number; people: number; invited: number; documents: number };
  waiting: { projectId: string; projectKey: string; itemId: string; title: string; kind: string }[];
  activity: AuditEvent[];
}


/** Someone editing a record right now (expires on its own) */
export interface EditMarker {
  recordId: string;
  userId: string;
  name: string;
  expiresAt: string;
}


/** GET /t/:tid/projects/:pid */
export interface ProjectDetail {
  project: Project;
  items: Item[];
  docs: DocumentRecord[];
  edits: EditMarker[];
}


/** GET /all/projects (operator, read only) */
export interface AllProjects {
  orgs: (OrgSummary & { stages: Stage[] })[];
  projects: Project[];
  stages: Stage[];
}


/** GET /t/:tid/members */
// Membership plus the contact number admins see in People
export type MemberRow = Member & { phone: string };
