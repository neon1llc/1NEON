// apps/web/src/components/RowMenu.tsx - A row's quiet "more" menu: a small dots button at the end of a
// list row that opens a short list of actions. It stays faint until the row is hovered or focused,
// so the actions are there when wanted without drawing the eye to them.


import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";


/** One action in the menu */
export interface RowAction {
  label: string;
  run: () => void;
}

/** The dots button and its menu; `label` names the row for screen readers ("More for FLOW-1") */
export function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Any click outside, or Escape, closes it; Escape hands focus back to the button
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    addEventListener("pointerdown", out);
    addEventListener("keydown", key);
    // The first action takes focus, so the keyboard can go straight on
    wrap.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => { removeEventListener("pointerdown", out); removeEventListener("keydown", key); };
  }, [open]);

  return (
    <div className={`row-menu${open ? " open" : ""}`} ref={wrap}>
      <button ref={button} type="button" className="row-menu-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="row-menu-list" role="menu">
          {actions.map((a) => (
            <button key={a.label} type="button" role="menuitem" onClick={() => { setOpen(false); a.run(); }}>{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
