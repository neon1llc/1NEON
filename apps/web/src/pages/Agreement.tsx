// apps/web/src/pages/Agreement.tsx - /o/:slug/agreement: neon1's service agreement for this
// organization. Shows the current edition, who signed it and when, and lets a client admin sign it,
// once, against the exact text on screen (its hash goes with the signature).


import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Signature } from "@1neon/domain";
import { useState } from "react";
import { Link } from "react-router";
import { SignBox, signReady, type SignValue } from "../components/Billing.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { gate } from "../components/Reads.tsx";
import { useOrg, useSession, useTopBar } from "../components/Shell.tsx";
import { dateLabel, useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { problem, useRefresh } from "../lib/hooks.ts";


type AgreementResponse = { edition: string; text: string; hash: string; signed?: Signature; history: Signature[]; required: boolean };


/** The agreement, its signature, and Sign for a client admin */
export function AgreementPage() {
  const { org, access } = useOrg();
  const me = useSession();
  const toast = useToast();
  const refresh = useRefresh(org.id);
  const qc = useQueryClient();
  useTopBar(<span>Service agreement</span>, []);
  const q = useQuery({ queryKey: ["agreement", org.id], queryFn: () => api<AgreementResponse>(`/t/${org.id}/agreement`) });
  const [sign, setSign] = useState<SignValue>({ typedName: "", consent: false });
  const [busy, setBusy] = useState(false);
  const wait = gate([q]);
  if (wait || !q.data) return wait;
  const a = q.data;
  const maySign = access === "admin" && !me.operator && a.required && !a.signed;
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/t/${org.id}/agreement/sign`, { method: "POST", body: { edition: a.edition, hash: a.hash, typedName: sign.typedName.trim(), consent: sign.consent } });
      toast("Signed. Thank you; a copy is kept with your organization's records.");
    } catch (e) {
      toast(problem(e));
    }
    setBusy(false);
    // The organization's record carries the signature, which unlocks approvals everywhere
    await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ["org", org.id] })]);
    refresh();
  };
  return (
    <div className="content agreement" style={{ maxWidth: 760 }}>
      {/* Where it stands: signed (by whom, when), waiting on an admin, or not needed */}
      {a.signed ? (
        <p className="notice ok small" role="status">Signed for {org.name} by {a.signed.typedName} ({a.signed.email}) on {dateLabel(a.signed.at.slice(0, 10))}, edition {a.edition}.</p>
      ) : !a.required ? (
        <p className="notice small" role="status">neon1's own organization doesn't sign its own agreement.</p>
      ) : maySign ? (
        <p className="notice small" role="status">Please read the agreement, then sign it at the bottom. You sign it once for {org.name}, and it covers every project.</p>
      ) : (
        <p className="notice small" role="status">Waiting for an admin of {org.name} to sign.</p>
      )}
      <Markdown source={a.text} />
      {maySign && (
        <form className="card sign-card" onSubmit={(e) => { e.preventDefault(); if (signReady(sign)) void submit(); }}>
          <SignBox id="agreement-sign" value={sign} onChange={setSign} />
          <p className="small muted">Signing records your typed name, the time, and a fingerprint of this exact text (edition {a.edition}). It can't be edited afterwards.</p>
          <button className="btn btn-primary" disabled={busy || !signReady(sign)}>Sign for {org.name}</button>
        </form>
      )}
      {a.history.length > 0 && (
        <section className="kind-group">
          <h2 className="section-h">Signatures</h2>
          <ul className="small">{a.history.map((h, i) => <li key={i}>Edition {h.ref}: {h.typedName} ({h.email}), {dateLabel(h.at.slice(0, 10))} <span className="opt-code">{h.hash.slice(0, 12)}</span></li>)}</ul>
        </section>
      )}
      <p className="small muted"><Link to="/terms">Portal terms</Link> · <Link to="/privacy">Privacy</Link></p>
    </div>
  );
}
