// apps/api/src/auth.ts - Sign-in: Cognito Managed Login with authorization code + PKCE, finished
// server side. Tokens live only in HttpOnly cookies scoped to the API path; the SPA never sees
// them.


import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "./config.ts";


// Cookie names; the __Secure- prefix makes browsers refuse them over plain HTTP
export const COOKIE = { access: "__Secure-1neon_at", refresh: "__Secure-1neon_rt", flow: "__Secure-1neon_flow" } as const;


// A verified caller: the Cognito subject, plus the email when the ID token supplied it
export interface Identity {
  sub: string;
  email?: string;
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

  // Both verifiers are pinned to this pool and app client
  constructor(private cfg: Required<Pick<Config, "userPoolId" | "clientId" | "authDomain" | "publicUrl">>) {
    this.access = CognitoJwtVerifier.create({ userPoolId: cfg.userPoolId, tokenUse: "access", clientId: cfg.clientId });
    this.idt = CognitoJwtVerifier.create({ userPoolId: cfg.userPoolId, tokenUse: "id", clientId: cfg.clientId });
  }

  // HttpOnly, Strict, and scoped to the API path, so page scripts never see a token
  private cookieOpts(maxAge: number) {
    return { httpOnly: true, secure: true, sameSite: "Strict" as const, path: "/1NEON/api", maxAge };
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
        return { sub: p.sub };
      } catch {
        /* fall through to refresh */
      }
    }
    // No valid access token: try the refresh token once
    const refresh = getCookie(c, COOKIE.refresh);
    if (!refresh) return undefined;
    const tokens = await this.token({ grant_type: "refresh_token", refresh_token: refresh });
    if (!tokens?.access_token) return undefined;
    setCookie(c, COOKIE.access, tokens.access_token, this.cookieOpts(15 * 60));
    const p = await this.access.verify(tokens.access_token);
    return { sub: p.sub };
  }

  /** GET /auth/login: start Managed Login with PKCE; `hint` pre-fills the email */
  async login(c: Context, hint?: string) {
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
    return c.redirect(`https://${this.cfg.authDomain}/oauth2/authorize?${q}`);
  }

  /** GET /auth/callback: exchange the code, set cookies, return the verified identity */
  async callback(c: Context): Promise<{ sub: string; email: string; emailVerified: boolean; accessToken: string } | undefined> {
    const [state, verifier] = (getCookie(c, COOKIE.flow) ?? "").split(".");
    deleteCookie(c, COOKIE.flow, { path: "/1NEON/api", secure: true });
    // The state must match the cookie, which blocks forged callbacks
    const code = c.req.query("code");
    if (!code || !state || !verifier || c.req.query("state") !== state) return undefined;
    const tokens = await this.token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: this.redirectUri });
    if (!tokens?.id_token || !tokens.access_token) return undefined;
    // The ID token carries the email the invite check needs
    const id = await this.idt.verify(tokens.id_token);
    setCookie(c, COOKIE.access, tokens.access_token, this.cookieOpts(15 * 60));
    if (tokens.refresh_token) setCookie(c, COOKIE.refresh, tokens.refresh_token, this.cookieOpts(30 * 24 * 3600));
    return {
      sub: id.sub,
      email: String(id.email ?? "").toLowerCase(),
      emailVerified: String(id.email_verified) === "true",
      accessToken: tokens.access_token,
    };
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
