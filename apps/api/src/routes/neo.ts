// apps/api/src/routes/neo.ts - POST /neo: Neo for signed-in people. It answers about any part of
// 1NEON from the 1NEON guide and the person's own data, offers tours, and offers plans the person's
// browser runs only after they say yes (neo/agent.ts has the prompt and tools).
//
// Reads go through this same app as the caller: each one is an in-process GET carrying the caller's
// own cookie (or dev headers), so it passes the same sign-in, membership, and permission checks a
// page's request does. Spend is capped twice before the model is called: questions per person per
// day, and the whole month's estimated model cost, which is counted as each model call finishes.


import { NeoAsk, type NeoReply } from "@1neon/domain";
import { body, fail, who } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import { runNeo, GUIDE_INFO, type NeoRead } from "../neo/agent.ts";


/** What Neo's model costs, in US dollars per million tokens, and the caps on spending it */
export interface NeoBudget {
  // The month's ceiling for model spend, in dollars; questions stop once the estimate reaches it
  monthlyUsd: number;
  // Questions one person may ask in a day
  dailyPerPerson: number;
  price: { input: number; output: number; cacheWrite: number; cacheRead: number };
}

// Claude Sonnet 5.5 list prices, with cache reads counted high on purpose, so the estimate errs over
export const DEFAULT_BUDGET: NeoBudget = { monthlyUsd: 8, dailyPerPerson: 60, price: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 } };

// One question may take this long in all; the function and the HTTP API allow 28 seconds
const DEADLINE_MS = 24_000;


export function neoRoutes(app: App, k: Kit) {
  const { d, repo } = k;

  app.post("/neo", async (c) => {
    const { user } = who(c);
    // Not wired here (local runs without AWS, the browser demo): say so plainly
    if (!d.neo) fail(503, "neo_off", "Neo isn't available here.");
    const ask = await body(c, NeoAsk);
    const budget = d.neo.budget ?? DEFAULT_BUDGET;

    // Caps, before any model call: the person's questions today, then the month's spend
    const day = new Date().toISOString().slice(0, 10);
    if ((await repo.table.increment("COUNTER", `NEO#${user.id}#${day}`)) > budget.dailyPerPerson) {
      fail(429, "neo_daily", "That's a lot of questions for one day, so Neo is resting until tomorrow. For anything urgent, email hello@neon1.tech.");
    }
    const month = day.slice(0, 7);
    const spentMicros = Number((await repo.table.get("COUNTER", `NEO#${month}`))?.n ?? 0);
    if (spentMicros >= budget.monthlyUsd * 1_000_000) {
      fail(429, "neo_month", "Neo has reached this month's limit and is resting until the 1st. Email hello@neon1.tech, and I'll answer directly.");
    }

    // Reads as the caller: the same headers that identified them, sent back through this app
    const headers = new Headers();
    for (const h of ["cookie", "x-dev-user", "x-dev-session"]) {
      const v = c.req.header(h);
      if (v) headers.set(h, v);
    }
    const read: NeoRead = async (path) => {
      const res = await app.request(`/1NEON/api${path}`, { method: "GET", headers });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    const context = await contextFor(read, ask.where, user.name || user.email, user.email);
    const started = Date.now();
    let spent = 0;
    const result = await runNeo({
      model: d.neo.model,
      modelId: d.neo.modelId,
      ask,
      context,
      read,
      deadline: started + DEADLINE_MS,
      spend: async (u) => {
        const p = budget.price;
        // Dollars per million tokens is millionths of a dollar per token
        const micros = Math.ceil((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite + (u.cache_read_input_tokens ?? 0) * p.cacheRead);
        spent += micros;
        await repo.table.increment("COUNTER", `NEO#${month}`, micros);
      },
    }).catch((e: Error) => {
      // A model or network error: logged by class name only, never the conversation
      console.error(JSON.stringify({ level: "error", message: "neo failed", error: e.name, status: (e as { status?: number }).status }));
      fail(503, "neo_unavailable", "Neo couldn't answer just now. Please try again in a moment.");
    });

    // One line per question: sizes, rounds, time, and cost only, never what was asked or answered
    console.log(JSON.stringify({ message: "neo", rounds: result.rounds, ms: Date.now() - started, micros: spent, tour: Boolean(result.tour), plan: result.plan?.steps.length ?? 0, guide: GUIDE_INFO.commit.slice(0, 7) }));
    const reply: NeoReply = { reply: result.reply, tour: result.tour, plan: result.plan };
    return c.json(reply);
  });
}


/**
 * The context block: who is asking, their organizations and access, the page in view, and when they're
 * inside an organization, its stages and projects. All of it read as the person, so it holds nothing
 * they couldn't open themselves
 */
async function contextFor(read: NeoRead, where: string, name: string, email: string) {
  type Org = { id: string; slug: string; name: string; clientId: string; access?: string };
  type MeBody = { operator?: boolean; strongSession?: boolean; factors?: Record<string, boolean>; orgs?: Org[] };
  const me = (await read("/me")).body as MeBody;
  const orgs = me.orgs ?? [];
  const path = where.replace(/^\/1NEON/, "") || "/";
  const slug = /^\/o\/([a-z0-9-]+)/.exec(path)?.[1];
  const here = orgs.find((o) => o.slug === slug);
  const zone = "America/New_York";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: zone });
  const lines = [
    `Today: ${today} (${zone})`,
    `Person: ${name} <${email}>; neon1 operator: ${me.operator ? "yes" : "no"}; session confirmed for admin actions: ${me.strongSession ? "yes" : "no"}; second steps set up: ${Object.entries(me.factors ?? {}).filter(([k, v]) => k !== "any" && v).map(([k]) => k).join(", ") || "none"}`,
    `Organizations (id | slug | client ID | name | their access): ${orgs.map((o) => `${o.id} | ${o.slug} | ${o.clientId} | ${o.name} | ${o.access ?? "none"}`).join("; ") || "none"}`,
    `Page in view: /1NEON${path}`,
  ];
  if (here) {
    type Stage = { id: string; name: string; layer: string; hidden?: boolean; exit?: string };
    type Proj = { id: string; key: string; name: string; stageId: string; health: string; targetDate?: string; archived?: boolean };
    const [org, projects] = await Promise.all([read(`/t/${here.id}`), read(`/t/${here.id}/projects`)]);
    const stages = ((org.body as { stages?: Stage[] }).stages ?? []);
    const names = new Map(stages.map((s) => [s.id, s.name]));
    lines.push(
      `Organization in view: ${here.name} (id ${here.id}, ${here.clientId}); their access here: ${here.access ?? "none"}`,
      `Stages in order (id | name | layer): ${stages.map((s) => `${s.id} | ${s.name} | ${s.layer}${s.hidden ? " | hidden" : ""}`).join("; ")}`,
      `Projects (key | id | name | stage | health | target): ${(Array.isArray(projects.body) ? (projects.body as Proj[]) : []).filter((p) => !p.archived).slice(0, 60).map((p) => `${p.key} | ${p.id} | ${p.name} | ${names.get(p.stageId) ?? p.stageId} | ${p.health} | ${p.targetDate ?? "none"}`).join("; ") || "none"}`,
    );
  }
  return { today, text: lines.join("\n") };
}
