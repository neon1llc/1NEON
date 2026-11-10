// apps/api/src/routes/contact.ts - The contact form on neon1.tech: one public route that emails the
// message to neon1, with the sender as Reply-To. It mails only neon1's own inbox, never the address a
// visitor types, so it can't be used to send mail to anyone else. A hidden field catches simple bots,
// and counters cap messages per sender each hour and in total each day.
import { z } from "zod";
import { body, fail } from "../lib/http.ts";
import type { App, Kit } from "../lib/kit.ts";
import { esc, branded } from "../mail.ts";


export const CONTACT_TO = "hello@neon1.tech";
export const PER_SENDER_HOURLY = 5;
export const DAILY = 50;

// What each topic is called in the email; the same four as the site's services, plus "something else"
export const TOPICS = {
  business: "Business workflows and technology",
  cloud: "Cloud and AI engineering",
  spaces: "Networks, devices, and spaces",
  security: "Security awareness and readiness",
  other: "Something else",
} as const;

const Message = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(200),
  company: z.string().trim().max(120).optional().default(""),
  topic: z.enum(Object.keys(TOPICS) as [keyof typeof TOPICS, ...(keyof typeof TOPICS)[]]),
  today: z.string().trim().min(1).max(3000),
  better: z.string().trim().max(1500).optional().default(""),
  timing: z.string().trim().max(200).optional().default(""),
  // Hidden from people; a bot that fills every field fills this one too
  website: z.string().max(200).optional().default(""),
});


export function contactRoutes(app: App, k: Kit) {
  const { d, repo } = k;

  app.post("/contact", async (c) => {
    const m = await body(c, Message);
    // A filled hidden field looks like success to the bot, and nothing is sent
    if (m.website) return c.json({ ok: true });

    // The sender's address is hashed before it's counted, so no address is stored
    const ip = (c.req.header("cloudfront-viewer-address") ?? c.req.header("x-forwarded-for") ?? "unknown").split(",")[0]!.replace(/:\d+$/, "").trim();
    // Web Crypto, not node:crypto, so the browser demo can run the same API
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)));
    const who = [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const hour = new Date().toISOString().slice(0, 13);
    if ((await repo.table.increment("COUNTER", `CONTACT#${who}#${hour}`)) > PER_SENDER_HOURLY) fail(429, "too_many", "That's a lot of messages in an hour. Email hello@neon1.tech instead.");
    if ((await repo.table.increment("COUNTER", `CONTACT#${hour.slice(0, 10)}`)) > DAILY) fail(429, "busy", "The form is paused for today. Email hello@neon1.tech instead.");

    const topic = TOPICS[m.topic];
    const rows: [string, string][] = [
      ["From", `${m.name} <${m.email}>`], ...(m.company ? [["Organization", m.company] as [string, string]] : []),
      ["About", topic], ["What happens today", m.today],
      ...(m.better ? [["What would be better", m.better] as [string, string]] : []),
      ...(m.timing ? [["Timing", m.timing] as [string, string]] : []),
    ];
    const text = rows.map(([k2, v]) => `${k2}: ${v}`).join("\n\n");
    const html = branded({
      label: "website message",
      preheader: `${m.name}: ${topic}`,
      heading: `Message from ${m.name}`,
      body: rows.map(([k2, v]) => `<p style="margin:0 0 14px"><b>${esc(k2)}</b><br>${esc(v).replace(/\n/g, "<br>")}</p>`).join(""),
      note: "Reply to this email to answer them directly.",
    });
    await d.mailer.send(CONTACT_TO, `neon1.tech: ${topic} (${m.name})`, text, html, m.email);
    return c.json({ ok: true });
  });
}
