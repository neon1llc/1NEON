// apps/web/src/lib/signin.test.ts - The saved sign-in step: what's kept, when it expires, and code
// cleanup for pasted codes.


import { describe, expect, it } from "vitest";
import { cleanCode, clearStep, loadStep, saveStep, SIGNIN_KEY, SIGNIN_TTL } from "./signin.ts";


/** A Map-backed stand-in for sessionStorage */
function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}


// Saving, restoring, and forgetting the step
describe("saved sign-in step", () => {
  it("restores the email, step, and methods within five minutes", () => {
    const s = memory();
    saveStep(s, { email: "dana@acmedental.example", step: "code", methods: ["code", "passkey"] }, 1000);
    expect(loadStep(s, 1000 + SIGNIN_TTL - 1)).toEqual({ email: "dana@acmedental.example", step: "code", methods: ["code", "passkey"], at: 1000 });
  });

  it("never stores a code", () => {
    const s = memory();
    saveStep(s, { email: "a@b.co", step: "code", code: "12345678" } as never, 0);
    expect(s.m.get(SIGNIN_KEY)).not.toContain("12345678");
  });

  it("expires at five minutes and clears what it found", () => {
    const s = memory();
    saveStep(s, { email: "a@b.co", step: "totp" }, 0);
    expect(loadStep(s, SIGNIN_TTL)).toBeUndefined();
    expect(s.m.has(SIGNIN_KEY)).toBe(false);
  });

  it("ignores malformed or unknown steps", () => {
    const s = memory();
    s.setItem(SIGNIN_KEY, "not json");
    expect(loadStep(s, 0)).toBeUndefined();
    s.setItem(SIGNIN_KEY, JSON.stringify({ email: "a@b.co", step: "done", at: 0 }));
    expect(loadStep(s, 0)).toBeUndefined();
  });

  it("clears on request, and survives storage that throws", () => {
    const s = memory();
    saveStep(s, { email: "a@b.co", step: "choose", methods: ["code"] }, 0);
    clearStep(s);
    expect(loadStep(s, 0)).toBeUndefined();
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    expect(() => saveStep(broken, { email: "a@b.co", step: "code" })).not.toThrow();
    expect(loadStep(broken)).toBeUndefined();
    expect(() => clearStep(broken)).not.toThrow();
  });
});


// Pasted codes with spacing or separators
describe("cleanCode", () => {
  it("keeps only digits, up to eight", () => {
    expect(cleanCode("1234 5678")).toBe("12345678");
    expect(cleanCode("1234-5678")).toBe("12345678");
    expect(cleanCode(" 123 456 ")).toBe("123456");
    expect(cleanCode("123456789")).toBe("12345678");
  });
});
