// apps/web/src/demo/engine.ts - 1NEON's own API, running in the browser for /1NEON/demo. The same
// routes, rules, and seed data as the real portal, over an in-memory table that's saved on this
// device after every change. Nothing leaves the browser.


import { createApp } from "../../../api/src/app.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage } from "../../../api/src/local.ts";
import { seed } from "../../../api/src/seed.ts";
import { MemoryTable } from "../../../api/src/store/memory.ts";
import { Repo } from "../../../api/src/store/repo.ts";
import type { Row } from "../../../api/src/store/types.ts";


// One IndexedDB record holds the whole demo: every row and every uploaded file
const DB = "1neon-demo";
const STORE = "state";
const KEY = "v1";
interface Saved { rows: Row[]; files: [string, { type: string; bytes: Uint8Array }][] }


// Open (or create) the demo's database; a blocked or missing IndexedDB means no saving, not no demo
function db(): Promise<IDBDatabase | undefined> {
  return new Promise((done) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => done(r.result);
      r.onerror = () => done(undefined);
    } catch {
      done(undefined);
    }
  });
}


// Read, write, or clear the one saved record
async function load(): Promise<Saved | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((done) => {
    const r = d.transaction(STORE).objectStore(STORE).get(KEY);
    r.onsuccess = () => done(r.result as Saved | undefined);
    r.onerror = () => done(undefined);
  });
}
async function store(s: Saved | undefined) {
  const d = await db();
  if (!d) return;
  const t = d.transaction(STORE, "readwrite").objectStore(STORE);
  if (s) t.put(s, KEY);
  else t.delete(KEY);
}


// Built once per page: restore what this device saved, or start from the demo organizations
const table = new MemoryTable();
const storage = new MemoryStorage();
const ready = (async () => {
  const saved = await load();
  if (saved?.rows.length) {
    table.restore(saved.rows);
    for (const [k, f] of saved.files) storage.files.set(k, f);
  } else {
    await seed(new Repo(table));
  }
  // The demo's people sign in by picking who to be; Pradeep is the neon1 operator, as in real use
  return createApp({
    cfg: { env: "local", publicUrl: location.origin, operatorEmails: ["pradeep@neon1.tech"], devAuth: true },
    repo: new Repo(table),
    directory: new MemoryDirectory(),
    mailer: new MemoryMailer(),
    storage,
  });
})();


// Saves are coalesced, so a burst of changes writes once
let pending: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(pending);
  pending = setTimeout(() => void store({ rows: table.snapshot(), files: [...storage.files] }), 150);
}


/** Answer one request the way the real API would. Changes are saved on this device */
export async function demoFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const app = await ready;
  const res = await app.fetch(new Request(new URL(url, location.origin), init));
  if ((init.method ?? "GET") !== "GET") save();
  return res;
}


/** Forget everything this device changed, back to the starting demo */
export async function resetDemo() {
  clearTimeout(pending);
  await store(undefined);
}
