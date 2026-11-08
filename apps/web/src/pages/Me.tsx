// apps/web/src/pages/Me.tsx - Your profile: name, title, phone, theme, menu, and signing out.


import type { User } from "@1neon/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { applyTheme, useSession, useTopBar } from "../components/Shell.tsx";
import { Avatar, useToast } from "../components/ui.tsx";
import { api, BASE_PATH, devUser, pickPerson } from "../lib/api.ts";
import { NOTIFY_GROUPS } from "@1neon/domain";
import { problem } from "../lib/hooks.ts";
import { passkeyCreation } from "../lib/passkey.ts";
import { useHelp } from "../components/Help.tsx";
import { askToConfirm, TotpSetup } from "../components/Confirm.tsx";


// The signed-in person's own profile, outside any organization
export function MePage() {
  const me = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const help = useHelp();
  const [totpOpen, setTotpOpen] = useState(false);
  useTopBar(<span>Your profile</span>, []);
  // Edits stay local until Save
  const [draft, setDraft] = useState({ name: me.user.name, title: me.user.title, phone: me.user.phone, theme: me.user.theme, menu: me.user.menu ?? "rail", notify: me.user.notify ?? {} });
  const [busy, setBusy] = useState(false);
  // Save the profile; the theme applies immediately and is kept with the account
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
  // Make a passkey on this device and register it with the account
  const addPasskey = async () => {
    try {
      const { options } = await api<{ options: Parameters<typeof passkeyCreation>[0] }>("/me/passkey/start", { method: "POST", body: {} });
      const credential = await passkeyCreation(options);
      await api("/me/passkey/finish", { method: "POST", body: { credential } });
      toast("Passkey added. Sign in with it next time to use admin actions.");
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast(e instanceof DOMException ? "The passkey wasn't made. Try again when you're ready." : problem(e));
    }
  };
  // Remove the authenticator app (the API asks to confirm first when needed)
  const removeTotp = async () => {
    if (!confirm("Remove the authenticator app from your account?")) return;
    try {
      await api("/me/totp", { method: "DELETE" });
      toast("Authenticator app removed.");
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast(problem(e));
    }
  };
  // Dev and demo: forget who you picked. Production: the API revokes tokens and returns Cognito's logout URL
  const signOut = async () => {
    if (pickPerson) {
      devUser.set("");
      location.href = `${BASE_PATH}/`;
      return;
    }
    const r = await api<{ redirect: string }>("/auth/logout", { method: "POST" }).catch(() => ({ redirect: "/1NEON/" }));
    location.href = r.redirect;
  };
  return (
    <div style={{ maxWidth: 720 }}>
      {/* Who this is */}
      <h1 className="page-title" style={{ display: "flex", gap: 12, alignItems: "center" }}><Avatar id={me.user.id} name={me.user.name || me.user.email} size={40} />Your profile</h1>
      <p className="lead">{me.user.email}{me.operator ? " · neon1 operator" : ""}</p>
      {/* Name, title, and mobile number */}
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div><label htmlFor="nm">Name</label><input id="nm" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} autoComplete="name" /></div>
        <div><label htmlFor="tt">Title</label><input id="tt" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={80} autoComplete="organization-title" /></div>
        <div><label htmlFor="ph">Phone (only you see it)</label><input id="ph" type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} maxLength={32} autoComplete="tel" /></div>
        {/* Theme previews immediately; Save keeps it with the account */}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 8 }}>Theme</legend>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["awake", "matrix", "device"] as const).map((t) => (
              <label key={t} className={`chip${draft.theme === t ? " on" : ""}`} style={{ cursor: "pointer" }}>
                <input type="radio" name="theme" className="sr" checked={draft.theme === t} onChange={() => { setDraft({ ...draft, theme: t }); applyTheme(t); }} />
                {t === "device" ? "Match my device" : t === "awake" ? "Awake (light)" : "Matrix (dark)"}
              </label>
            ))}
          </div>
        </fieldset>
        {/* Menu: the icon rail stays on screen, or pages get the full width behind a menu button */}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 8 }}>Menu</legend>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["rail", "hidden"] as const).map((m) => (
              <label key={m} className={`chip${draft.menu === m ? " on" : ""}`} style={{ cursor: "pointer" }}>
                <input type="radio" name="menu" className="sr" checked={draft.menu === m} onChange={() => setDraft({ ...draft, menu: m })} />
                {m === "rail" ? "Always showing" : "Behind a menu button"}
              </label>
            ))}
          </div>
        </fieldset>
        {/* Notifications: every kind shows under the bell; choose which also email you */}
        <div className="card small notify" id="notifications">
          <b>Notifications</b>
          <span className="muted">Everything shows under the bell. Choose what also reaches you by email. Important ones start on.</span>
          <table className="notify-table">
            <thead><tr><th scope="col">When</th><th scope="col">Email</th><th scope="col">Text <span className="tag">soon</span></th></tr></thead>
            <tbody>
              {NOTIFY_GROUPS.map((g) => {
                // The saved choice, or the group's default
                const cur = draft.notify[g.id] ?? { email: g.email, sms: false };
                const set = (patch: Partial<typeof cur>) => setDraft({ ...draft, notify: { ...draft.notify, [g.id]: { ...cur, ...patch } } });
                return (
                  <tr key={g.id}>
                    <th scope="row"><span>{g.label}{g.level === "critical" && <span className="tag rec">important</span>}</span><span className="muted">{g.hint}</span></th>
                    <td><input type="checkbox" aria-label={`Email me: ${g.label}`} checked={cur.email} onChange={(e) => set({ email: e.target.checked })} /></td>
                    <td><input type="checkbox" aria-label={`Text me: ${g.label} (coming soon)`} checked={false} disabled /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Strong sign-in status: admins need it for people and settings */}
        <div className="card small security" data-tour="passkey">
          <b>Sign-in security</b>
          <span className="muted">Inviting people and changing settings need a second check: a passkey or an authenticator app. Set up both if you like.</span>
          <ul className="factors">
            <li>
              <span><b>Passkey</b><br /><span className="muted">Your face, fingerprint, or device PIN. Works on iPhone, Android, Mac, and Windows.</span></span>
              {me.factors?.passkey ? <span className="tag client">on</span> : null}
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => void addPasskey()}>{me.factors?.passkey ? "Add another" : "Add"}</button>
            </li>
            <li>
              <span><b>Authenticator app</b><br /><span className="muted">A 6-digit code from Google Authenticator, Authy, or similar.</span></span>
              {me.factors?.totp ? <span className="tag client">on</span> : null}
              {me.factors?.totp
                ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => void removeTotp()}>Remove</button>
                : <button className="btn btn-ghost btn-sm" type="button" onClick={() => setTotpOpen(true)}>Set up</button>}
            </li>
          </ul>
          <span className="muted">
            {me.strongSession ? "This session is confirmed. Admin actions are open." : me.factors?.any ? <>To use admin actions, <button type="button" className="link" onClick={askToConfirm}>confirm it's you</button>.</> : "Add one of these to use admin actions."}
          </span>
        </div>
        <TotpSetup open={totpOpen} onClose={() => setTotpOpen(false)} onDone={() => { setTotpOpen(false); qc.invalidateQueries({ queryKey: ["me"] }); }} />
        {/* The tutorial: replay the welcome tour, or read the FAQs */}
        <div className="card small" style={{ display: "grid", gap: 8, justifyItems: "start" }}>
          <b>Tutorial</b>
          <span className="muted">A 1-minute tour of where things are. Each page also has its own guide under ?.</span>
          <div className="actions">
            <button className="btn btn-ghost" type="button" onClick={help.welcomeTour}>Replay the tour</button>
            <Link className="btn btn-ghost" to="/faqs">FAQs</Link>
          </div>
        </div>
        {/* Save, and sign out */}
        <div className="actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </form>
    </div>
  );
}
