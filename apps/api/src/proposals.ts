// apps/api/src/proposals.ts - Issuing a revision of a project's proposal, shared by the issue route
// and the seed: freeze a copy, number it, set the price check, and mark the earlier revision replaced.


import { buildSnapshot, Item, newId, plusDays, PRICE_CHECK_DAYS, PROPOSAL_FIRST, ProposalFields, proposalRef, revisions, todayIn, type Project, type Tenant } from "@1neon/domain";
import type { Repo } from "./store/repo.ts";


/** Issue the next revision; throws "no_options" when nothing is shared yet. Returns the new revision */
export async function issueProposal(repo: Repo, t: Pick<Tenant, "id" | "name" | "timeZone">, p: Project, by: { id: string; name?: string }, note = "", at = new Date()) {
  const items = await repo.listItems(p.tenantId, p.id);
  if (!items.some((i) => i.kind === "option" && (i.status === "proposed" || i.status === "approved"))) return { error: "no_options" as const };
  const prev = revisions(items).at(-1);
  const number = prev?.p.number ?? (await repo.nextProposalNumber(PROPOSAL_FIRST));
  const rev = (prev?.p.rev ?? 0) + 1;
  // The client's people: the named decision maker is addressed, else a client admin (never neon1)
  const members = await repo.listMembers(p.tenantId);
  const people = members.filter((m) => m.status !== "deactivated").map((m) => ({ userId: m.userId, name: m.name || m.email, title: m.title, email: m.email, admin: m.access === "admin" && m.status === "joined" && m.userId !== by.id }));
  const snapshot = buildSnapshot({ project: p, items, orgName: t.name, people, number, rev });
  const ts = at.toISOString();
  const issued = Item.parse({
    tenantId: p.tenantId, projectId: p.id, id: newId("i"), kind: "proposal", title: `Proposal ${proposalRef(number, rev)}`, body: note, status: "issued", rank: String(rev).padStart(4, "0"),
    fields: ProposalFields.parse({ number, rev, issuedAt: ts, issuedBy: by.id, issuerName: by.name || undefined, note, checkBy: plusDays(todayIn(t.timeZone, at), PRICE_CHECK_DAYS), snapshot }),
    version: 1, createdAt: ts, updatedAt: ts, updatedBy: by.id,
  });
  const old = prev && items.find((i) => i.id === prev.id)!;
  await repo.table.write([
    repo.itemOp(issued, { create: true }),
    ...(old ? [repo.itemOp({ ...old, status: "superseded", version: old.version + 1, updatedAt: ts, updatedBy: by.id }, { version: old.version })] : []),
    repo.auditOp({ tenantId: p.tenantId, actorId: by.id, action: "proposal.issued", target: issued.id, summary: `${p.key}: issued Proposal ${proposalRef(number, rev)}${note ? `: ${note}` : ""}` }),
  ]);
  return { issued };
}
