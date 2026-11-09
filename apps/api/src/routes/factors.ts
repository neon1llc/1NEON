// apps/api/src/routes/factors.ts - Second steps on the person's own account: passkeys, the
// authenticator app, text-message codes, and confirming it's you for admin actions.


import { z } from "zod";
import { factorRemovedEmail, passkeyEmail } from "../emails.ts";
import { factorInventory } from "../factors.ts";
import { assurance } from "../lib/assurance.ts";
import { body, fail, now, who } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import { PENDING_TOTP_MS, PENDING_TOTP_TRIES } from "../store/repo.ts";
import { ConflictError } from "../store/types.ts";
import { confirmText, hashCode, smsFactorOn, smsReady } from "../sms.ts";
import { checkTotp, newTotp } from "../totp.ts";


// Every add, replace, or remove here follows the factor-change rule in lib/assurance.ts
export function factorRoutes(app: App, k: Kit) {
  const { d, repo, cfg } = k;
  const { tokenOf, mayChangeFactors, refreshEnrolled, factorChanged, notice, textCode, countPhoneTry, useTotpCode } = assurance(k);

  // Add a passkey, under the rule above, so someone who only got into the email can't plant their own
  app.post("/me/passkey/start", async (c) => {
    await mayChangeFactors(c);
    return c.json({ options: await d.directory.startPasskey(tokenOf(c)) });
  });

  app.post("/me/passkey/finish", async (c) => {
    const { user } = who(c);
    await mayChangeFactors(c);
    const { credential } = await body(c, z.object({ credential: z.record(z.string(), z.unknown()) }));
    await d.directory.finishPasskey(tokenOf(c), credential);
    // The hint may lose a race with another profile save; the passkey itself is already in Cognito
    await repo.saveUser({ ...user, strongAuth: true, passkey: true, version: user.version + 1, updatedAt: now(), updatedBy: user.id }, user.version).catch((e) => {
      if (!(e instanceof ConflictError)) throw e;
    });
    await repo.securityEvent(user.id, "passkey.added", "A passkey was added");
    // Tell the person by email, so a passkey they didn't add doesn't go unnoticed
    await notice(user, passkeyEmail({ url: `${cfg.publicUrl}/1NEON/me` }));
    return c.json({ ok: true });
  });

  // Authenticator app: start setup with a fresh secret and its QR code. The secret is kept as a
  // pending setup for this session only; the active authenticator, if any, keeps working until a
  // code from the new one proves it
  app.post("/me/totp/start", async (c) => {
    const { user, jti } = who(c);
    await mayChangeFactors(c);
    const prev = await repo.getPendingTotp(user.id);
    const t = await newTotp(user.email);
    const pending = { secret: t.secret, jti: jti ?? "dev", expiresAt: new Date(Date.now() + PENDING_TOTP_MS).toISOString(), attempts: 0, version: (prev?.version ?? 0) + 1 };
    try {
      await repo.savePendingTotp(user.id, pending, prev ? { version: prev.version } : { create: true });
    } catch (e) {
      if (e instanceof ConflictError) fail(409, "setup_busy", "Another setup started at the same moment. Start again.");
      throw e;
    }
    return c.json({ qr: t.qr, uri: t.uri, secret: t.secret });
  });

  // Finish setup with the first code the app shows. Each try is counted before its answer is
  // given, the new authenticator replaces any old one in the same write that ends the setup, and
  // this session counts as confirmed from then on
  app.post("/me/totp/confirm", async (c) => {
    const { user, jti } = who(c);
    const { code } = await body(c, z.object({ code: z.string().min(6).max(12) }));
    for (let tries = 0; tries < 5; tries++) {
      const p = await repo.getPendingTotp(user.id);
      // Only the session that started this setup may finish it
      if (!p || p.jti !== (jti ?? "dev")) fail(409, "no_setup", "Start authenticator setup again.");
      if (p.attempts >= PENDING_TOTP_TRIES) fail(429, "locked", "Too many wrong codes. Start authenticator setup again.");
      // Re-check the rule: a replacement still needs this session to be confirmed
      await mayChangeFactors(c);
      const step = checkTotp(p.secret, code);
      try {
        if (step === undefined) {
          await repo.savePendingTotp(user.id, { ...p, attempts: p.attempts + 1, version: p.version + 1 }, { version: p.version });
          fail(400, "wrong_code", "That code didn't match. Check the time on your phone and try the newest code.");
        }
        const active = await repo.getTotp(user.id);
        await repo.activateTotp(user.id, p, { secret: p.secret, confirmed: true, lastCounter: step, fails: 0, version: (active?.version ?? 0) + 1 }, active ? { version: active.version } : { create: true });
        const replaced = Boolean(active?.confirmed);
        // This session proved the new authenticator; a replacement then ends every other session's proof
        if (jti) await repo.saveSession(jti, user.id, true);
        if (replaced) await factorChanged(c, "totp.replaced", "The authenticator app was replaced");
        else await repo.securityEvent(user.id, "totp.added", "An authenticator app was added");
        await refreshEnrolled(user, { totp: true, sms: smsFactorOn(user), passkey: user.passkey ?? "unknown", cognitoTotp: "unknown", any: true }).catch(() => undefined);
        await notice(user, replaced ? factorRemovedEmail({ url: `${cfg.publicUrl}/1NEON/me`, what: "Your authenticator app", how: "replaced" }) : passkeyEmail({ url: `${cfg.publicUrl}/1NEON/me`, what: "An authenticator app" }));
        return c.json({ ok: true });
      } catch (e) {
        // Someone else's try or setup landed first: read again and decide afresh, never echo a row
        if (e instanceof ConflictError) continue;
        throw e;
      }
    }
    fail(429, "busy", "Too many tries at once. Wait a moment and try again.");
  });

  // Text-message codes: a code texted to the verified number confirms it's you, with the same standing
  // as a passkey or authenticator app. Turning them on follows the rule above; the number must
  // already be proved with a texted code, so nobody can point them at a number they don't hold
  app.post("/me/text-factor", async (c) => {
    const { user } = who(c);
    if (!d.texter) fail(503, "texts_unavailable", "Texts aren't available yet. Email notices still work.");
    if (!smsReady(user)) fail(409, "number_unverified", "Confirm your number with a texted code first, under Notifications.");
    if (smsFactorOn(user)) return c.json({ ok: true });
    await mayChangeFactors(c);
    const fresh = (await repo.getUser(user.id))!;
    await repo.saveUser({ ...fresh, smsFactorAt: now(), strongAuth: true, version: fresh.version + 1, updatedAt: now(), updatedBy: user.id }, fresh.version);
    await repo.securityEvent(user.id, "sms.added", "Text-message codes were turned on");
    await notice(user, passkeyEmail({ url: `${cfg.publicUrl}/1NEON/me`, what: "Text-message confirmation" }));
    return c.json({ ok: true });
  });

  // Turn text codes off; needs a confirmed session, and other sessions lose their confirmation
  app.delete("/me/text-factor", async (c) => {
    const { user, actor } = who(c);
    if (!actor.strongSession) fail(403, "strong_auth_required", "Confirm it's you first.");
    const fresh = (await repo.getUser(user.id))!;
    await repo.saveUser({ ...fresh, smsFactorAt: undefined, version: fresh.version + 1, updatedAt: now(), updatedBy: user.id }, fresh.version);
    await factorChanged(c, "sms.removed", "Text-message codes were turned off");
    const after = (await repo.getUser(user.id))!;
    await refreshEnrolled(after, await factorInventory(repo, d.directory, after, tokenOf(c))).catch(() => undefined);
    await notice(user, factorRemovedEmail({ url: `${cfg.publicUrl}/1NEON/me`, what: "Text-message confirmation", how: "removed" }));
    return c.json({ ok: true });
  });

  // Text a code to confirm it's you
  app.post("/me/confirm/text", async (c) => {
    const { user } = who(c);
    if (!smsFactorOn(user)) fail(409, "no_text_factor", "Turn on text codes on your profile first.");
    await textCode(user, "SMSCONFIRM", user.smsPhone!, confirmText);
    return c.json({ ok: true });
  });

  // Confirm it's you with an authenticator code, or with a texted code (via: "text"): this session
  // can then use admin actions. Five wrong app codes lock it for 15 minutes, and a code can't be used
  // twice; a texted code has five tries and ten minutes, and is used up by a match
  app.post("/me/confirm", async (c) => {
    const { user, jti } = who(c);
    const { code, via } = await body(c, z.object({ code: z.string().min(6).max(12), via: z.enum(["app", "text"]).default("app") }));
    if (via === "text") {
      if (!smsFactorOn(user)) fail(409, "no_text_factor", "Turn on text codes on your profile first.");
      const k = { PK: `USER#${user.id}`, SK: "SMSCONFIRM" };
      const row = await countPhoneTry(k);
      if (row.hash !== (await hashCode(user.id, code)) || row.phone !== user.smsPhone) fail(400, "wrong_code", "That code didn't match. Check the newest text.");
      await repo.table.write([{ delete: k }]);
      if (jti) await repo.saveSession(jti, user.id, true);
      return c.json({ ok: true });
    }
    const verdict = await useTotpCode(user.id, code);
    if (verdict === "none") fail(409, "no_totp", "Set up an authenticator app on your profile first.");
    if (verdict === "locked") fail(429, "locked", "Too many wrong codes. Try again in 15 minutes.");
    if (verdict === "busy") fail(429, "busy", "Too many tries at once. Wait a moment and try again.");
    if (verdict !== "ok") fail(400, "wrong_code", verdict === "wrong" ? "That code didn't match. Try the newest one." : "That code was already used. Wait for the next one.");
    if (jti) await repo.saveSession(jti, user.id, true);
    return c.json({ ok: true });
  });

  // Remove the authenticator app; needs a confirmed session. Other sessions lose their confirmation
  app.delete("/me/totp", async (c) => {
    const { user, actor } = who(c);
    if (!actor.strongSession) fail(403, "strong_auth_required", "Confirm it's you first.");
    await repo.deleteTotp(user.id);
    await factorChanged(c, "totp.removed", "The authenticator app was removed");
    await refreshEnrolled(user, await factorInventory(repo, d.directory, user, tokenOf(c))).catch(() => undefined);
    await notice(user, factorRemovedEmail({ url: `${cfg.publicUrl}/1NEON/me`, what: "Your authenticator app", how: "removed" }));
    return c.json({ ok: true });
  });
}
