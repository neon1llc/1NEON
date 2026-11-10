// apps/api/src/contact.test.ts - The public contact form: it mails neon1 only, honors the hidden
// field, validates input, and caps messages per sender each hour.
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { CONTACT_TO, PER_SENDER_HOURLY } from "./routes/contact.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";

let app: ReturnType<typeof createApp>;
let mailer: MemoryMailer;
beforeEach(() => {
  mailer = new MemoryMailer();
  app = createApp({ cfg: { env: "local", publicUrl: "https://neon1.tech", operatorEmails: [], devAuth: true }, repo: new Repo(new MemoryTable()), directory: new MemoryDirectory(), mailer, storage: new MemoryStorage() });
});

const good = { name: "Dana Kim", email: "dana@example.com", topic: "business", today: "We retype orders from email every Friday." };
const send = (b: unknown, ip = "203.0.113.7") =>
  app.request("/1NEON/api/contact", { method: "POST", headers: { "content-type": "application/json", "x-1neon": "1", "x-forwarded-for": ip }, body: JSON.stringify(b) });

describe("contact form", () => {
  it("mails neon1, with the sender as Reply-To", async () => {
    const r = await send({ ...good, better: "Orders land in the sheet on their own." });
    expect(r.status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: CONTACT_TO, replyTo: "dana@example.com" });
    expect(mailer.sent[0]!.text).toContain("Orders land in the sheet");
  });
  it("escapes what people type", async () => {
    await send({ ...good, today: "<script>x</script>" });
    expect(mailer.sent[0]!.html).not.toContain("<script>");
  });
  it("sends nothing when the hidden field is filled", async () => {
    const r = await send({ ...good, website: "spam.example" });
    expect(r.status).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });
  it("refuses a bad address or a missing message", async () => {
    expect((await send({ ...good, email: "nope" })).status).toBe(400);
    expect((await send({ ...good, today: "" })).status).toBe(400);
  });
  it("caps messages per sender each hour", async () => {
    for (let i = 0; i < PER_SENDER_HOURLY; i++) expect((await send(good)).status).toBe(200);
    expect((await send(good)).status).toBe(429);
    expect((await send(good, "198.51.100.9")).status).toBe(200);
  });
  it("needs the custom header, like every other change", async () => {
    const r = await app.request("/1NEON/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(good) });
    expect(r.status).toBe(403);
  });
});
