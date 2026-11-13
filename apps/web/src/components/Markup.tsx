// apps/web/src/components/Markup.tsx - An edited copy of a proposal, side by side with what was
// issued: each change the client made, word by word, the option fields those changes map to (ready
// for neon1 to apply, or to make revised terms with when the option is already approved), and the
// rest listed for neon1 to answer by hand.


import { OptionFields, ProposalFields, proposalRef, type DocumentRecord, type Item } from "@1neon/domain";
import { useEffect, useState } from "react";
import { api, openable } from "../lib/api.ts";
import { blockParagraphs, docxParagraphs, proposalBlocks } from "../lib/docx.ts";
import { problem, useRefresh } from "../lib/hooks.ts";
import { compare, suggest, words, type Change, type OptionUpdate } from "../lib/markup.ts";
import { useOrg, useSession } from "./Shell.tsx";
import { Dialog, useToast } from "./ui.tsx";


// Lines the issued copy prints for signing, and the acceptance block a later download adds: not changes
const BOILER = /_{6,}|^Accepted in 1NEON$|approved .+ on .+\.( Initialed| Signed|$)|^Conditions: /;

/** A changed paragraph, word by word: what went struck through, what came in marked */
function Diff({ c }: { c: Change }) {
  if (c.kind === "added") return <p className="md-line"><ins>{c.after}</ins></p>;
  if (c.kind === "removed") return <p className="md-line"><del>{c.before}</del></p>;
  return <p className="md-line">{words(c.before ?? "", c.after ?? "").map((w, i) => (w.op === "same" ? <span key={i}>{w.text}</span> : w.op === "del" ? <del key={i}>{w.text}</del> : <ins key={i}>{w.text}</ins>))}</p>;
}

/** The review of one edited copy, in a dialog */
export function MarkupReview({ doc, rev, all, path, onClose }: { doc: DocumentRecord; rev: Item & { p: ProposalFields }; all: Item[]; path: string; onClose: () => void }) {
  const { org, canWrite } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const [state, setState] = useState<{ changes: Change[]; updates: OptionUpdate[]; manual: Change[] } | { error: string }>();
  // Which suggestions neon1 keeps, per option code and line; all are kept to begin with
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const ref = proposalRef(rev.p.number, rev.p.rev);
  // The option as it stands now, by its code in this revision
  const byCode = new Map(rev.p.snapshot.options.map((o) => [o.code, all.find((i) => i.id === o.id)]));

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        if (!/\.docx$/i.test(doc.name) && !/wordprocessingml/.test(doc.contentType)) throw new Error("Only Word files (.docx) can be compared. Open the file to read it; Google Docs and Pages save as .docx with File, then Download.");
        const { url } = await api<{ url: string }>(`/t/${org.id}/docs/${doc.id}/download?p=${doc.projectId}`);
        const data = await (await fetch(await openable(url))).arrayBuffer();
        const edited = await docxParagraphs(data);
        if (!edited.length) throw new Error("This file has no text 1NEON can read.");
        const printed = blockParagraphs(proposalBlocks(rev.p, rev.p.snapshot));
        const changes = compare(printed, edited).filter((c) => !BOILER.test(c.after ?? c.before ?? ""));
        const options = rev.p.snapshot.options.map((o) => {
          const now = byCode.get(o.code);
          return { code: o.code, title: now?.title ?? o.title, body: now?.body ?? o.body, fields: now ? OptionFields.parse(now.fields) : o.fields };
        });
        const { updates, manual } = suggest(changes, options);
        if (live) setState({ changes, updates, manual });
      } catch (e) {
        if (live) setState({ error: e instanceof Error ? e.message : problem(e) });
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // Apply one option's kept suggestions: straight to a draft or shared option, or, when the option is
  // approved, to a revised copy (made now, or the one already in the works)
  const apply = async (u: OptionUpdate) => {
    const opt = byCode.get(u.code);
    if (!opt) return toast("That option no longer exists.");
    const keep = u.says.filter((_, i) => !off.has(`${u.code}#${i}`));
    if (!keep.length) return toast("Nothing is checked to apply.");
    // Only the checked lines: the title, the description, and each field they set
    const fields: Record<string, unknown> = { fromMarkup: doc.id };
    let title: string | undefined;
    let body: string | undefined;
    for (const s of keep) {
      if (s.label === "Title") title = u.title;
      else if (s.label.startsWith("Description")) body = u.body;
      else for (const [k, v] of Object.entries(u.fields)) if (labelOf(k) === s.label) fields[k] = v;
    }
    setBusy(u.code);
    try {
      if (opt.status === "approved") {
        const copy = all.find((i) => i.kind === "option" && i.fields.revises === opt.id && i.status !== "approved" && i.status !== "declined");
        if (copy) await api(`${path}/items/${copy.id}`, { method: "PATCH", body: { version: copy.version, ...(title ? { title } : {}), ...(body !== undefined ? { body } : {}), fields } });
        else await api(`${path}/items`, { method: "POST", body: { kind: "option", status: "draft", title: title ?? `${opt.title} (revised)`.slice(0, 160), body: body ?? opt.body, fields: { ...OptionFields.parse(opt.fields), ...fields, revises: opt.id } } });
        toast(`Revised terms for ${u.code} ${copy ? "updated" : "drafted"}. Check them, share them, then issue r${rev.p.rev + 1}.`);
      } else {
        await api(`${path}/items/${opt.id}`, { method: "PATCH", body: { version: opt.version, ...(title ? { title } : {}), ...(body !== undefined ? { body } : {}), fields } });
        toast(`Applied to ${u.code}. Check it, then issue r${rev.p.rev + 1}.`);
      }
      refresh();
      onClose();
    } catch (e) {
      toast(problem(e));
    }
    setBusy("");
  };
  const mayApply = me.operator && canWrite;
  return (
    <Dialog open onClose={onClose} label="Changes in an edited copy" className="markup-review">
      <h2>What changed in {doc.name}</h2>
      <p className="small muted">Compared with Proposal {ref} as issued. Wording a word processor changes on its own (quotes, dashes, spacing) isn't counted.</p>
      {!state && <p className="small" role="status">Reading the file…</p>}
      {state && "error" in state && <p className="small warn-text" role="alert">{state.error}</p>}
      {state && "changes" in state && !state.changes.length && <p className="small">No changes: this copy says what Proposal {ref} says.</p>}
      {state && "updates" in state && state.updates.map((u) => {
        const opt = byCode.get(u.code);
        return (
          <section key={u.code} className="md-opt">
            <h3><span className="opt-code">{u.code}</span> {opt?.title ?? ""}{opt?.status === "approved" && <span className="tag client" style={{ marginLeft: 6 }}>approved</span>}</h3>
            <ul className="md-says">
              {u.says.map((s, i) => (
                <li key={i}>
                  <label className="md-pick">
                    {mayApply && <input type="checkbox" checked={!off.has(`${u.code}#${i}`)} onChange={(e) => { const n = new Set(off); if (e.target.checked) n.delete(`${u.code}#${i}`); else n.add(`${u.code}#${i}`); setOff(n); }} />}
                    <b>{s.label}</b>
                  </label>
                  {s.label.startsWith("Description") ? <Diff c={s.change} /> : <p className="md-line">{s.before && <del>{s.before}</del>}{s.before && " "}<ins>{s.after}</ins></p>}
                </li>
              ))}
            </ul>
            {mayApply && opt && <div className="actions"><button type="button" className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => void apply(u)}>{busy === u.code ? "Applying…" : opt.status === "approved" ? "Make revised terms with these" : `Apply to ${u.code.split("-").at(-1)}`}</button></div>}
            {mayApply && opt?.status === "approved" && <p className="small muted">{u.code} is approved, so its terms stay as signed. The revised terms go out as a new option in r{rev.p.rev + 1}, and the client approves them in its place.</p>}
          </section>
        );
      })}
      {state && "manual" in state && state.manual.length > 0 && (
        <section className="md-opt">
          <h3>{state.updates.length ? "Also changed, to answer by hand" : "Changes to answer by hand"}</h3>
          <p className="small muted">These don't map to one field of an option: a price worked out from hours, a table, the general terms, or new requests. Edit the project or the options to match, or reply in a comment, then issue r{rev.p.rev + 1}.</p>
          <ul className="md-says">{state.manual.map((c, i) => <li key={i}><b className="small">{c.opt ? `${c.opt}, ` : ""}{c.kind === "added" ? "added" : c.kind === "removed" ? "removed" : "changed"}</b><Diff c={c} /></li>)}</ul>
        </section>
      )}
      <div className="actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button></div>
    </Dialog>
  );
}

// A suggestion's label for each option field, as suggest() names them
function labelOf(k: string) {
  return ({ hours: "neon1's time", timeline: "Timeline", cost: "Price", outsideCosts: "Paid directly by you", result: "Target result", why: "Why pick it", depositPercent: "Deposit up front", recommended: "Recommended" } as Record<string, string>)[k] ?? k;
}

/** The edited copies filed against a project's proposal revisions, newest first, each with Compare */
export function MarkupList({ docs, all, path }: { docs: DocumentRecord[]; all: Item[]; path: string }) {
  const [open, setOpen] = useState<DocumentRecord>();
  const revs = new Map(all.filter((i) => i.kind === "proposal").map((i) => [i.id, i]));
  const list = docs.filter((d) => d.itemId && revs.has(d.itemId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!list.length) return null;
  const revOf = (d: DocumentRecord) => {
    const r = revs.get(d.itemId!)!;
    return { ...r, p: ProposalFields.parse(r.fields) };
  };
  return (
    <div className="small markup-list">
      <b>Edited copies</b>
      <ul>
        {list.map((d) => {
          const r = revOf(d);
          return <li key={d.id}>{d.name} <span className="muted">of r{r.p.rev}, {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> <button type="button" className="linkish" onClick={() => setOpen(d)}>See what changed</button></li>;
        })}
      </ul>
      {open && <MarkupReview doc={open} rev={revOf(open)} all={all} path={path} onClose={() => setOpen(undefined)} />}
    </div>
  );
}
