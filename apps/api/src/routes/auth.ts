// apps/api/src/routes/auth.ts - Sign-in through Cognito: Managed Login redirects, the on-page sign-in
// steps, and logout. Public routes; createApp registers them before the identity middleware.


import { z } from "zod";
import type { Verified } from "../auth.ts";
import { factorInventory } from "../factors.ts";
import { assurance } from "../lib/assurance.ts";
import { body, fail } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";


export function authRoutes(app: App, k: Kit) {
  const { d, repo } = k;
  const { refreshEnrolled } = assurance(k);

  /** After any sign-in: invite check, link the Cognito identity, refresh strong sign-in */
  async function admit(r: Verified | undefined): Promise<"ok" | "failed" | "not_invited"> {
    if (!r || !r.emailVerified) return "failed";
    // Invite only: a verified email must already belong to an invited person
    const uid = await repo.userIdForEmail(r.email);
    if (!uid) return "not_invited";
    // Remember which Cognito identity (email code, passkey, or Google) maps to this person
    await repo.linkSubject(r.sub, uid);
    // Admin actions trust this session only if it signed in with a passkey, and only for a while
    if (r.jti) await repo.saveSession(r.jti, uid, r.method === "passkey");
    const user = await repo.getUser(uid);
    // Refresh the profile's display hint of enrolled factors. An unknown lookup keeps what we knew,
    // and the app's own authenticator always counts, so an email sign-in can't erase enrollment
    if (user) await refreshEnrolled(user, await factorInventory(repo, d.directory, user, r.accessToken)).catch(() => undefined);
    return "ok";
  }

  // Managed Login: Google goes straight to Google; anything else is the auth.neon1.tech fallback
  app.get("/auth/login", async (c) => {
    // Local dev has no Cognito; the demo account buttons stand in for sign-in
    if (!d.auth) return c.redirect("/1NEON/");
    const provider = c.req.query("provider") === "google" ? "Google" : undefined;
    return d.auth.login(c, c.req.query("email"), provider);
  });

  app.get("/auth/callback", async (c) => {
    if (!d.auth) return c.redirect("/1NEON/");
    const result = await admit(await d.auth.callback(c));
    return c.redirect(result === "ok" ? "/1NEON/" : `/1NEON/?signin=${result}`);
  });

  // On-page sign-in: each call returns the next step; "done" means the cookies are set
  const SignInBody = z.discriminatedUnion("op", [
    z.object({ op: z.literal("start"), email: z.string().trim().toLowerCase().email().max(254), remember: z.boolean().default(true), prefer: z.enum(["passkey"]).optional() }),
    z.object({ op: z.literal("choose"), method: z.enum(["code", "passkey"]) }),
    z.object({ op: z.literal("answer"), kind: z.enum(["code", "totp", "passkey"]), value: z.string().min(1).max(20000) }),
  ]);
  app.post("/auth/step", async (c) => {
    if (!d.auth) fail(404, "not_found", "Sign-in runs through the demo accounts locally.");
    const b = await body(c, SignInBody);
    const r = b.op === "start" ? await d.auth.start(c, b.email, b.remember, b.prefer) : b.op === "choose" ? await d.auth.choose(c, b.method) : await d.auth.answer(c, b.kind, b.value);
    if (r.next.step !== "done") return c.json({ ...r.next, wrong: "wrong" in r ? r.wrong : undefined });
    const result = await admit("verified" in r ? r.verified : undefined);
    // Not invited: drop the cookies Cognito's tokens just set
    if (result !== "ok") await d.auth.logout(c);
    return c.json(result === "ok" ? { step: "done" } : { step: result });
  });

  // Revoke the refresh token, clear cookies, and send the browser to Cognito's logout
  app.post("/auth/logout", async (c) => {
    // Forget this session's admin assurance first; its last access token may still be valid for minutes
    const ident = d.auth ? await d.auth.identify(c).catch(() => undefined) : undefined;
    if (ident?.jti) await repo.deleteSession(ident.jti).catch(() => undefined);
    const url = d.auth ? await d.auth.logout(c) : "/1NEON/";
    return c.json({ redirect: url });
  });
}
