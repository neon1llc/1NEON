import type { AccessLevel, AuditEvent, DocumentRecord, Item, Member, Project, Stage, Tenant, User } from "@1neon/domain";

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  clientId: string;
  access?: AccessLevel;
}

export interface Me {
  user: User;
  operator: boolean;
  orgs: OrgSummary[];
}

export interface OrgResponse {
  org: Tenant;
  access: AccessLevel;
}

export interface Workspace {
  counts: { projects: number; deciding: number; building: number; people: number; invited: number; documents: number };
  waiting: { projectId: string; projectKey: string; itemId: string; title: string; kind: string }[];
  activity: AuditEvent[];
}

export interface EditMarker {
  recordId: string;
  userId: string;
  name: string;
  expiresAt: string;
}

export interface ProjectDetail {
  project: Project;
  items: Item[];
  docs: DocumentRecord[];
  edits: EditMarker[];
}

export interface AllProjects {
  orgs: (OrgSummary & { stages: Stage[] })[];
  projects: Project[];
  stages: Stage[];
}

export type MemberRow = Member & { phone: string };
