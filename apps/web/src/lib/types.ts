// apps/web/src/lib/types.ts - Response shapes from the API, built on the shared domain types.


import type { AccessLevel, AuditEvent, CalEvent, DocumentRecord, Item, Layer, Member, Project, Stage, Tenant, User } from "@1neon/domain";


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
  // Second steps set up: an authenticator app, a passkey added here, or any (including older ones)
  factors?: { totp: boolean; sms?: boolean; passkey: boolean; any: boolean };
  // Where texts stand, so the profile can say what's next
  sms?: { state: SmsState };
  // Neo for signed-in people is available here (a model is wired)
  neo?: boolean;
  orgs: OrgSummary[];
}


/** Texts: not offered yet, no number, not agreed, stopped by a STOP reply, waiting for a code, or on */
export type SmsState = "unavailable" | "no_number" | "not_agreed" | "opted_out" | "unverified" | "ready";


/** GET /t/:tid */
export interface OrgResponse {
  org: Tenant;
  access: AccessLevel;
}


/** GET /t/:tid/workspace */
export interface Workspace {
  counts: { projects: number; deciding: number; building: number; people: number; invited: number; documents: number };
  waiting: { projectId: string; projectKey: string; projectName: string; itemId: string; title: string; kind: string; action: "pay" | "issue" | "choose" | "accept" | "upload" | "do"; count?: number; dueDate?: string; overdue?: boolean; failed?: boolean }[];
  // How many actions wait in all; `waiting` is a preview of them unless ?waiting=all was asked
  waitingTotal?: number;
  // Each event with who did it, by name (blank for the system)
  activity: (AuditEvent & { by?: string })[];
  updates?: { projectKey: string; projectName: string; title: string; body: string; health: string; at: string; by: string }[];
  // Each live project's standing: stage, health, work done, overdue and blocked counts, and its next date
  glance?: { key: string; name: string; stage: string; layer: Layer; closed: boolean; health: Project["health"]; targetDate?: string; done: number; total: number; overdue: number; blocked: number; next?: { title: string; date: string; itemId: string; kind: string } }[];
  // Leave on the organization's calendar in the next seven days
  away?: { personId?: string; name: string; title: string; date: string; endDate?: string }[];
}


/** One dated thing on Home's calendar (GET /t/:tid/calendar) */
export interface CalEntry {
  date: string;
  endDate?: string;
  time?: string;
  title: string;
  kind: string;
  source: "work" | "target" | "event";
  projectKey?: string;
  itemId?: string;
  eventId?: string;
  done: boolean;
  overdue: boolean;
  mine: boolean;
  personId?: string;
  repeat?: string;
  requestedTiming?: string;
}
export interface CalendarMonth { today: string; month: string; from: string; to: string; entries: CalEntry[]; overdue: CalEntry[]; repeating: CalEvent[]; events: CalEvent[] }


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
// Membership with the person's current name and title. Phone numbers stay on each person's own
// profile, so the list never carries one
// A member as the list returns it; neon1 marks neon1's own people, whose access only neon1 changes
export type MemberRow = Member & { neon1?: boolean };
