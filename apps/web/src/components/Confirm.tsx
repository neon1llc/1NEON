// apps/web/src/components/Confirm.tsx - "Confirm it's you": a passkey, an authenticator code, or a
// texted code turns this session into one that can use admin actions. Opens by itself when the API asks for it, and
// holds the authenticator app setup used on the profile.


import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { problem } from "../lib/hooks.ts";
import { passkeyAssertion } from "../lib/passkey.ts";
import { cleanCode } from "../lib/signin.ts";
import type { Me } from "../lib/types.ts";
import { Dialog, useToast } from "./ui.tsx";


/** Open the confirm dialog from anywhere */
export const askToConfirm = () => dispatchEvent(new CustomEvent("1neon:confirm"));


/** Confirm with a passkey: a fresh passkey sign-in for the same email, which marks the session strong */
export async function confirmWithPasskey(email: string) {
  const r = await api<{ step: string; options?: unknown }>("/auth/step", { method: "POST", body: { op: "start", email, prefer: "passkey" } });
  if (r.step !== "passkey") throw new Error("This account has no passkey yet.");
  const credential = await passkeyAssertion(r.options as Parameters<typeof passkeyAssertion>[0]);
  const done = await api<{ step: string }>("/auth/step", { method: "POST", body: { op: "answer", kind: "passkey", value: credential } });
  if (done.step !== "done") throw new Error("The passkey wasn't accepted. Try again.");
}


/** The dialog itself; the frame mounts it once */
export function ConfirmDialog({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // A texted code: asked for, then typed (its own field, so it never mixes with the app's code)
  const [texted, setTexted] = useState<string | undefined>(undefined);
  // The API's "needs a confirmed session" answer opens it
  useEffect(() => {
    const show = () => setOpen(true);
    addEventListener("1neon:confirm", show);
    return () => removeEventListener("1neon:confirm", show);
  }, []);
  const f = me.factors;
  // Either way, the session is confirmed and the person tries the action again
  const finish = () => {
    setOpen(false);
    setCode("");
    setTexted(undefined);
    qc.invalidateQueries({ queryKey: ["me"] });
    toast("Confirmed. Try that again.");
  };
  const byPasskey = async () => {
    setBusy(true);
    try {
      await confirmWithPasskey(me.user.email);
      finish();
    } catch (e) {
      toast(e instanceof DOMException ? "The passkey wasn't used. Try again when you're ready." : problem(e));
    }
    setBusy(false);
  };
  const byCode = async () => {
    setBusy(true);
    try {
      await api("/me/confirm", { method: "POST", body: { code } });
      finish();
    } catch (e) {
      toast(problem(e));
    }
    setBusy(false);
  };
  // Text a code to the verified number
  const sendText = async () => {
    setBusy(true);
    try {
      await api("/me/confirm/text", { method: "POST", body: {} });
      setTexted("");
      toast("Code sent. It's good for 10 minutes.");
    } catch (e) {
      toast(problem(e));
    }
    setBusy(false);
  };
  const byText = async () => {
    setBusy(true);
    try {
      await api("/me/confirm", { method: "POST", body: { code: texted, via: "text" } });
      finish();
    } catch (e) {
      toast(problem(e));
    }
    setBusy(false);
  };
  return (
    <Dialog open={open} onClose={() => setOpen(false)} label="Confirm it's you">
      <p className="eyebrow">One more step</p>
      <h2>Confirm it's you</h2>
      <p className="muted">Inviting people, changing access, and changing settings need a second check.</p>
      {!f?.passkey && !f?.totp && !f?.sms && (
        <p>Add a passkey, an authenticator app, or text codes on <Link to="/me" onClick={() => setOpen(false)}>your profile</Link> first. It takes a minute.</p>
      )}
      <div className="form" style={{ gap: 12 }}>
        {f?.passkey && <button className="btn btn-primary" disabled={busy} onClick={() => void byPasskey()}>Use my passkey</button>}
        {f?.totp && (
          <form className="actions" onSubmit={(e) => { e.preventDefault(); void byCode(); }}>
            <input aria-label="Code from your authenticator app" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(cleanCode(e.target.value))} style={{ maxWidth: 160 }} />
            <button className="btn btn-ghost" disabled={busy || code.length < 6}>Confirm</button>
          </form>
        )}
        {f?.sms && (texted === undefined
          ? <button className="btn btn-ghost" disabled={busy} onClick={() => void sendText()}>Text me a code</button>
          : (
            <form className="actions" onSubmit={(e) => { e.preventDefault(); void byText(); }}>
              <input aria-label="Code from the text" inputMode="numeric" autoComplete="one-time-code" placeholder="Code from the text" value={texted} onChange={(e) => setTexted(cleanCode(e.target.value))} style={{ maxWidth: 180 }} autoFocus />
              <button className="btn btn-ghost" disabled={busy || texted.length < 6}>Confirm</button>
              <button className="linkish small" type="button" disabled={busy} onClick={() => void sendText()}>Send another</button>
            </form>
          ))}
      </div>
    </Dialog>
  );
}


/** Authenticator app setup: scan the QR code (or type the key), then enter the first code */
export function TotpSetup({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [setup, setSetup] = useState<{ qr: string; secret: string; uri: string }>();
  const [code, setCode] = useState("");
  // What went wrong, kept in the dialog beside the code until the next try (AP-09), not a passing toast
  const [error, setError] = useState("");
  // Each opening is a generation: a start or confirm reply that belongs to an earlier opening (Cancel,
  // then open again) is ignored, success and failure alike, so the dialog only ever shows its own
  // setup (AI-01). The server keeps one pending secret per person, so the newest start is the one in force
  const generation = useRef(0);
  useEffect(() => {
    const mine = ++generation.current;
    setSetup(undefined);
    setCode("");
    setError("");
    if (!open) return;
    api<{ qr: string; secret: string; uri: string }>("/me/totp/start", { method: "POST", body: {} })
      .then((s) => { if (generation.current === mine) setSetup(s); })
      .catch((e) => { if (generation.current === mine) setError(`${problem(e)} Close this and choose Set up again.`); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Its own pending state, apart from the profile's Save, so a slow check can't be sent twice
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (busy) return;
    const mine = generation.current;
    setBusy(true);
    setError("");
    try {
      await api("/me/totp/confirm", { method: "POST", body: { code } });
      if (generation.current !== mine) return;
      toast("Authenticator app added.");
      onDone();
    } catch (e) {
      if (generation.current === mine) setError(problem(e));
    } finally {
      if (generation.current === mine) setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} label="Add an authenticator app">
      <h2>Add an authenticator app</h2>
      <ol className="howto">
        <li>Open an authenticator app, such as Google Authenticator, Microsoft Authenticator, 1Password, or Authy.</li>
        <li>Scan this code. On a phone, tap <b>Open in app</b> instead.</li>
        <li>Type the 6-digit code it shows.</li>
      </ol>
      {setup ? (
        <div className="totp">
          <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} />
          <div>
            <a className="btn btn-ghost btn-sm" href={setup.uri}>Open in app</a>
            <p className="small muted">Or type this key: <code className="key">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></p>
          </div>
        </div>
      ) : <p className="muted" aria-busy="true">Making your code…</p>}
      {/* A submit here stops at this form: React bubbles events through portals, so without the stop
          an enclosing form (the profile) would submit too */}
      <form className="actions" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void confirm(); }}>
        <input aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(cleanCode(e.target.value))} style={{ maxWidth: 160 }} aria-invalid={error ? true : undefined} aria-describedby={error ? "totp-error" : undefined} />
        <button className="btn btn-primary" disabled={!setup || code.length < 6 || busy}>{busy ? "Checking…" : "Turn on"}</button>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
      </form>
      {error && <p id="totp-error" className="notice" role="alert">{error}</p>}
    </Dialog>
  );
}
