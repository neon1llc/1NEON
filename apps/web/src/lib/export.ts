// apps/web/src/lib/export.ts - An organization's own copy of everything in 1NEON, as one zip file.
//
// Built in the browser from the same reads the portal already makes, so an admin needs nobody's help
// and nothing new is opened on the server. Records go in as JSON (complete, every field) and CSV
// (the tables a spreadsheet opens: projects, members, decisions, invoices, payments, and every item);
// uploaded files go in under their project, byte for byte. README.txt says what each file holds.


import { fileState, InvoiceFields, invoiceTotal, KIND_LAYER, PaymentFields, revisions, type DocumentRecord, type Item, type Project, type Tenant } from "@1neon/domain";
import { api, openable } from "./api.ts";
import { csv } from "./csv.ts";
import type { MemberRow } from "./types.ts";


const dollars = (cents: number | undefined) => (cents === undefined ? "" : (cents / 100).toFixed(2));
/** A name safe in a zip on every system */
const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";


// --- The export -----------------------------------------------------------------------------

type Detail = { project: Project; items: Item[]; docs: DocumentRecord[] };
export type Progress = (said: string) => void;

const README = (org: Tenant, at: string, skipped: string[]) => `${org.name} (${org.clientId}): everything in 1NEON, exported ${at}

What's in this file
- organization.json: the organization, its board stages, and its signed service agreements.
- members.csv: everyone with access, their role, and whether they've joined.
- projects.csv: one row per project, with its stage, health, and dates.
- decisions.csv: every approved option, who signed, the typed name, and the reason.
- invoices.csv and payments.csv: every issued invoice and every payment recorded against one, in dollars.
- items.csv: every record on every project (requests, questions, requirements, options, tasks, updates,
  checks, handover steps, and the rest), one row each.
- <project key>/project.json: that project's complete record, every field, as 1NEON stores it.
  Issued proposals are in it as "proposal" items, each with the exact snapshot the client approved.
- <project key>/files/: the files uploaded to that project, as uploaded.
- files/: files uploaded to the organization rather than to one project.

Formats: JSON (UTF-8) and CSV (UTF-8, comma-separated, first row is the column names). Dates are ISO 8601
in UTC; amounts in CSV are dollars, and in JSON are cents ("Cents" fields).
${skipped.length ? `\nNot included (still being checked for malware, or couldn't be read; download them from Files):\n${skipped.map((s) => `- ${s}`).join("\n")}\n` : ""}`;

/** Build the zip and save it. `say` reports progress in words */
export async function exportOrganization(org: Tenant, say: Progress): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const at = new Date().toISOString();
  say("Reading projects and people…");
  const [projects, members, index] = await Promise.all([
    api<Project[]>(`/t/${org.id}/projects`),
    api<MemberRow[]>(`/t/${org.id}/members`),
    api<{ docs: DocumentRecord[] }>(`/t/${org.id}/docs`),
  ]);
  const live = projects.filter((p) => !p.deletedAt);
  const details: Detail[] = [];
  for (const [i, p] of live.entries()) {
    say(`Reading ${p.key} (${i + 1} of ${live.length})…`);
    const d = await api<{ project: Project; items: Item[]; docs: DocumentRecord[] }>(`/t/${org.id}/projects/${p.id}`);
    details.push({ project: d.project, items: d.items, docs: d.docs });
  }
  const keyOf = new Map(live.map((p) => [p.id, p.key]));

  // The organization and its people
  zip.file("organization.json", JSON.stringify({ exportedAt: at, organization: org }, null, 2));
  zip.file("members.csv", csv(members.map((m) => ({ name: m.name, email: m.email, title: m.title, access: m.access, status: m.status, invitedAt: m.invitedAt, joinedAt: m.joinedAt ?? "" })), ["name", "email", "title", "access", "status", "invitedAt", "joinedAt"]));
  zip.file("projects.csv", csv(details.map(({ project: p }) => ({ key: p.key, name: p.name, stage: org.stages.find((s) => s.id === p.stageId)?.name ?? p.stageId, health: p.health, archived: p.archived ? "yes" : "", targetDate: p.targetDate ?? "", createdAt: p.createdAt, updatedAt: p.updatedAt })), ["key", "name", "stage", "health", "archived", "targetDate", "createdAt", "updatedAt"]));

  // Decisions, invoices, payments, and every item, across projects
  const all = details.flatMap((d) => d.items.map((i) => ({ i, key: d.project.key })));
  zip.file("decisions.csv", csv(all.filter(({ i }) => i.kind === "decision").map(({ i, key }) => {
    const f = i.fields as { code?: string; approverName?: string; approvedAt?: string; reason?: string; signature?: { typedName?: string }; supersedes?: string[]; terms?: Record<string, unknown> };
    return { project: key, option: i.title.replace(/^Approved: /, ""), code: f.code ?? "", approvedBy: f.approverName ?? "", approvedAt: f.approvedAt ?? i.createdAt, signedAs: f.signature?.typedName ?? "", reason: f.reason ?? "", replacesEarlier: f.supersedes?.length ? "yes" : "", price: (f.terms as { cost?: string } | undefined)?.cost ?? "" };
  }), ["project", "option", "code", "approvedBy", "approvedAt", "signedAs", "reason", "replacesEarlier", "price"]));
  zip.file("invoices.csv", csv(all.filter(({ i }) => i.kind === "invoice" && i.status !== "draft").map(({ i, key }) => {
    const f = InvoiceFields.safeParse(i.fields).data;
    return { project: key, number: f?.number ?? "", type: f?.type ?? "", status: i.status, issuedAt: f?.issuedAt ?? "", dueDate: f?.dueDate ?? "", total: f ? dollars(invoiceTotal(f)) : "", lines: f?.lines.map((l) => `${l.text}: ${dollars(Math.round(l.qty * l.unitCents))}`).join("; ") ?? "", note: f?.note ?? "", voided: f?.voided ? `${f.voided.at} by ${f.voided.name}: ${f.voided.reason}` : "" };
  }), ["project", "number", "type", "status", "issuedAt", "dueDate", "total", "lines", "note", "voided"]));
  const invoiceNo = new Map(all.filter(({ i }) => i.kind === "invoice").map(({ i }) => [i.id, String((i.fields as { number?: string }).number ?? "")]));
  zip.file("payments.csv", csv(all.filter(({ i }) => i.kind === "payment").map(({ i, key }) => {
    const f = PaymentFields.safeParse(i.fields).data;
    return { project: key, invoice: f ? invoiceNo.get(f.invoiceId) ?? "" : "", amount: dollars(f?.amountCents), method: f?.method ?? "", reference: f?.ref ?? "", receivedAt: f?.receivedAt ?? "", status: i.status === "done" ? "received" : i.status };
  }), ["project", "invoice", "amount", "method", "reference", "receivedAt", "status"]));
  zip.file("items.csv", csv(all.map(({ i, key }) => ({ project: key, kind: i.kind, title: i.title, status: i.status, layer: KIND_LAYER[i.kind] ?? "", description: i.body, dueDate: i.dueDate ?? "", createdAt: i.createdAt, updatedAt: i.updatedAt, id: i.id })), ["project", "kind", "title", "status", "layer", "description", "dueDate", "createdAt", "updatedAt", "id"]));
  for (const d of details) {
    const proposals = revisions(d.items).map((r) => ({ number: r.p.number, rev: r.p.rev, issuedAt: r.p.issuedAt, id: r.id }));
    zip.file(`${safe(d.project.key)}/project.json`, JSON.stringify({ exportedAt: at, project: d.project, proposals, items: d.items, files: d.docs }, null, 2));
  }

  // Files, as uploaded; one that can't be read yet is listed in README.txt instead
  const files = index.docs.filter((x) => fileState(x) !== "receiving");
  const skipped: string[] = [];
  const used = new Set<string>();
  for (const [n, doc] of files.entries()) {
    say(`Adding files (${n + 1} of ${files.length})…`);
    const folder = doc.projectId ? `${safe(keyOf.get(doc.projectId) ?? "project")}/files` : "files";
    let path = `${folder}/${safe(doc.name)}`;
    for (let k = 2; used.has(path); k++) path = `${folder}/${safe(doc.name).replace(/(\.[^.]*)?$/, ` (${k})$1`)}`;
    try {
      const { url } = await api<{ url: string }>(`/t/${org.id}/docs/${doc.id}/download${doc.projectId ? `?p=${doc.projectId}` : ""}`);
      const r = await fetch(await openable(url));
      if (!r.ok) throw new Error(String(r.status));
      zip.file(path, await r.arrayBuffer());
      used.add(path);
    } catch {
      skipped.push(`${doc.projectId ? `${keyOf.get(doc.projectId) ?? ""}: ` : ""}${doc.name}`);
    }
  }
  zip.file("README.txt", README(org, at, skipped));

  say("Packing the zip…");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${safe(org.slug)}-1neon-export-${at.slice(0, 10)}.zip` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
