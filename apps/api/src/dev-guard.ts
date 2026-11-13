// apps/api/src/dev-guard.ts - dev.neon1.tech/1NEON runs on a copy of production's data, so it holds
// real clients' names and addresses. In dev, only neon1 itself is reachable: sign-in admits only
// operators, mail goes only to operators and neon1.tech addresses, and no Cognito account is ever
// created for anyone else (the dev pool holds neon1 admins only). Elsewhere these are pass-throughs.


import type { Config } from "./config.ts";
import type { Directory, Mailer } from "./services.ts";


/** True when this deployment is dev and must keep to neon1's own people */
export const isDev = (cfg: Pick<Config, "env">) => cfg.env === "dev";


/** Someone dev may sign in, mail, or create an account for: an operator, or any neon1.tech address */
export function neon1Only(cfg: Pick<Config, "operatorEmails">, email: string) {
  const e = email.trim().toLowerCase();
  return cfg.operatorEmails.includes(e) || e.endsWith("@neon1.tech");
}


/** One log line for what dev held back; the domain only, never the address */
function held(what: string, email: string) {
  console.log(JSON.stringify({ level: "info", message: `dev: ${what} held back`, domain: email.split("@")[1] ?? "" }));
}


/** In dev, mail to anyone outside neon1 is dropped (logged, not sent), so a test never reaches a client */
export function guardMailer(cfg: Pick<Config, "env" | "operatorEmails">, mailer: Mailer): Mailer {
  if (!isDev(cfg)) return mailer;
  return {
    async send(to, subject, text, html, replyTo, signal) {
      if (!neon1Only(cfg, to)) return held("mail", to);
      await mailer.send(to, subject, text, html, replyTo, signal);
    },
  };
}


/** In dev, inviting someone outside neon1 records them in the data but creates no dev account */
export function guardDirectory(cfg: Pick<Config, "env" | "operatorEmails">, directory: Directory): Directory {
  if (!isDev(cfg)) return directory;
  return {
    ensureUser: async (email) => (neon1Only(cfg, email) ? directory.ensureUser(email) : held("account", email)),
    factors: (t) => directory.factors(t),
    startPasskey: (t) => directory.startPasskey(t),
    finishPasskey: (t, c) => directory.finishPasskey(t, c),
  };
}
