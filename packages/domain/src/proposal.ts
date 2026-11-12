// packages/domain/src/proposal.ts - The project's proposal: one document per project, issued in
// numbered revisions (0039 r1, r2, ...). Each issued revision freezes a copy of everything the proposal
// shows, so the printed record never changes after the fact; every option in it has an ID (0039-r2-B)
// that a decision names. The same snapshot builder makes the live draft and the frozen copy.


import { z } from "zod";
import { id, isoDate, MetricFields, OptionFields, RequirementFields, type Item, type Project } from "./model.ts";


// The first proposal number 1NEON issues: neon1's 2025 proposals reached 0038 (remappable later)
export const PROPOSAL_FIRST = 39;
// Estimates are checked when a revision is issued and rechecked after this many days
export const PRICE_CHECK_DAYS = 30;


// --- The frozen copy -------------------------------------------------------------

const Line = z.object({ title: z.string().max(200), body: z.string().max(20_000).default("") });
const Person = z.object({ name: z.string().max(120), title: z.string().max(120).optional(), email: z.string().max(254).optional() });

/** One option as issued: its item and version, its ID in this revision, and its terms */
export const SnapshotOption = z.object({
  id: id,
  version: z.number().int(),
  letter: z.string().max(2),
  code: z.string().max(24),
  title: z.string().max(160),
  body: z.string().max(20_000).default(""),
  status: z.string().max(24),
  fields: OptionFields,
});
export type SnapshotOption = z.infer<typeof SnapshotOption>;

/** Everything a revision prints, as it stood when issued */
export const ProposalSnapshot = z.object({
  orgName: z.string().max(120),
  project: z.object({ key: z.string().max(16), name: z.string().max(120), summary: z.string().max(500).default(""), outcome: z.string().max(500).default(""), targetDate: z.string().optional() }),
  preparedFor: Person.optional(),
  deciders: z.array(z.string().max(120)).max(20).default([]),
  requests: z.array(Line).max(200).default([]),
  learned: z.array(Line).max(200).default([]),
  measures: z.array(z.string().max(300)).max(100).default([]),
  requirements: z.array(z.object({ title: z.string().max(200), priority: z.string().max(8) })).max(200).default([]),
  constraints: z.array(Line).max(100).default([]),
  assets: z.array(z.string().max(200)).max(100).default([]),
  files: z.array(z.string().max(200)).max(100).default([]),
  options: z.array(SnapshotOption).max(26),
});
export type ProposalSnapshot = z.infer<typeof ProposalSnapshot>;

/** A revision's record: its number and revision, who issued it and when, what changed, the price
 * check date, the frozen copy, and a client's request to refresh it if one was made */
export const ProposalFields = z.object({
  number: z.number().int().min(1).max(9999),
  rev: z.number().int().min(1).max(999),
  issuedAt: isoDate,
  issuedBy: id,
  issuerName: z.string().max(80).optional(),
  note: z.string().max(1000).default(""),
  checkBy: z.string().date(),
  snapshot: ProposalSnapshot,
  refreshAsked: z.object({ by: id, name: z.string().max(80), at: isoDate }).optional(),
});
export type ProposalFields = z.infer<typeof ProposalFields>;


// --- Names and IDs -----------------------------------------------------------------

/** 39 → "0039" */
export const proposalNumber = (n: number) => String(n).padStart(4, "0");
/** "0039-r2" */
export const proposalRef = (n: number, rev: number) => `${proposalNumber(n)}-r${rev}`;
/** "0039-r2-B" */
export const optionCode = (n: number, rev: number, letter: string) => `${proposalRef(n, rev)}-${letter}`;
/** A download's file name: neon1-<org slug>-proposal-0039-r2.<ext> */
export const proposalFileName = (slug: string, n: number, rev: number, ext: "pdf" | "docx") => `neon1-${slug}-proposal-${proposalRef(n, rev)}.${ext}`;

/** Find a proposal reference in text: a file name, a document property, or a header line.
 * "neon1-x-proposal-0039-r2.docx", "0039-r2", "Proposal 0039 r2" all read as { number: 39, rev: 2 } */
export function findProposalRef(text: string): { number: number; rev: number } | undefined {
  const m = /(\d{4})[-_ ]?r(?:ev(?:ision)?)?[-_ ]?(\d{1,3})/i.exec(text);
  return m ? { number: Number(m[1]), rev: Number(m[2]) } : undefined;
}

/** An option's letter: from a title like "B. Solid setup", or its position */
export function optionLetter(title: string, index: number): string {
  return /^([A-Z])[.)]\s/.exec(title)?.[1] ?? String.fromCharCode(65 + (index % 26));
}


// --- Building and reading ------------------------------------------------------------

type Who = { userId: string; name: string; title?: string; email: string; admin?: boolean };

/**
 * The proposal as the project's records say right now: the live draft, and what Issue freezes. Shared
 * and approved options are in it (drafts and declined ones aren't); everything else comes from the
 * project's own items, so nothing is typed twice
 */
export function buildSnapshot(input: { project: Project; items: Item[]; orgName: string; people: Who[]; number: number; rev: number }): ProposalSnapshot {
  const { project: p, items, number, rev } = input;
  const of = (kind: string) => items.filter((i) => i.kind === kind);
  const byId = new Map(input.people.map((x) => [x.userId, x]));
  const deciders = p.people.filter((x) => x.role === "decision_maker").map((x) => byId.get(x.userId)).filter((x): x is Who => Boolean(x));
  const lead = deciders[0] ?? input.people.find((x) => x.admin);
  const options = of("option").filter((o) => o.status === "proposed" || o.status === "approved");
  return ProposalSnapshot.parse({
    orgName: input.orgName,
    project: { key: p.key, name: p.name, summary: p.summary, outcome: p.outcome, targetDate: p.targetDate },
    preparedFor: lead ? { name: lead.name, title: lead.title || undefined, email: lead.email } : undefined,
    deciders: deciders.map((x) => x.name),
    requests: of("request").map((r) => ({ title: r.title, body: r.body })),
    learned: of("discovery").filter((q) => q.body.trim()).map((q) => ({ title: q.title, body: q.body })),
    measures: of("metric").map((m) => {
      const f = MetricFields.parse(m.fields);
      return f.baseline !== undefined && f.target !== undefined ? `${m.title}: from ${f.baseline} to ${f.target}${f.unit ? ` ${f.unit}` : ""}` : m.title;
    }),
    requirements: of("requirement").map((r) => ({ title: r.title, priority: RequirementFields.parse(r.fields).priority })),
    constraints: of("constraint").map((c) => ({ title: c.title, body: c.body })),
    assets: of("asset").map((a) => a.title),
    files: of("file_request").map((f) => f.title),
    options: options.map((o, i) => {
      const letter = optionLetter(o.title, i);
      return { id: o.id, version: o.version, letter, code: optionCode(number, rev, letter), title: o.title, body: o.body, status: o.status, fields: OptionFields.parse(o.fields) };
    }),
  });
}

/** A project's issued revisions, oldest first */
export function revisions<T extends { kind: string; fields: Record<string, unknown> }>(items: T[]): (T & { p: ProposalFields })[] {
  return items
    .filter((i) => i.kind === "proposal")
    .map((i) => ({ ...i, p: ProposalFields.parse(i.fields) }))
    .sort((a, b) => a.p.rev - b.p.rev);
}

/** Is a revision past its price check? `today` is a calendar date in the organization's time zone */
export const priceCheckDue = (p: Pick<ProposalFields, "checkBy">, today: string) => today > p.checkBy;

/**
 * What changed since a revision was issued, in the options a client would approve: options edited
 * (a newer version), shared since, or taken back. Approval waits for the next revision when any of the
 * option being approved changed
 */
export function changedSince<T extends Pick<Item, "id" | "kind" | "status" | "version" | "title">>(p: Pick<ProposalFields, "snapshot">, items: T[]) {
  const now = items.filter((i) => i.kind === "option" && (i.status === "proposed" || i.status === "approved"));
  const was = new Map(p.snapshot.options.map((o) => [o.id, o]));
  const edited = now.filter((o) => was.has(o.id) && was.get(o.id)!.version !== o.version && !(o.status === "approved" && was.get(o.id)!.status !== "approved"));
  const added = now.filter((o) => !was.has(o.id));
  const removed = p.snapshot.options.filter((o) => !now.some((x) => x.id === o.id));
  return { edited, added, removed, any: edited.length + added.length + removed.length > 0 };
}
