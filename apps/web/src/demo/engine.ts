// apps/web/src/demo/engine.ts - 1NEON's own API, running in the browser for /1NEON/demo. The same
// routes, rules, and seed data as the real portal, over an in-memory table that's saved on this
// device after every change. Nothing leaves the browser.


import { createApp } from "../../../api/src/app.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "../../../api/src/local.ts";
import { seed } from "../../../api/src/seed.ts";
import { MemoryTable } from "../../../api/src/store/memory.ts";
import { Repo } from "../../../api/src/store/repo.ts";
import type { Row } from "../../../api/src/store/types.ts";
import type { LiveSession } from "../live/signin.ts";
import { devUser } from "../lib/devuser.ts";
import { PLAY, PROJECT } from "../live/where.ts";
import { persistFailed } from "../lib/persist.ts";


// One IndexedDB record holds the whole demo: every row and every uploaded file
const DB = "1neon-demo";
const STORE = "state";
const KEY = "v1";
// `rev` changes on every save, so a tab can tell another tab saved since it last read
export interface Saved { rows: Row[]; files: [string, { type: string; bytes: Uint8Array }][]; rev?: string }
// The live playback's snapshots also hold the pretend inbox, texts, and who holds a session
interface LiveSaved extends Saved { mail: Mail[]; texts: Text[]; session?: LiveSession; passkeys: number }
/** One email or text the in-browser API sent, with when */
export type Mail = { to: string; subject: string; text: string; html: string; at: number };
export type Text = { to: string; body: string; at: number };


// Open (or create) the demo's database; a blocked or missing IndexedDB means no saving, not no demo.
// Either way the page is told, so it can say the demo lasts only as long as the tab
function db(): Promise<IDBDatabase | undefined> {
  return new Promise((done) => {
    const none = () => { persistFailed(); done(undefined); };
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => done(r.result);
      r.onerror = none;
      r.onblocked = none;
    } catch {
      none();
    }
  });
}


// Read, write, or clear the one saved record
async function load(): Promise<Saved | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((done) => {
    try {
      const r = d.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => done(r.result as Saved | undefined);
      r.onerror = () => done(undefined);
    } catch {
      done(undefined);
    }
  });
}
/** Write (or with undefined, delete) the saved demo, resolving only once the transaction is
 * committed. True when it was; a failure (quota, a closed database) is reported, never thrown */
async function store(s: Saved | undefined): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  return new Promise((done) => {
    const fail = () => { persistFailed(); done(false); };
    try {
      const tx = d.transaction(STORE, "readwrite");
      tx.oncomplete = () => done(true);
      tx.onerror = fail;
      tx.onabort = fail;
      if (s) tx.objectStore(STORE).put(s, KEY);
      else tx.objectStore(STORE).delete(KEY);
    } catch {
      fail();
    }
  });
}


// The live playback starts fresh every time from its own story and never saves
const live = location.pathname.startsWith("/1NEON/live");

// Built once per page: restore what this device saved, or start from the demo organizations
const table = new MemoryTable();
const storage = new MemoryStorage();
// Mail and texts are kept (with their send time) so the short demos can show Maria's inbox and phone
const mailer = new MemoryMailer();
const texter = new MemoryTexter();
// The stand-in for Cognito's passkey list; the playback saves and restores its count with the rest,
// so rewinding to before a passkey was added really has none (otherwise adding it again asks to confirm)
const directory = new MemoryDirectory();
const stamp = <T extends object>(list: T[]) => { const push = list.push.bind(list); list.push = (...xs: T[]) => push(...xs.map((x) => ({ at: Date.now(), ...x }))); };
stamp(mailer.sent);
stamp(texter.sent);
// --- Several tabs on one saved demo ------------------------------------------
// Each tab holds the demo in memory. A change is answered only after it's saved, and every change
// runs under one lock shared by this browser's tabs: re-read what another tab saved, apply the change
// on top, save, then tell the other tabs. So two tabs never overwrite each other's acknowledged work

// The revision this tab last read or saved
let rev: string | undefined;
// Another tab saved since this one last read (told over the channel; reads catch up before answering)
let stale = false;
const channel = !live && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("1neon-demo") : undefined;
if (channel) channel.onmessage = (e) => { if ((e.data as { rev?: string })?.rev !== rev) stale = true; };

// Take a saved copy as this tab's own
function adopt(saved: Saved) {
  table.restore(saved.rows);
  storage.files.clear();
  for (const [k, f] of saved.files) storage.files.set(k, f);
  rev = saved.rev;
}

// Catch up with another tab's save, if there was one; nothing saved (a reset) keeps this tab's copy
async function catchUp() {
  const saved = await load();
  if (saved?.rows.length && saved.rev !== rev) adopt(saved);
  stale = false;
}

// One change at a time across this browser's tabs (where the browser has Web Locks; else this tab only)
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("1neon-demo", fn) as Promise<T>;
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

// The save in flight, if any, so a reset can wait for it
let saving: Promise<boolean> = Promise.resolve(true);
async function save() {
  const next = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  saving = store({ rows: table.snapshot(), files: [...storage.files], rev: next });
  if (await saving) {
    rev = next;
    channel?.postMessage({ rev });
  }
}


// The live playback's signed-in session, when a short demo signs in for real (none in the whole project)
let session: LiveSession | undefined;
const ready = (async () => {
  const saved = live ? undefined : await load();
  if (live) {
    session = await (await import("../live/seed.ts")).liveSeed(new Repo(table), mailer);
  } else if (saved?.rows.length) {
    adopt(saved);
  } else {
    // The seed makes fresh ids, so the first tab seeds and saves under the lock, and any other tab
    // opened meanwhile takes that same copy: two tabs never hold two different Acme Dentals
    await exclusive(async () => {
      const first = await load();
      if (first?.rows.length) return adopt(first);
      await seed(new Repo(table));
      await save();
    });
  }
  // The demo's people sign in by picking who to be; Pradeep is the neon1 operator, as in real use
  return createApp({
    cfg: { env: "local", publicUrl: location.origin, operatorEmails: ["pradeep@neon1.tech"], devAuth: true },
    repo: new Repo(table),
    directory,
    mailer,
    texter,
    storage,
  });
})();


/** Answer one request the way the real API would. Changes are saved on this device */
export async function demoFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const app = await ready;
  const req = new Request(new URL(url, location.origin), init);
  if (live) {
    // Short demos sign in for real: /auth/step is answered here, as Cognito would
    if (req.method === "POST" && new URL(req.url).pathname === "/1NEON/api/auth/step") {
      const { liveStep } = await import("../live/signin.ts");
      return liveStep(req, new Repo(table), mailer, (s) => {
        // The full story shows the code sign-in, then moves on to the project without stopping for
        // "Confirm it's you" (Maria has no passkey or app yet); the short demos about it keep the session
        if (PLAY.show !== PROJECT) session = s;
        devUser.set(s.email);
      });
    }
    // The session rides along for its own person only, never for someone acting as another
    if (session && req.headers.get("x-dev-user")?.toLowerCase() === session.email) req.headers.set("x-dev-session", session.id);
  }
  if (live) return app.fetch(req);
  // Reading: first catch up if another tab saved meanwhile
  if ((init.method ?? "GET") === "GET") {
    if (stale) await catchUp();
    return app.fetch(req);
  }
  // Changing: under the shared lock, on top of the latest saved copy, answered once it's saved
  return exclusive(async () => {
    await catchUp();
    const res = await app.fetch(req);
    await save();
    return res;
  });
}


/** Forget everything this device changed, back to the starting demo. Resolves once the saved copy
 * is really deleted (or there was none to delete), so the reload that follows starts fresh */
export async function resetDemo() {
  // A save already under way finishes first, so it can't land after the delete; the other tabs
  // keep their copies until they reload
  await saving;
  await exclusive(() => store(undefined));
}


/** Resolves once the seed (or this device's saved demo) is loaded */
export const whenReady = () => ready.then(() => undefined);


/** Everything right now, so the playback can come back to the start of a section */
export function snapshot(): LiveSaved {
  return { rows: table.snapshot(), files: [...storage.files], mail: [...mailer.sent] as Mail[], texts: [...texter.sent] as Text[], session, passkeys: directory.passkeys };
}

/** Put everything back as it was in a snapshot */
export function restore(s: LiveSaved) {
  table.restore(s.rows);
  storage.files.clear();
  for (const [k, f] of s.files) storage.files.set(k, f);
  mailer.sent.length = 0;
  mailer.sent.push(...s.mail);
  texter.sent.length = 0;
  texter.sent.push(...s.texts);
  session = s.session;
  directory.passkeys = s.passkeys;
}

/** Every email the in-browser API sent, oldest first */
export const outbox = () => [...mailer.sent] as Mail[];
/** Every text it sent, oldest first */
export const textsSent = () => [...texter.sent] as Text[];

/**
 * A day later, for the live playback: the signed-in session's "confirmed it's you" has run out, and
 * the authenticator code used yesterday is long past (the phone shows today's real code, so the
 * record of the last one used steps back a minute rather than the clock moving forward a day)
 */
export async function nextDay() {
  if (!session) return;
  const repo = new Repo(table);
  const row = await repo.getSession(session.id);
  if (!row) return;
  await repo.saveSession(session.id, row.userId, false);
  const t = await repo.getTotp(row.userId);
  if (t?.confirmed) await repo.saveTotp(row.userId, { ...t, lastCounter: t.lastCounter - 2, version: t.version + 1 }, { version: t.version });
}

/** Call the API as someone else, the way their own browser would: for the other side of the story */
export async function actAs<T>(email: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await demoFetch(`/1NEON/api${path}`, {
    method,
    headers: { "x-1neon": "1", "x-dev-user": email, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Upload a small text file as someone else: the record, the bytes, then the finished mark */
export async function uploadAs(email: string, tid: string, name: string, text: string, target: { layer: string; projectId?: string; itemId?: string }) {
  const bytes = new TextEncoder().encode(text);
  const { doc, upload } = await actAs<{ doc: { id: string; projectId?: string }; upload: string }>(email, `/t/${tid}/docs`, "POST", { name, contentType: "text/plain", size: bytes.length, ...target });
  await demoFetch(upload, { method: "PUT", headers: { "content-type": "text/plain" }, body: bytes });
  await actAs(email, `/t/${tid}/docs/${doc.id}/done${doc.projectId ? `?p=${doc.projectId}` : ""}`, "POST");
}
