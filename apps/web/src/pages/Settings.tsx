// apps/web/src/pages/Settings.tsx - Settings: the organization's details and its workflow stages.


import type { Layer, Stage, Tenant } from "@1neon/domain";
import { useState } from "react";
import { useOrg, useTopBar } from "../components/Shell.tsx";
import { LayerBadge, LAYERS, layerName, useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { problem } from "../lib/hooks.ts";
import { useQueryClient } from "@tanstack/react-query";


// Organization details for everyone; stage editing for admins
export function Settings() {
  const { org, summary, canAdmin, access } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  // A working copy of the stages, saved all at once
  const [stages, setStages] = useState<Stage[]>(org.stages);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useTopBar(<span>{org.name} · Settings</span>, [org.name]);
  // Unsaved changes enable Save and Undo
  const dirty = JSON.stringify(stages) !== JSON.stringify(org.stages);
  // Change one field of one stage in the working copy
  const set = (i: number, patch: Partial<Stage>) => setStages(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  // Reorder stages; the board's columns follow this order
  const move = (i: number, d: number) => {
    const next = stages.slice();
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s!);
    setStages(next);
  };
  // Save every stage at once against the organization's version; the API refuses removing a stage in use
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await api<Tenant>(`/t/${org.id}/stages`, { method: "PUT", body: { version: org.version, stages } });
      qc.setQueryData(["org", summary.id], { org: next, access });
      toast("Workflow saved");
    } catch (e) {
      setError(problem(e));
    }
    setBusy(false);
  };
  return (
    <>
      <h1 className="page-title">Settings</h1>
      {/* The organization's handles and the caller's access */}
      <div className="card" style={{ display: "grid", gap: 6, maxWidth: 520 }}>
        <div><span className="muted small">Organization</span> <b>{org.name}</b></div>
        <div><span className="muted small">Client ID</span> <span className="mono">{org.clientId}</span></div>
        <div><span className="muted small">Address</span> <span className="mono">neon1.tech/1NEON/o/{org.slug}</span></div>
        <div><span className="muted small">Your access</span> <span className="tag">{access}</span></div>
      </div>
      <h2 className="section-h">Workflow stages <small>the columns on the board</small></h2>
      {!canAdmin && <p className="muted small">Only admins can change stages.</p>}
      {/* One row per stage: name, layer, exit rule, limit, and order controls; phones stack each stage as a card */}
      <div className="stages">
        {stages.map((s, i) => (
          <div key={s.id} className={`stage${s.hidden ? " off" : ""}`}>
            <input aria-label={`Name of stage ${i + 1}`} value={s.name} disabled={!canAdmin} onChange={(e) => set(i, { name: e.target.value })} maxLength={40} />
            <select aria-label={`Layer of ${s.name}`} value={s.layer} disabled={!canAdmin} onChange={(e) => set(i, { layer: e.target.value as Layer })}>
              {LAYERS.map((l) => <option key={l} value={l}>{layerName(l)}</option>)}
            </select>
            <input aria-label={`Done when, for ${s.name}`} placeholder="Done when…" value={s.exit} disabled={!canAdmin} onChange={(e) => set(i, { exit: e.target.value })} maxLength={200} />
            <input aria-label={`Limit for ${s.name}`} placeholder="Limit" inputMode="numeric" value={s.wipLimit ?? ""} disabled={!canAdmin} onChange={(e) => set(i, { wipLimit: e.target.value ? Math.max(1, Math.min(99, Number(e.target.value) || 1)) : undefined })} />
            <span className="ctl">
              <LayerBadge layer={s.layer} />
              {canAdmin && (
                <>
                  <button className="chip" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${s.name} up`}>↑</button>
                  <button className="chip" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${s.name} down`}>↓</button>
                  <button className="chip" onClick={() => set(i, { hidden: !s.hidden })}>{s.hidden ? "Show" : "Hide"}</button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
      {/* Save and undo, with the strong sign-in requirement spelled out */}
      {canAdmin && (
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save workflow"}</button>
          {dirty && <button className="btn btn-ghost" onClick={() => setStages(org.stages)}>Undo changes</button>}
          <span className="muted small">Saving needs a passkey sign-in. Add one on your profile.</span>
        </div>
      )}
      {error && <p className="notice" role="alert">{error}</p>}
    </>
  );
}
