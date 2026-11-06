// Small shared pieces: avatars, health, the 1NEON rings mark, layer badges, toasts, conflict dialog.
import { LAYER_LETTER, LAYER_NAMES, type Health as HealthT, type Layer } from "@1neon/domain";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Avatar colors: brand greens and calm accents, all readable with white initials.
const PALETTE = ["#035704", "#1E6B8A", "#7A4FA0", "#A0522D", "#2E7D6B", "#8A6D1E", "#3D5AA8", "#9C3D54"];

/** A stable color per person, from their ID. */
export function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Up to two initials from a name or an email's local part. */
export function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** A person's initials; a ring marks someone editing right now. */
export function Avatar({ id, name, editing, size = 26 }: { id: string; name: string; editing?: boolean; size?: number }) {
  return (
    <span className={`av${editing ? " editing" : ""}`} style={{ background: colorFor(id), width: size, height: size }} title={editing ? `${name} is editing` : name} aria-label={editing ? `${name}, editing` : name} role="img">
      {initials(name)}
    </span>
  );
}

// Project health, as a colored dot plus words (never color alone).
const HEALTH_LABEL: Record<HealthT, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track", not_started: "Not started" };

/** Health as a colored dot plus its label. */
export function Health({ value }: { value: HealthT }) {
  return (
    <span className={`health h-${value}`}>
      <i aria-hidden="true" />
      {HEALTH_LABEL[value]}
    </span>
  );
}

// The four layers in order, each with its shade of green.
export const LAYERS: Layer[] = ["needs", "execution", "observation", "next"];
export const LAYER_COLOR: Record<Layer, string> = { needs: "var(--l1)", execution: "var(--l2)", observation: "var(--l3)", next: "var(--l4)" };

/** The layer's letter on its color; decorative next to the layer's name. */
export function LayerBadge({ layer }: { layer: Layer }) {
  return (
    <span className="badge" style={{ background: LAYER_COLOR[layer] }} aria-hidden="true">
      {LAYER_LETTER[layer]}
    </span>
  );
}

/** The 1NEON mark: four rings, an onion from above; the current layer is lit. */
export function Rings({ active, title }: { active?: Layer; title?: string }) {
  const r = [28, 20, 12, 4];
  return (
    <svg className="rings" viewBox="0 0 64 64" fill="none" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {LAYERS.map((l, i) => (
        <circle key={l} cx="32" cy="32" r={r[i]} stroke={active === l ? "var(--accent)" : "currentColor"} strokeOpacity={active && active !== l ? 0.3 : 1} strokeWidth={active === l ? 6 : 4} />
      ))}
    </svg>
  );
}

/** Display name for a layer. */
export function layerName(l: Layer) {
  return LAYER_NAMES[l];
}

/** "just now", "5m ago", "yesterday": relative times for activity and presence. */
export function ago(iso?: string) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Whole days since a date, for "days in stage". */
export function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
}

// --- Toasts ----------------------------------------------------------------

// One toast at a time; also announced to screen readers through a polite live region.
const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

/** Provides `useToast()`; a toast clears itself after about three seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
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

// --- Dialog ------------------------------------------------------------------

/** A native modal dialog: focus trapping, Escape, and the backdrop come from the browser. */
export function Dialog({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-label={label} onClose={onClose} onCancel={onClose}>
      {open && children}
    </dialog>
  );
}

/** Shown when a save hits a newer version: nothing is lost, the person chooses. */
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
      <div className="actions">
        <button className="btn btn-primary" onClick={onKeepMine}>Keep mine</button>
        <button className="btn btn-ghost" onClick={onTakeTheirs}>Take theirs</button>
      </div>
    </Dialog>
  );
}

/** Empty state with an optional next step. */
export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{text}</p>
      {action}
    </div>
  );
}
