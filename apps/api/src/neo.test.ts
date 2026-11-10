// apps/api/src/neo.test.ts - Neo for signed-in people, with a scripted model in place of Bedrock:
// reads run as the caller and only on allowed addresses, tours and plans are checked against their
// schemas, links are cleaned, and the daily and monthly caps hold before any model call.
import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { readable, type NeoModel } from "./neo/agent.ts";
import { DEFAULT_BUDGET } from "./routes/neo.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";

const OP = "pradeep@neon1.tech";
let repo: Repo;
let app: ReturnType<typeof createApp>;
let calls: Anthropic.MessageCreateParamsNonStreaming[];
let script: ((p: Anthropic.MessageCreateParamsNonStreaming) => Partial<Anthropic.Message>)[];

// A model that answers from the script, one entry per call, and records what it was sent
const usage = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as Anthropic.Usage;
const fake: NeoModel = async (p) => {
  calls.push(structuredClone(p));
  const next = script.shift();
  if (!next) throw new Error("script ran out");
  return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", stop_sequence: null, usage, content: [], ...next(p) } as Anthropic.Message;
};
const say = (text: string) => () => ({ content: [{ type: "text", text, citations: null }] as Anthropic.ContentBlock[] });
const use = (name: string, input: unknown, id = "t1") => () => ({ stop_reason: "tool_use" as const, content: [{ type: "tool_use", id, name, input, caller: { type: "direct" } }] as unknown as Anthropic.ContentBlock[] });

function build(budget = DEFAULT_BUDGET) {
  app = createApp({
    cfg: { env: "local", publicUrl: "https://neon1.tech", operatorEmails: [OP], devAuth: true },
    repo,
    directory: new MemoryDirectory(),
    mailer: new MemoryMailer(),
    storage: new MemoryStorage(),
    neo: { model: fake, modelId: "fake-model", budget },
  });
}

beforeEach(async () => {
  repo = new Repo(new MemoryTable());
  await seed(repo, OP);
  calls = [];
  script = [];
  build();
});

const ask = (as: string, question: string, where = "/") =>
  app.request("/1NEON/api/neo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": as },
    body: JSON.stringify({ messages: [{ role: "user", content: question }], where }),
  });
const orgOf = async (as: string, slug: string) => {
  const r = await app.request("/1NEON/api/me", { headers: { "x-dev-user": as } });
  return ((await r.json()) as { orgs: { id: string; slug: string }[] }).orgs.find((o) => o.slug === slug)!;
};

describe("neo", () => {
  it("needs a signed-in person and the change header", async () => {
    const anon = await app.request("/1NEON/api/neo", { method: "POST", headers: { "content-type": "application/json", "x-1neon": "1" }, body: "{}" });
    expect(anon.status).toBe(401);
    const noHeader = await app.request("/1NEON/api/neo", { method: "POST", headers: { "content-type": "application/json", "x-dev-user": "dana@acmedental.example" }, body: "{}" });
    expect(noHeader.status).toBe(403);
  });

  it("answers with the guide in a cached system prompt and the person's context on the question", async () => {
    script.push(say("N1-0001 is neon1's own client ID."));
    const r = await ask("dana@acmedental.example", "What is N1-0001?", "/o/acme-dental/workflow");
    expect(r.status).toBe(200);
    expect(((await r.json()) as { reply: string }).reply).toContain("N1-0001");
    const sent = calls[0]!;
    const sys = sent.system as Anthropic.TextBlockParam[];
    expect(sys.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    expect(sys.map((b) => b.text).join()).toContain("1neon-guide-overview");
    const last = sent.messages.at(-1)!.content as Anthropic.TextBlockParam[];
    expect(last[0]!.text).toContain("Dana Kim");
    expect(last[0]!.text).toContain("Organization in view: Acme Dental");
    expect(last[0]!.text).toContain("FLOW-1");
    expect(last[1]!.text).toBe("What is N1-0001?");
  });

  it("reads as the caller, so another organization's data stays out of reach", async () => {
    const harbor = await orgOf(OP, "harbor-auto");
    script.push(use("read", { path: `/t/${harbor.id}/projects` }), say("I can't see that organization."));
    const r = await ask("dana@acmedental.example", "What's Harbor Auto working on?");
    expect(r.status).toBe(200);
    const result = (calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toMatch(/HTTP 404/);
  });

  it("refuses addresses outside the read list", async () => {
    expect(readable("/me")).toBe(true);
    expect(readable("/t/abc/projects/def")).toBe(true);
    for (const bad of ["/t/abc/members/invite", "/auth/login", "/contact", "/t/abc/../me", "/t/abc/docs/x/download"]) expect(readable(bad)).toBe(false);
    script.push(use("read", { path: "/t/abc/docs/x/download" }), say("Sorry."));
    await ask("dana@acmedental.example", "Download it");
    const result = (calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(result.is_error).toBe(true);
  });

  it("returns a checked plan and tour, and sends a malformed one back to the model", async () => {
    const acme = await orgOf("dana@acmedental.example", "acme-dental");
    script.push(
      use("offer_plan", { title: "Bad", steps: [{ say: "x", action: { op: "drop_table" } }] }, "a"),
      use("offer_plan", { title: "Add a task", steps: [{ say: "Add the task to FLOW-1", action: { op: "add_item", tid: acme.id, pid: "p1", kind: "task", title: "Call the vendor" } }] }, "b"),
      use("offer_tour", { title: "The board", steps: [{ path: "/o/acme-dental/workflow", at: "board-column", title: "Stages", text: "Columns run left to right." }] }, "c"),
      say("1. Add the task. Want me to do it? [Board](/1NEON/o/acme-dental/workflow) [evil](https://evil.example) <img src=x>"),
    );
    const r = await ask("dana@acmedental.example", "Add a task to call the vendor");
    const body = (await r.json()) as { reply: string; plan?: { steps: unknown[] }; tour?: { steps: unknown[] } };
    expect((calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!.is_error).toBe(true);
    expect(body.plan?.steps).toHaveLength(1);
    expect(body.tour?.steps).toHaveLength(1);
    expect(body.reply).toContain("[Board](/1NEON/o/acme-dental/workflow)");
    expect(body.reply).not.toContain("evil.example");
    expect(body.reply).not.toContain("<img");
  });

  it("caps questions per person per day before calling the model", async () => {
    build({ ...DEFAULT_BUDGET, dailyPerPerson: 2 });
    script.push(say("one"), say("two"));
    expect((await ask("dana@acmedental.example", "one?")).status).toBe(200);
    expect((await ask("dana@acmedental.example", "two?")).status).toBe(200);
    expect((await ask("dana@acmedental.example", "three?")).status).toBe(429);
    expect(calls).toHaveLength(2);
  });

  it("stops for the month once the estimated spend reaches the ceiling", async () => {
    // 1,000 input and 100 output tokens at $2 and $10 a million cost $0.003, over a $0.002 ceiling
    build({ ...DEFAULT_BUDGET, monthlyUsd: 0.002 });
    script.push(say("first"));
    expect((await ask("dana@acmedental.example", "first?")).status).toBe(200);
    const r = await ask("dana@acmedental.example", "second?");
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: string }).error).toBe("neo_month");
  });

  it("refuses a conversation that doesn't alternate", async () => {
    const r = await app.request("/1NEON/api/neo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-1neon": "1", "x-dev-user": "dana@acmedental.example" },
      body: JSON.stringify({ messages: [{ role: "assistant", content: "hi" }] }),
    });
    expect(r.status).toBe(400);
  });

  it("says it's off where no model is wired", async () => {
    app = createApp({ cfg: { env: "local", publicUrl: "https://neon1.tech", operatorEmails: [OP], devAuth: true }, repo, directory: new MemoryDirectory(), mailer: new MemoryMailer(), storage: new MemoryStorage() });
    expect((await ask("dana@acmedental.example", "hello?")).status).toBe(503);
  });
});
