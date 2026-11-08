// apps/web/src/lib/api.ts - Thin client for the 1NEON API. Same origin, cookies only; no tokens in
// JavaScript.


import type { ApiError } from "@1neon/domain";


// Every API call is same-origin under /1NEON/api; the dev user lives in localStorage
const BASE = "/1NEON/api";
// The live playback keeps its own "who am I", so it never changes who you are in the demo
const DEV_KEY = location.pathname.startsWith("/1NEON/live") ? "1neon.liveUser" : "1neon.devUser";


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

// Is the page under this path, or the path itself?
const under = (p: string) => location.pathname === p || location.pathname.startsWith(`${p}/`);
/** /1NEON/live: the demo playing itself, a whole project from start to finish */
export const LIVE = under("/1NEON/live");
/** /1NEON/demo (and live): the whole portal runs in this browser, with its own copy of the API and nothing sent anywhere */
export const DEMO = LIVE || under("/1NEON/demo");
// The router's base: the demo and the live playback keep every page under their own path
export const BASE_PATH = LIVE ? "/1NEON/live" : DEMO ? "/1NEON/demo" : "/1NEON";
// Pick a person to be, as in local development: true in the dev server and in the demo
export const pickPerson = isDev || DEMO;
// The in-browser API, loaded only for the demo so the real portal never carries it
const engine = DEMO ? import("../demo/engine.ts") : undefined;

/** Every request goes here: the network normally, the in-browser API in the demo */
export async function send(url: string, init: RequestInit = {}): Promise<Response> {
  return engine ? (await engine).demoFetch(url, init) : fetch(url, init);
}

/** A link the browser can open: demo files become local object links */
export async function openable(url: string): Promise<string> {
  if (!engine) return url;
  return URL.createObjectURL(await (await send(url)).blob());
}

/** The live playback's handle on the in-browser API: act as someone else, and save or restore everything */
export const liveEngine = () => engine;

/** Start the demo over, then reload into it */
export async function resetDemo() {
  if (engine) await (await engine).resetDemo();
  location.href = "/1NEON/demo/";
}


/** Call the API. The x-1neon header satisfies the CSRF check; cookies ride along automatically */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-1neon": "1" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (pickPerson && devUser.get()) headers["x-dev-user"] = devUser.get();
  const r = await send(BASE + path, {
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

