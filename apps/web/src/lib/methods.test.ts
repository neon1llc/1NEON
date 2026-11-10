// apps/web/src/lib/methods.test.ts - The portal describes one rule in every place: the terms and the
// FAQs repeat the sign-in and confirmation sentences word for word, and every browser storage key in
// the source is listed in the cookie and storage notice.


import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIRM_METHODS, SIGN_IN_METHODS } from "./methods.ts";


const SRC = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");


describe("sign-in wording", () => {
  it("is the same in the terms and the FAQs", () => {
    for (const doc of ["legal/terms-of-use.md", "help/faqs.md"]) {
      expect(read(doc)).toContain(SIGN_IN_METHODS);
      expect(read(doc)).toContain(CONFIRM_METHODS);
    }
  });

  it("never says a passkey can't be phished", () => {
    for (const doc of ["legal/terms-of-use.md", "legal/privacy-policy.md", "legal/cookie-notice.md", "help/faqs.md"]) expect(read(doc)).not.toMatch(/can(no|')t be phished/i);
  });
});


/** Every source file under a folder, tests left out */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|js)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}


describe("storage notice", () => {
  it("lists every storage key the portal's source uses", () => {
    const notice = read("legal/cookie-notice.md");
    const files = [...sources(SRC), join(SRC, "../public/arrive.js")];
    const keys = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/["'`](1neon[.-][a-zA-Z.-]+|neon1\.[a-zA-Z]+)["'`]/g)) keys.add(m[1]!);
    expect(keys.size).toBeGreaterThan(5);
    // The site's own domain looks like a key but isn't one
    keys.delete("neon1.tech");
    const missing = [...keys].filter((k) => !notice.includes(`\`${k}\``));
    expect(missing).toEqual([]);
  });
});
