// apps/web/src/components/Confirm.tsx - "Confirm it's you": a passkey or an authenticator code turns
// this session into one that can use admin actions. Opens by itself when the API asks for it, and
// holds the authenticator app setup used on the profile.


import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  return (
    <Dialog open={open} onClose={() => setOpen(false)} label="Confirm it's you">
      <p className="eyebrow">One more step</p>
      <h2>Confirm it's you</h2>
      <p className="muted">Inviting people and changing settings need a second check.</p>
      {!f?.passkey && !f?.totp && (
        <p>Add a passkey or an authenticator app on <Link to="/me" onClick={() => setOpen(false)}>your profile</Link> first. It takes a minute.</p>
      )}
      <div className="form" style={{ gap: 12 }}>
        {f?.passkey && <button className="btn btn-primary" disabled={busy} onClick={() => void byPasskey()}>Use my passkey</button>}
        {f?.totp && (
          <form className="actions" onSubmit={(e) => { e.preventDefault(); void byCode(); }}>
            <input aria-label="Code from your authenticator app" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(cleanCode(e.target.value))} style={{ maxWidth: 160 }} />
            <button className="btn btn-ghost" disabled={busy || code.length < 6}>Confirm</button>
          </form>
        )}
      </div>
    </Dialog>
  );
}


/** Authenticator app setup: scan the QR code (or type the key), then enter the first code */
export function TotpSetup({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [setup, setSetup] = useState<{ qr: string; secret: string; uri: string }>();
  const [code, setCode] = useState("");
  // A fresh secret each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setSetup(undefined);
    setCode("");
    api<{ qr: string; secret: string; uri: string }>("/me/totp/start", { method: "POST", body: {} })
      .then(setSetup)
      .catch((e) => { toast(problem(e)); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const confirm = async () => {
    try {
      await api("/me/totp/confirm", { method: "POST", body: { code } });
      toast("Authenticator app added.");
      onDone();
    } catch (e) {
      toast(problem(e));
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
      <form className="actions" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
        <input aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(cleanCode(e.target.value))} style={{ maxWidth: 160 }} />
        <button className="btn btn-primary" disabled={!setup || code.length < 6}>Turn on</button>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
      </form>
    </Dialog>
  );
}
