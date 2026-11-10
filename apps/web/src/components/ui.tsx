// apps/web/src/components/ui.tsx - Small shared pieces: avatars, health, the 1NEON rings mark,
// layer badges, toasts, the are-you-sure dialog, conflict dialog.


import { LAYER_LETTER, LAYER_NAMES, type Health as HealthT, type Layer } from "@1neon/domain";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";


// Avatar colors: brand greens and calm accents, all readable with white initials
const PALETTE = ["#035704", "#1E6B8A", "#7A4FA0", "#A0522D", "#2E7D6B", "#8A6D1E", "#3D5AA8", "#9C3D54"];


/** A stable color per person, from their ID */
export function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}


/** Up to two initials from a name or an email's local part */
export function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}


/** A person's initials; a ring marks someone editing right now */
export function Avatar({ id, name, editing, size = 26 }: { id: string; name: string; editing?: boolean; size?: number }) {
  return (
    <span className={`av${editing ? " editing" : ""}`} style={{ background: colorFor(id), width: size, height: size }} title={editing ? `${name} is editing` : name} aria-label={editing ? `${name}, editing` : name} role="img">
      {initials(name)}
    </span>
  );
}


// Project health, as a colored dot plus words (never color alone). The stored "not_started" reads as
// Not assessed: health is the team's call, and starting work doesn't make a project on track
const HEALTH_LABEL: Record<HealthT, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track", not_started: "Not assessed" };


/** Health as a colored dot plus its label */
export function Health({ value }: { value: HealthT }) {
  return (
    <span className={`health h-${value}`}>
      <i aria-hidden="true" />
      {HEALTH_LABEL[value]}
    </span>
  );
}


// The four layers in order, each with its shade of green
export const LAYERS: Layer[] = ["needs", "execution", "observation", "next"];
// Each layer's word in addresses is the name people see (/execute, /normalize); the stored keys
// (execution, next) still resolve, so older links and emails keep working
const SLUG: Record<Layer, string> = { needs: "needs", execution: "execute", observation: "observe", next: "normalize" };
/** The address word for a layer */
export const layerSlug = (l: Layer) => SLUG[l];
/** The layer an address word names, by its word or its stored key */
export const layerFromSlug = (s?: string): Layer | undefined => LAYERS.find((l) => SLUG[l] === s || l === s);
export const LAYER_COLOR: Record<Layer, string> = { needs: "var(--l1)", execution: "var(--l2)", observation: "var(--l3)", next: "var(--l4)" };


/** The layer's letter on its color; decorative next to the layer's name */
export function LayerBadge({ layer }: { layer: Layer }) {
  return (
    <span className="badge" style={{ background: LAYER_COLOR[layer] }} aria-hidden="true">
      {LAYER_LETTER[layer]}
    </span>
  );
}


/** The 1NEON mark: four rings, an onion from above, Needs at the core and each layer one ring out; the current layer is lit */
export function Rings({ active, title }: { active?: Layer; title?: string }) {
  const r = [4, 12, 20, 28];
  return (
    <svg className="rings" viewBox="0 0 64 64" fill="none" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {LAYERS.map((l, i) => (
        <circle key={l} cx="32" cy="32" r={r[i]} stroke={active === l ? "var(--accent)" : `var(--l${i + 1})`} strokeOpacity={active && active !== l ? 0.3 : 1} strokeWidth={active === l ? 6 : 4} />
      ))}
    </svg>
  );
}


/**
 * How far along each layer is: [done, total] per layer, counting only what can be finished, so every
 * layer can reach full. Each work item counts once, done when checked off. A project's options count
 * together as one need, the choice, done once one is approved (the others are alternatives, not
 * leftovers). Decisions and status updates are records, so they don't count
 */
export function layerProgress(items: { kind: string; status: string }[], layerOf: (kind: string) => Layer | undefined): Record<Layer, [number, number]> {
  const out = { needs: [0, 0], execution: [0, 0], observation: [0, 0], next: [0, 0] } as Record<Layer, [number, number]>;
  const options = items.filter((i) => i.kind === "option");
  for (const i of items) {
    const l = layerOf(i.kind);
    if (!l || i.kind === "decision" || i.kind === "update" || i.kind === "option") continue;
    out[l][1]++;
    if (i.status === "done") out[l][0]++;
  }
  const ol = layerOf("option");
  if (options.length && ol) {
    out[ol][1]++;
    if (options.some((o) => o.status === "approved")) out[ol][0]++;
  }
  return out;
}


/** The onion as a progress chart: each layer's ring fills clockwise as its items get done, Needs at the core */
export function OnionProgress({ progress, size = 40 }: { progress: Record<Layer, [number, number]>; size?: number }) {
  const r = [6, 13, 20, 27];
  const label = LAYERS.map((l) => `${layerName(l)}: ${progress[l][0]} of ${progress[l][1]} done`).join(". ");
  return (
    <svg className="onion-progress" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={label}>
      <title>{label}</title>
      {LAYERS.map((l, i) => {
        const [done, total] = progress[l];
        const c = 2 * Math.PI * r[i]!;
        const part = total ? done / total : 0;
        return (
          <g key={l}>
            <circle cx="32" cy="32" r={r[i]} fill="none" stroke="var(--line)" strokeWidth="5" />
            {part > 0 && <circle cx="32" cy="32" r={r[i]} fill="none" stroke={`var(--l${i + 1})`} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * part} ${c}`} transform="rotate(-90 32 32)" />}
          </g>
        );
      })}
    </svg>
  );
}


/** A measure over time: readings as a line from the baseline, with the target as a dashed line */
export function Trend({ baseline, target, readings, unit }: { baseline?: number; target?: number; readings: { at: string; value: number }[]; unit?: string }) {
  const values = [...(baseline !== undefined ? [baseline] : []), ...readings.map((r) => r.value)];
  if (values.length < 2 && target === undefined) return null;
  const all = [...values, ...(target !== undefined ? [target] : [])];
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const W = 200, H = 48, pad = 4;
  const x = (i: number) => pad + (values.length > 1 ? (i / (values.length - 1)) * (W - pad * 2) : W / 2);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - pad * 2);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values.at(-1);
  const label = `From ${values[0]} to ${last}${unit ? ` ${unit}` : ""}${target !== undefined ? `, target ${target}` : ""}`;
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {target !== undefined && <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="var(--accent)" strokeDasharray="4 4" strokeWidth="1.5" opacity=".6" />}
      {values.length > 1 && <path d={line} fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      {/* The latest point: a zero-length round-capped stroke stays round when the chart stretches */}
      {last !== undefined && <path d={`M${x(values.length - 1).toFixed(1)},${y(last).toFixed(1)} l0.01,0`} stroke="var(--accent)" strokeWidth="8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}


/** Display name for a layer */
export function layerName(l: Layer) {
  return LAYER_NAMES[l];
}


// The plain meaning beside each branded layer name, wherever layers are a way to navigate
const LAYER_HINTS: Record<Layer, string> = { needs: "What you need", execution: "Work in progress", observation: "Results", next: "Handover and care" };

/** A layer's plain subtitle: Needs is "What you need", Normalize is "Handover and care" */
export function layerHint(l: Layer) {
  return LAYER_HINTS[l];
}


/** "just now", "5m ago", "yesterday": relative times for activity and presence */
export function ago(iso?: string) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}


/** A calendar date for people: "Dec 9", with the year when it isn't this year ("Jan 4, 2027").
 * Date-only strings are read as UTC, so they never shift a day by time zone */
export function dateLabel(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: iso.length === 10 ? "UTC" : undefined });
}


/** Whole days since a date, for "days in stage" */
export function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
}


// --- Toasts ----------------------------------------------------------------


// One toast at a time; also announced to screen readers through a polite live region
const ToastCtx = createContext<(msg: string) => void>(() => undefined);
// Show a short message; outside the provider it does nothing
export const useToast = () => useContext(ToastCtx);


/** Provides `useToast()`; a toast clears itself after about three seconds */
export function ToastProvider({ children }: { children: ReactNode }) {
  // A new toast replaces the current one and restarts its timer
  const [msg, setMsg] = useState<string>();
  const timer = useRef<number>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(undefined), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" className="sr">{msg}</div>
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}


// --- Are you sure? ----------------------------------------------------------


/** What an "are you sure" step says: the question, what happens, and the two buttons' words */
export interface Ask {
  title: string;
  body?: string;
  yes: string;
  no?: string;
  // A destructive yes (delete, remove, turn off) shows in red
  danger?: boolean;
}
const AskCtx = createContext<(a: Ask) => Promise<boolean>>(async () => false);
/** Ask before something that can't be undone; resolves true only on the yes button */
export const useAsk = () => useContext(AskCtx);


/** Provides `useAsk()`: one in-page dialog for every confirmation, in place of the browser's own */
export function AskProvider({ children }: { children: ReactNode }) {
  const [asking, setAsking] = useState<Ask & { answer: (yes: boolean) => void }>();
  const ask = useCallback((a: Ask) => new Promise<boolean>((answer) => setAsking({ ...a, answer })), []);
  // Any way out but the yes button (No, Escape, the backdrop) is a no
  const close = (yes: boolean) => {
    asking?.answer(yes);
    setAsking(undefined);
  };
  return (
    <AskCtx.Provider value={ask}>
      {children}
      <Dialog open={Boolean(asking)} onClose={() => close(false)} label={asking?.title ?? "Are you sure?"} className="ask">
        <h2>{asking?.title}</h2>
        {asking?.body && <p className="muted small">{asking.body}</p>}
        {/* The safe answer takes focus, so Enter never deletes by accident */}
        <div className="actions">
          <button className={`btn ${asking?.danger ? "btn-danger" : "btn-primary"}`} onClick={() => close(true)}>{asking?.yes}</button>
          <button className="btn btn-ghost" onClick={() => close(false)} autoFocus>{asking?.no ?? "Cancel"}</button>
        </div>
      </Dialog>
    </AskCtx.Provider>
  );
}


// --- Dialog ------------------------------------------------------------------


/** A native modal dialog: focus trapping, Escape, and the backdrop come from the browser */
export function Dialog({ open, onClose, children, label, className }: { open: boolean; onClose: () => void; children: ReactNode; label: string; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    // A tap on the backdrop (the dialog element itself, outside its content) closes it. React passes a
    // nested dialog's close and cancel up to this one, so only this dialog's own events count
    <dialog ref={ref} aria-label={label} className={className} onClose={(e) => e.target === e.currentTarget && onClose()} onCancel={(e) => e.target === e.currentTarget && onClose()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      {open && <div className="dlg">{children}</div>}
    </dialog>
  );
}


/** Shown when a save hits a newer version: nothing is lost, the person chooses */
export function ConflictDialog({
  open,
  who,
  fields,
  onKeepMine,
  onTakeTheirs,
  onClose,
}: {
  open: boolean;
  who: string;
  fields: { label: string; mine: string; theirs: string }[];
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} label="Someone else changed this">
      {/* Side by side, field by field, so the person can compare before choosing */}
      <h2>{who} changed this while you were editing</h2>
      <p className="muted small">Your text is kept. Choose which version to save.</p>
      {fields.map((f) => (
        <div className="diff" key={f.label}>
          <div>
            <b>Yours · {f.label}</b>
            {f.mine || <span className="muted">(empty)</span>}
          </div>
          <div>
            <b>Theirs · {f.label}</b>
            {f.theirs || <span className="muted">(empty)</span>}
          </div>
        </div>
      ))}
      {/* Keep mine saves again over the newer version; take theirs drops the local edit */}
      <div className="actions">
        <button className="btn btn-primary" onClick={onKeepMine}>Keep mine</button>
        <button className="btn btn-ghost" onClick={onTakeTheirs}>Take theirs</button>
      </div>
    </Dialog>
  );
}


/** Empty state with an optional next step */
export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{text}</p>
      {action}
    </div>
  );
}


// Line icons for the menu, drawn on one 24px grid with one stroke so they line up
const ICONS = {
  workspace: "M4 11 12 4l8 7M6 9.5V20h12V9.5",
  workflow: "M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z",
  projects: "M3 7h7l2 2h9v10H3z",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M21 20c0-2.6-1.6-4.9-4-5.7",
  documents: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4",
  insights: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  // neon1's mark: two arches of nested arcs falling into columns, on its own 64px grid
  site: "M6 6a24 24 0 0 1 24 24v30M6 18a12 12 0 0 1 12 12v30M34 6a24 24 0 0 1 24 24v30M34 18a12 12 0 0 1 12 12v30",
} as const;
export type IconName = keyof typeof ICONS;


/** A menu icon in its rounded box, the same size as the layer badges */
export function Icon({ name }: { name: IconName }) {
  return (
    <span className="ico" aria-hidden="true">
      <svg viewBox={name === "site" ? "0 0 64 64" : "0 0 24 24"} strokeWidth={name === "site" ? 5 : undefined}><path d={ICONS[name]} /></svg>
    </span>
  );
}
