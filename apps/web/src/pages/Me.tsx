// apps/web/src/pages/Me.tsx - Your profile: name, title, phone, theme, menu, and notices (saved together),
// then two-step verification, the tutorial, and signing out (each takes effect right away).


import type { User } from "@1neon/domain";
import type { SmsState } from "../lib/types.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { applyTheme, useSession, useTopBar } from "../components/Shell.tsx";
import { Avatar, useAsk, useToast } from "../components/ui.tsx";
import { api, BASE_PATH, devUser, LIVE, pickPerson } from "../lib/api.ts";
import { menuOf, NOTIFY_GROUPS } from "@1neon/domain";
import { problem } from "../lib/hooks.ts";
import { passkeyCreation } from "../lib/passkey.ts";
import { useHelp } from "../components/Help.tsx";
import { askToConfirm, TotpSetup } from "../components/Confirm.tsx";


// What the profile says under the text consent for each state
const SMS_NOTE: Record<SmsState, string> = {
  unavailable: "Texts aren't switched on for 1NEON yet. Email notices work now.",
  no_number: "",
  not_agreed: "",
  opted_out: "You replied STOP, so texts are off. Tick the box and save to turn them back on.",
  unverified: "One more step: we text a code to this number to make sure it's yours. Texts start after that.",
  ready: "Texts are on for this number.",
};


// The signed-in person's own profile, outside any organization
export function MePage() {
  const me = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // A link to a part of the profile (#security, #notifications) lands on it
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [hash]);
  const toast = useToast();
  const ask = useAsk();
  const help = useHelp();
  const [totpOpen, setTotpOpen] = useState(false);
  useTopBar(<span>Your profile</span>, []);
  // Edits stay local until Save
  const [draft, setDraft] = useState({ name: me.user.name, title: me.user.title, phone: me.user.phone, theme: me.user.theme, menu: menuOf(me.user.menu), notify: me.user.notify ?? {}, smsConsent: Boolean(me.user.smsConsentAt) });
  const [busy, setBusy] = useState(false);
  // Anything that differs from what's saved; Save waits for a change
  const saved = { name: me.user.name, title: me.user.title, phone: me.user.phone, theme: me.user.theme, menu: menuOf(me.user.menu), notify: me.user.notify ?? {}, smsConsent: Boolean(me.user.smsConsentAt) };
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  // A previewed theme that was never saved goes back to the saved one on leaving the page
  const savedTheme = useRef(me.user.theme);
  savedTheme.current = me.user.theme;
  useEffect(() => () => applyTheme(savedTheme.current), []);
  // The phone check: a code is texted, then typed here
  const [code, setCode] = useState<string | undefined>(undefined);
  const sms = me.sms?.state ?? "unavailable";
  // A saved change to the number or consent matters before a code makes sense
  const smsDirty = draft.phone !== me.user.phone || draft.smsConsent !== Boolean(me.user.smsConsentAt);
  const sendCode = async () => {
    try {
      await api("/me/phone/verify", { method: "POST", body: {} });
      setCode("");
      toast("Code sent. It's good for 10 minutes.");
    } catch (e) {
      toast(problem(e));
    }
  };
  const checkCode = async () => {
    try {
      await api("/me/phone/confirm", { method: "POST", body: { code } });
      setCode(undefined);
      toast("Number confirmed. Texts are on.");
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast(problem(e));
    }
  };
  // Save the profile; the theme applies immediately and is kept with the account
  const save = async () => {
    setBusy(true);
    try {
      const user = await api<User>("/me", { method: "PATCH", body: { version: me.user.version, ...draft } });
      qc.setQueryData(["me"], { ...me, user });
      // The text state depends on what was saved; read it back fresh
      qc.invalidateQueries({ queryKey: ["me"] });
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
      toast("Passkey added. Use it whenever 1NEON asks you to confirm it's you.");
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast(e instanceof DOMException ? "The passkey wasn't made. Try again when you're ready." : problem(e));
    }
  };
  // Text codes: on once the number is proved; off needs a confirmed session (the API asks)
  const textFactor = async (on: boolean) => {
    if (!on && !(await ask({ title: "Turn off text codes?", body: "You'll confirm it's you with a passkey or your authenticator app instead.", yes: "Turn off", danger: true }))) return;
    try {
      await api("/me/text-factor", { method: on ? "POST" : "DELETE", body: on ? {} : undefined });
      toast(on ? "Text codes are on. Use one whenever 1NEON asks you to confirm it's you." : "Text codes are off.");
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast(problem(e));
    }
  };
  // Remove the authenticator app (the API asks to confirm first when needed)
  const removeTotp = async () => {
    if (!(await ask({ title: "Remove the authenticator app?", body: "Its codes stop working for your account. You can set it up again any time.", yes: "Remove", danger: true }))) return;
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
    // The live playback's story lives in this page, so signing out stays in it, at the sign-in
    if (LIVE) {
      devUser.set("");
      qc.clear();
      navigate("/");
      return;
    }
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
        {/* Menu: default opens it from the menu buttons; mini also keeps a slim icon menu on screen */}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 8 }}>Menu</legend>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["default", "mini"] as const).map((m) => (
              <label key={m} className={`chip${draft.menu === m ? " on" : ""}`} style={{ cursor: "pointer" }}>
                <input type="radio" name="menu" className="sr" checked={draft.menu === m} onChange={() => setDraft({ ...draft, menu: m })} />
                {m === "default" ? "Default" : "Mini"}
              </label>
            ))}
          </div>
          <p className="muted small" style={{ margin: "6px 0 0" }}>{draft.menu === "mini" ? "A slim menu of icons stays on the left. The menu button opens the full menu over it." : "The menu button opens the full menu. A tap outside it, or the button again, closes it."}</p>
        </fieldset>
        {/* Notifications: every kind shows under the bell; choose which also email you */}
        <div className="card small notify" id="notifications">
          <b>Notifications</b>
          <span className="muted">Everything shows under the bell. Choose what also reaches you by email or text. Important ones email you to start.</span>
          {/* Texts need a mobile number and a clear yes, worded the way carriers require */}
          {draft.phone.trim() ? (
            <label className="sms-consent">
              <input type="checkbox" checked={draft.smsConsent} onChange={(e) => setDraft({ ...draft, smsConsent: e.target.checked })} />
              <span>
                <b>Text me at {draft.phone.trim()}</b> with 1NEON project notices from neon1 LLC, for the kinds I choose below.
                <span className="muted"> Texts are optional and not required to use 1NEON. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. See the <Link to="/privacy">Privacy policy</Link> and <Link to="/terms">Terms</Link>.</span>
              </span>
            </label>
          ) : (
            <span className="muted">To get texts, add a phone number above.</span>
          )}
          {/* Where texts stand once saved, and the code check that turns them on */}
          {!smsDirty && SMS_NOTE[sms] && <span className={`muted sms-${sms}`} role="status">{SMS_NOTE[sms]}</span>}
          {!smsDirty && sms === "unverified" && (code === undefined
            ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => void sendCode()}>Text me a code</button>
            : (
              <span className="sms-code">
                <label htmlFor="smscode">Code from the text</label>
                <input id="smscode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (code.length === 6) void checkCode(); } }} />
                <button className="btn btn-primary btn-sm" type="button" disabled={code.length !== 6} onClick={() => void checkCode()}>Confirm</button>
                <button className="linkish small" type="button" onClick={() => void sendCode()}>Send another</button>
              </span>
            ))}
          {smsDirty && (draft.smsConsent || draft.phone !== me.user.phone) && draft.phone.trim() && <span className="muted">Save first, then confirm the number with a texted code.</span>}
          <table className="notify-table">
            <thead><tr><th scope="col">When</th><th scope="col">Email</th><th scope="col">Text</th></tr></thead>
            <tbody>
              {NOTIFY_GROUPS.map((g) => {
                // Text switches open once there's a number and a yes to texts
                const texts = draft.smsConsent && Boolean(draft.phone.trim());
                // The saved choice, or the group's default
                const cur = draft.notify[g.id] ?? { email: g.email, sms: false };
                const set = (patch: Partial<typeof cur>) => setDraft({ ...draft, notify: { ...draft.notify, [g.id]: { ...cur, ...patch } } });
                return (
                  <tr key={g.id}>
                    <th scope="row"><span>{g.label}{g.level === "critical" && <span className="tag rec">important</span>}</span><span className="muted">{g.hint}</span></th>
                    <td><input type="checkbox" aria-label={`Email me: ${g.label}`} checked={cur.email} onChange={(e) => set({ email: e.target.checked })} /></td>
                    <td><input type="checkbox" aria-label={`Text me: ${g.label}`} checked={texts && cur.sms} disabled={!texts} onChange={(e) => set({ sms: e.target.checked })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Save covers everything above; it opens only when something changed */}
        <div className="actions">
          <button className="btn btn-primary" disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</button>
          {dirty && <span className="muted small" role="status">Unsaved changes</span>}
        </div>
      </form>
      {/* Everything below takes effect right away, so it sits outside the profile form */}
      <div className="form" style={{ marginTop: 28 }}>
        {/* Two-step verification: any one of these confirms it's you before admin actions */}
        <div className="card small security" data-tour="passkey" id="security">
          <b>Two-step verification</b>
          <span className="muted">Inviting people, changing access, and changing settings ask you to confirm it's you. Any one of these works; a second is a backup if you lose the first.</span>
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
            {/* Text codes go only to the number proved under Notifications, and only once texting is live */}
            <li>
              <span><b>Text message</b><br /><span className="muted">
                {sms === "unavailable" ? "A 6-digit code by text. Available once 1NEON texting is switched on."
                  : me.factors?.sms || sms === "ready" ? <>A 6-digit code texted to {me.user.phone}.</>
                  : <>A 6-digit code by text. First <a href="#notifications">confirm your number</a> under Notifications.</>}
              </span></span>
              {me.factors?.sms ? <span className="tag client">on</span> : null}
              {me.factors?.sms
                ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => void textFactor(false)}>Turn off</button>
                : <button className="btn btn-ghost btn-sm" type="button" disabled={sms !== "ready"} onClick={() => void textFactor(true)}>Turn on</button>}
            </li>
          </ul>
          <span className="muted">
            {me.strongSession ? "This session is confirmed. Admin actions are open." : me.factors?.any ? <>To use admin actions, <button type="button" className="link" onClick={askToConfirm}>confirm it's you</button>.</> : "Add one of these to use admin actions."}
          </span>
        </div>
        {/* The tutorial: replay the welcome tour, or read the FAQs */}
        <div className="card small" style={{ display: "grid", gap: 8, justifyItems: "start" }}>
          <b>Tutorial</b>
          <span className="muted">A 1-minute tour of where things are. Each page also has its own guide under ?.</span>
          <div className="actions">
            <button className="btn btn-ghost" type="button" onClick={help.welcomeTour}>Replay the tour</button>
            <Link className="btn btn-ghost" to="/faqs">FAQs</Link>
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>
      {/* The authenticator setup has its own form, so it lives outside the profile form: Enter there
          checks the code instead of saving the profile */}
      <TotpSetup open={totpOpen} onClose={() => setTotpOpen(false)} onDone={() => { setTotpOpen(false); qc.invalidateQueries({ queryKey: ["me"] }); }} />
    </div>
  );
}
