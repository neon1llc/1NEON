// apps/api/src/dev-guard.test.ts - In dev (a copy of production's data) mail and new accounts reach
// neon1 only; everywhere else the guards change nothing.
import { describe, expect, it } from "vitest";
import { guardDirectory, guardMailer, neon1Only } from "./dev-guard.ts";
import { MemoryDirectory, MemoryMailer } from "./services.ts";

const dev = { env: "dev" as const, operatorEmails: ["neon1llc@gmail.com"] };
const prod = { env: "prod" as const, operatorEmails: ["neon1llc@gmail.com"] };

describe("dev guard", () => {
  it("counts operators and neon1.tech addresses as neon1, and nobody else", () => {
    expect(neon1Only(dev, "NEON1LLC@gmail.com ")).toBe(true);
    expect(neon1Only(dev, "pradeep@neon1.tech")).toBe(true);
    expect(neon1Only(dev, "client@example.com")).toBe(false);
    expect(neon1Only(dev, "x@neon1.tech.evil.example")).toBe(false);
  });

  it("drops dev mail to clients and sends it to neon1", async () => {
    const inner = new MemoryMailer();
    const m = guardMailer(dev, inner);
    await m.send("client@example.com", "s", "t", "h");
    await m.send("neon1llc@gmail.com", "s", "t", "h");
    await m.send("hello@neon1.tech", "s", "t", "h");
    expect(inner.sent.map((x) => x.to)).toEqual(["neon1llc@gmail.com", "hello@neon1.tech"]);
  });

  it("creates dev accounts for neon1 only", async () => {
    const inner = new MemoryDirectory();
    const made: string[] = [];
    inner.ensureUser = async (e: string) => { made.push(e); };
    const d = guardDirectory(dev, inner);
    await d.ensureUser("client@example.com");
    await d.ensureUser("pradeep@neon1.tech");
    expect(made).toEqual(["pradeep@neon1.tech"]);
  });

  it("leaves production alone", async () => {
    const inner = new MemoryMailer();
    const dir = new MemoryDirectory();
    expect(guardMailer(prod, inner)).toBe(inner);
    expect(guardDirectory(prod, dir)).toBe(dir);
  });
});
