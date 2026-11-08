// apps/api/src/auth.ts - Sign-in, finished server side. Email codes and passkeys run on the 1NEON
// page through Cognito's choice-based sign-in; Managed Login with authorization code + PKCE stays
// for Google and as a fallback. Tokens live only in HttpOnly cookies scoped to the API path; the
// SPA never sees them.


import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  type AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "./config.ts";


// Cookie names; the __Secure- prefix makes browsers refuse them over plain HTTP
export const COOKIE = { access: "__Secure-1neon_at", refresh: "__Secure-1neon_rt", flow: "__Secure-1neon_flow", step: "__Secure-1neon_step", remember: "__Secure-1neon_rm" } as const;


/** Where an on-page sign-in stands: waiting for a code, a passkey, a method choice, or done */
export type SignInStep =
  | { step: "choose"; methods: ("code" | "passkey")[] }
  | { step: "code" }
  | { step: "totp" }
  | { step: "passkey"; options: unknown }
  | { step: "done" }
  | { step: "failed" };


// A finished sign-in, before the invite check
export interface Verified {
  sub: string;
  email: string;
  emailVerified: boolean;
  accessToken: string;
  // The token family this sign-in started; refreshes keep it
  jti?: string;
  // How this sign-in was proved; only a passkey counts as strong
  method: Method;
}


// The ways a sign-in can finish
export type Method = "passkey" | "code" | "totp" | "hosted";


// A verified caller: the Cognito subject, plus the email when the ID token supplied it
export interface Identity {
  sub: string;
  email?: string;
  // origin_jti: ties the caller to the session record made at sign-in
  jti?: string;
}


// PKCE and state values travel in URLs, so they use base64url
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64url");


// Unguessable state and verifier values from the platform CSPRNG
function randomString(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}


// PKCE S256 challenge for a verifier
async function sha256(s: string) {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}


// Managed Login flow and cookie handling for one user pool and app client
export class CognitoAuth {
  // Verifiers cache the pool's signing keys between requests
  private access;
  private idt;
  // Choice-based sign-in calls; the public client needs no AWS credentials for them
  private idp = new CognitoIdentityProviderClient({});

  // Both verifiers are pinned to this pool and app client
  constructor(private cfg: Required<Pick<Config, "userPoolId" | "clientId" | "authDomain" | "publicUrl">>) {
    this.access = CognitoJwtVerifier.create({ userPoolId: cfg.userPoolId, tokenUse: "access", clientId: cfg.clientId });
    this.idt = CognitoJwtVerifier.create({ userPoolId: cfg.userPoolId, tokenUse: "id", clientId: cfg.clientId });
  }

  // HttpOnly, Strict, and scoped to the API path, so page scripts never see a token
  private cookieOpts(maxAge: number) {
    return { httpOnly: true, secure: true, sameSite: "Strict" as const, path: "/1NEON/api", maxAge };
  }

  // Same cookie, but gone when the browser closes. Access tokens last 15 minutes anyway, and a
  // closed browser with Remember me comes back through the refresh cookie
  private sessionOnly() {
    return { ...this.cookieOpts(0), maxAge: undefined };
  }

  // Must match a callback URL registered on the app client
  get redirectUri() {
    return `${this.cfg.publicUrl}/1NEON/api/auth/callback`;
  }

  /** Who is calling, or undefined. Expired access tokens are refreshed transparently */
  async identify(c: Context): Promise<Identity | undefined> {
    const token = getCookie(c, COOKIE.access);
    if (token) {
      try {
        const p = await this.access.verify(token);
        return { sub: p.sub, jti: p.origin_jti as string | undefined };
      } catch {
        /* fall through to refresh */
      }
    }
    // No valid access token: try the refresh token once
    const refresh = getCookie(c, COOKIE.refresh);
    if (!refresh) return undefined;
    const tokens = await this.token({ grant_type: "refresh_token", refresh_token: refresh });
    if (!tokens?.access_token) return undefined;
    // A token that fails verification reads as signed out, not as a server error
    const p = await this.access.verify(tokens.access_token).catch(() => undefined);
    if (!p) return undefined;
    // The renewed access cookie is session-only, like the first; Remember me rides on the refresh cookie alone
    setCookie(c, COOKIE.access, tokens.access_token, this.sessionOnly());
    return { sub: p.sub, jti: p.origin_jti as string | undefined };
  }

  /** The caller's current access token, for Cognito calls made on their behalf (passkeys) */
  accessToken(c: Context) {
    return getCookie(c, COOKIE.access);
  }

  /** GET /auth/login: start Managed Login with PKCE; `hint` pre-fills the email, `provider` skips straight to it */
  async login(c: Context, hint?: string, provider?: string) {
    const verifier = randomString(48);
    const state = randomString(16);
    setCookie(c, COOKIE.flow, `${state}.${verifier}`, { ...this.cookieOpts(600), sameSite: "Lax" });
    // State and verifier ride in a short-lived Lax cookie so the redirect back can read them
    const q = new URLSearchParams({
      response_type: "code",
      client_id: this.cfg.clientId,
      redirect_uri: this.redirectUri,
      scope: "openid email profile aws.cognito.signin.user.admin",
      state,
      code_challenge: await sha256(verifier),
      code_challenge_method: "S256",
    });
    if (hint) q.set("login_hint", hint);
    if (provider) q.set("identity_provider", provider);
    return c.redirect(`https://${this.cfg.authDomain}/oauth2/authorize?${q}`);
  }

  /** GET /auth/callback: exchange the code, set cookies, return the verified identity */
  async callback(c: Context): Promise<Verified | undefined> {
    const [state, verifier] = (getCookie(c, COOKIE.flow) ?? "").split(".");
    deleteCookie(c, COOKIE.flow, { path: "/1NEON/api", secure: true });
    // The state must match the cookie, which blocks forged callbacks
    const code = c.req.query("code");
    if (!code || !state || !verifier || c.req.query("state") !== state) return undefined;
    const tokens = await this.token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: this.redirectUri });
    return this.finish(c, "hosted", tokens?.access_token, tokens?.id_token, tokens?.refresh_token);
  }

  // Sets the session cookies from fresh tokens; the ID token carries the email the invite check needs
  private async finish(c: Context, method: Method, access?: string, idToken?: string, refresh?: string): Promise<Verified | undefined> {
    if (!access || !idToken) return undefined;
    const id = await this.idt.verify(idToken);
    const at = await this.access.verify(access);
    // Remember me (the default) keeps the refresh cookie 30 days; without it the refresh cookie ends
    // with the browser. The access cookie always does, so a refresh can't make it outlive the choice
    const forget = getCookie(c, COOKIE.remember) === "0";
    deleteCookie(c, COOKIE.remember, { path: "/1NEON/api", secure: true });
    setCookie(c, COOKIE.access, access, this.sessionOnly());
    if (refresh) setCookie(c, COOKIE.refresh, refresh, forget ? this.sessionOnly() : this.cookieOpts(30 * 24 * 3600));
    return { sub: id.sub, email: String(id.email ?? "").toLowerCase(), emailVerified: String(id.email_verified) === "true", accessToken: access, jti: at.origin_jti as string | undefined, method };
  }

  // --- On-page sign-in: Cognito's session token waits in an HttpOnly cookie between steps ---

  // The email and Cognito session for the sign-in in progress; five minutes, like Cognito's own
  private keep(c: Context, email: string, session?: string) {
    if (session) setCookie(c, COOKIE.step, `${encodeURIComponent(email)}|${session}`, this.cookieOpts(300));
  }
  private held(c: Context) {
    const [email, session] = (getCookie(c, COOKIE.step) ?? "").split("|");
    return email && session ? { email: decodeURIComponent(email), session } : undefined;
  }

  // Turns Cognito's answer into the next step for the page, keeping its session for the step after
  private async next(c: Context, email: string, method: Method, r: { ChallengeName?: string; Session?: string; ChallengeParameters?: Record<string, string>; AvailableChallenges?: string[]; AuthenticationResult?: AuthenticationResultType }): Promise<{ next: SignInStep; verified?: Verified }> {
    if (r.AuthenticationResult) {
      deleteCookie(c, COOKIE.step, { path: "/1NEON/api", secure: true });
      const v = await this.finish(c, method, r.AuthenticationResult.AccessToken, r.AuthenticationResult.IdToken, r.AuthenticationResult.RefreshToken);
      return v ? { next: { step: "done" }, verified: v } : { next: { step: "failed" } };
    }
    this.keep(c, email, r.Session);
    switch (r.ChallengeName) {
      case "EMAIL_OTP":
        return { next: { step: "code" } };
      case "SOFTWARE_TOKEN_MFA":
        return { next: { step: "totp" } };
      case "WEB_AUTHN":
        return { next: { step: "passkey", options: JSON.parse(r.ChallengeParameters?.CREDENTIAL_REQUEST_OPTIONS ?? "{}") } };
      case "SELECT_CHALLENGE": {
        const have = r.AvailableChallenges ?? [];
        const methods = [...(have.includes("WEB_AUTHN") ? ["passkey" as const] : []), ...(have.includes("EMAIL_OTP") ? ["code" as const] : [])];
        // Only a code on offer: send it straight away
        if (methods.length === 1 && methods[0] === "code") return this.choose(c, "code");
        return { next: { step: "choose", methods } };
      }
      default:
        return { next: { step: "failed" } };
    }
  }

  /** POST /auth/start: begin with an email; Cognito answers the same way whether or not it knows the person */
  async start(c: Context, email: string, remember = true, prefer?: "passkey") {
    // Held for the steps to come, like Cognito's own session
    setCookie(c, COOKIE.remember, remember ? "1" : "0", this.cookieOpts(300));
    // Confirming with a passkey asks Cognito for it straight away, skipping the choice
    const params: Record<string, string> = { USERNAME: email, ...(prefer === "passkey" ? { PREFERRED_CHALLENGE: "WEB_AUTHN" } : {}) };
    const r = await this.idp.send(new InitiateAuthCommand({ ClientId: this.cfg.clientId, AuthFlow: "USER_AUTH", AuthParameters: params }));
    return this.next(c, email, prefer === "passkey" ? "passkey" : "code", r);
  }

  /** POST /auth/choose: pick a code by email or a passkey */
  async choose(c: Context, method: "code" | "passkey") {
    const h = this.held(c);
    if (!h) return { next: { step: "failed" } as SignInStep };
    const r = await this.idp.send(new RespondToAuthChallengeCommand({
      ClientId: this.cfg.clientId,
      ChallengeName: "SELECT_CHALLENGE",
      Session: h.session,
      ChallengeResponses: { USERNAME: h.email, ANSWER: method === "code" ? "EMAIL_OTP" : "WEB_AUTHN" },
    }));
    return this.next(c, h.email, method === "passkey" ? "passkey" : "code", r);
  }

  /** POST /auth/answer: the emailed code, an authenticator code, or the passkey's signed response */
  async answer(c: Context, kind: "code" | "totp" | "passkey", value: string) {
    const h = this.held(c);
    if (!h) return { next: { step: "failed" } as SignInStep };
    const challenge = kind === "code" ? "EMAIL_OTP" : kind === "totp" ? "SOFTWARE_TOKEN_MFA" : "WEB_AUTHN";
    const field = kind === "code" ? "EMAIL_OTP_CODE" : kind === "totp" ? "SOFTWARE_TOKEN_MFA_CODE" : "CREDENTIAL";
    try {
      const r = await this.idp.send(new RespondToAuthChallengeCommand({
        ClientId: this.cfg.clientId,
        ChallengeName: challenge,
        Session: h.session,
        ChallengeResponses: { USERNAME: h.email, [field]: value },
      }));
      return this.next(c, h.email, kind, r);
    } catch (e) {
      // A wrong code keeps the step; anything else ends it
      const name = (e as { name?: string }).name;
      if (name === "CodeMismatchException") return { next: { step: kind === "totp" ? "totp" : "code" } as SignInStep, wrong: true };
      return { next: { step: "failed" } as SignInStep };
    }
  }

  /** POST /auth/logout: revoke the refresh token and clear cookies */
  async logout(c: Context) {
    const refresh = getCookie(c, COOKIE.refresh);
    if (refresh) {
      await fetch(`https://${this.cfg.authDomain}/oauth2/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh, client_id: this.cfg.clientId }),
      }).catch(() => undefined);
    }
    // Clear our cookies, then send the browser to Cognito to end its session too
    for (const name of [COOKIE.access, COOKIE.refresh]) deleteCookie(c, name, { path: "/1NEON/api", secure: true });
    const q = new URLSearchParams({ client_id: this.cfg.clientId, logout_uri: `${this.cfg.publicUrl}/1NEON/` });
    return `https://${this.cfg.authDomain}/logout?${q}`;
  }

  // Token endpoint call; any failure reads as signed out
  private async token(params: Record<string, string>) {
    const r = await fetch(`https://${this.cfg.authDomain}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.cfg.clientId, ...params }),
    });
    if (!r.ok) return undefined;
    return (await r.json()) as { access_token?: string; id_token?: string; refresh_token?: string };
  }
}
