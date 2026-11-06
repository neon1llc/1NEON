// Thin client for the 1NEON API. Same origin, cookies only; no tokens in JavaScript.
import type { ApiError } from "@1neon/domain";

const BASE = "/1NEON/api";
const DEV_KEY = "1neon.devUser";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

/** Local development only: the API trusts this header when DEV_AUTH=1. */
export const devUser = {
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

export const isDev = import.meta.env.DEV;

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
  const text = await r.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new HttpError(r.status, data ?? { error: "http", message: r.statusText });
  return data as T;
}

export const signInUrl = (email?: string) => `${BASE}/auth/login${email ? `?email=${encodeURIComponent(email)}` : ""}`;
