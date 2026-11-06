// packages/domain/src/ids.ts - Sortable, URL-safe IDs: 10 chars of time + 12 random (Crockford
// base32).


// Crockford's alphabet (no i, l, o, u) avoids look-alike characters in URLs and support calls
const B32 = "0123456789abcdefghjkmnpqrstvwxyz";


/** A new ID; time first so IDs sort by creation, optional prefix such as "t" or "p" */
export function newId(prefix = ""): string {
  let t = Date.now();
  let time = "";
  // 10 base-32 digits of milliseconds cover dates far past this century
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 60 random bits make collisions within the same millisecond practically impossible
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let rand = "";
  for (const b of bytes) rand += B32[b % 32];
  return prefix + time + rand;
}


/** "Acme Dental Group" -> "acme-dental-group" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "") || "org";
}


/** Client IDs shown in the chooser and on invoices: N1-0001, N1-0002, … */
export function formatClientId(n: number): string {
  return `N1-${String(n).padStart(4, "0")}`;
}
