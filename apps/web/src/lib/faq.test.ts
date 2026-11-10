// apps/web/src/lib/faq.test.ts - Every FAQ answer has a unique, stable anchor, and the everyday
// searches people tried (lost phone, support, invoice, and the recovery and export variants) reach
// an answer rather than "no answers match".


import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aliasesOf, matches, parse, slug } from "./faq.ts";


const FAQ = parse(readFileSync(new URL("../help/faqs.md", import.meta.url), "utf8"));
const all = FAQ.topics.flatMap((t) => t.items);


describe("faq anchors", () => {
  it("builds anchors the way the knowledge center does", () => {
    expect(slug("I didn't get the sign-in code.")).toBe("i-didn-t-get-the-sign-in-code");
    expect(slug("What's a passkey?")).toBe("what-s-a-passkey");
  });

  it("gives every question its own anchor", () => {
    const ids = all.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toBe(true);
  });

  it("only keeps aliases for questions that exist", () => {
    const ids = new Set(all.map((i) => i.id));
    for (const id of ["i-lost-my-phone-or-my-authenticator-app", "where-are-invoices-and-payments", "can-we-get-a-copy-of-our-data", "something-urgent-is-wrong-who-do-i-tell"]) {
      expect(ids.has(id)).toBe(true);
      expect(aliasesOf(id).length).toBeGreaterThan(0);
    }
  });
});


describe("faq search", () => {
  const hits = (query: string) => all.filter((i) => matches(i, query)).map((i) => i.id);

  it.each(["lost phone", "support", "invoice", "recovery", "export", "2FA", "MFA", "passkey", "phone lost"])("finds an answer for %s", (query) => {
    expect(hits(query).length).toBeGreaterThan(0);
  });

  it("puts the recovery answer under lost phone, and billing under invoice", () => {
    expect(hits("lost phone")).toContain("i-lost-my-phone-or-my-authenticator-app");
    expect(hits("invoice")).toContain("where-are-invoices-and-payments");
    expect(hits("export")).toContain("can-we-get-a-copy-of-our-data");
  });

  it("still finds nothing for nonsense", () => {
    expect(hits("zebra quantum")).toEqual([]);
  });
});
