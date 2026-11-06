// Your profile: name, title, phone, theme, and signing out.
import type { User } from "@1neon/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { useSession } from "../components/Shell.tsx";
import { Avatar, useToast } from "../components/ui.tsx";
import { api, devUser, isDev } from "../lib/api.ts";
import { problem } from "../lib/hooks.ts";

export function MePage() {
  const me = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState({ name: me.user.name, title: me.user.title, phone: me.user.phone, theme: me.user.theme });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const user = await api<User>("/me", { method: "PATCH", body: { version: me.user.version, ...draft } });
      qc.setQueryData(["me"], { ...me, user });
      toast("Saved");
    } catch (e) {
      toast(problem(e));
      qc.invalidateQueries({ queryKey: ["me"] });
    }
    setBusy(false);
  };
  const signOut = async () => {
    if (isDev) {
      devUser.set("");
      location.href = "/1NEON/";
      return;
    }
    const r = await api<{ redirect: string }>("/auth/logout", { method: "POST" }).catch(() => ({ redirect: "/1NEON/" }));
    location.href = r.redirect;
  };
  return (
    <main className="content" style={{ maxWidth: 720, margin: "0 auto" }}>
      <p><Link to="/" className="small">← Back to 1NEON</Link></p>
      <h1 className="page-title" style={{ display: "flex", gap: 12, alignItems: "center" }}><Avatar id={me.user.id} name={me.user.name || me.user.email} size={40} />Your profile</h1>
      <p className="lead">{me.user.email}{me.operator ? " · neon1 operator" : ""}</p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div><label htmlFor="nm">Name</label><input id="nm" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} autoComplete="name" /></div>
        <div><label htmlFor="tt">Title</label><input id="tt" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={80} autoComplete="organization-title" /></div>
        <div><label htmlFor="ph">Mobile number (for sign-in codes by text)</label><input id="ph" type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} maxLength={32} autoComplete="tel" /></div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 8 }}>Theme</legend>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["system", "awake", "matrix"] as const).map((t) => (
              <label key={t} className={`chip${draft.theme === t ? " on" : ""}`} style={{ cursor: "pointer" }}>
                <input type="radio" name="theme" className="sr" checked={draft.theme === t} onChange={() => { setDraft({ ...draft, theme: t }); if (t === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t); }} />
                {t === "system" ? "Match my device" : t === "awake" ? "Awake (light)" : "Matrix (dark)"}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="card small" style={{ display: "grid", gap: 4 }}>
          <b>Sign-in security</b>
          <span className="muted">{me.user.strongAuth ? "You have an authenticator app or passkey. Admin actions are open to you." : "Add an authenticator app (such as Authy) or a passkey at your next sign-in. Admins need one to manage people and settings."}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </form>
    </main>
  );
}
