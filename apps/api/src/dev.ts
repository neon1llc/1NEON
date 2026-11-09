// apps/api/src/dev.ts - Local API on http://localhost:8787 with an in-memory table and demo data.
// Sign in by sending `x-dev-user: <email>` (the web app's dev switcher does this).


import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { seed } from "./seed.ts";
import { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "./services.ts";
import { MemoryTable } from "./store/memory.ts";
import { Repo } from "./store/repo.ts";


// Pradeep is the operator locally, whatever the environment says
const cfg = { ...loadConfig(), operatorEmails: ["pradeep@neon1.tech"] };
const repo = new Repo(new MemoryTable());
const mailer = new MemoryMailer();
// Texts print here instead of going out, so the phone check can be tried locally with made-up numbers
const texter = new (class extends MemoryTexter {
  override async send(to: string, body: string) {
    await super.send(to, body);
    console.log(`local text to ${to}: ${body}`);
  }
})();
await seed(repo);
const app = createApp({ cfg, repo, directory: new MemoryDirectory(), mailer, texter, storage: new MemoryStorage() });
serve({ fetch: app.fetch, port: 8787 }, (i) => console.log(`1NEON API (memory) on http://localhost:${i.port}/1NEON/api`));
