// apps/web/src/lib/api.ts - Thin client for the 1NEON API. Same origin, cookies only; no tokens in
// JavaScript.


import type { ApiError } from "@1neon/domain";


// Every API call is same-origin under /1NEON/api; the dev user lives in localStorage
const BASE = "/1NEON/api";
const DEV_KEY = "1neon.devUser";


/** A non-2xx reply, carrying the API's { error, message, current? } body */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}


/** Local development only: the API trusts this header when DEV_AUTH=1 */
export const devUser = {
  // Storage can throw in private browsing; treat that as no dev user
  get: () => {
    try {
      return localStorage.getItem(DEV_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set: (email: string) => {
    try {
      if (email) localStorage.setItem(DEV_KEY, email);
      else localStorage.removeItem(DEV_KEY);
    } catch {
      /* private mode */
    }
  },
};


// True only in Vite's dev server; production builds drop the dev paths
export const isDev = import.meta.env.DEV;


/** Call the API. The x-1neon header satisfies the CSRF check; cookies ride along automatically */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-1neon": "1" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (isDev && devUser.get()) headers["x-dev-user"] = devUser.get();
  const r = await fetch(BASE + path, {
    method: init.method ?? "GET",
    headers,
    credentials: "same-origin",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  // Empty bodies (204) come back as undefined
  // A non-JSON reply (a gateway error page) still becomes a readable error
  const text = await r.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = r.ok ? undefined : { error: "http", message: "The server didn't answer properly. Please try again." };
  }
  // Admin actions from an unconfirmed session open the "Confirm it's you" dialog
  if (r.status === 403 && (data as ApiError | undefined)?.error === "strong_auth_required") dispatchEvent(new CustomEvent("1neon:confirm"));
  if (!r.ok) throw new HttpError(r.status, (data as ApiError | undefined) ?? { error: "http", message: r.statusText });
  return data as T;
}

