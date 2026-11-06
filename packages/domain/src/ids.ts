/** Sortable, URL-safe IDs: 10 chars of time + 12 random (Crockford base32). */
const B32 = "0123456789abcdefghjkmnpqrstvwxyz";

export function newId(prefix = ""): string {
  let t = Date.now();
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32] + time;
    t = Math.floor(t / 32);
  }
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

export function formatClientId(n: number): string {
  return `N1-${String(n).padStart(4, "0")}`;
}
