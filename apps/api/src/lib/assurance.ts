// apps/api/src/lib/assurance.ts - Second-step helpers shared by sign-in, profile, and factor routes:
// the factor-change rule, enrollment hints, security notices, and counted code checks.


import type { User } from "@1neon/domain";
import type { Context } from "hono";
import { factorInventory, type FactorInventory } from "../factors.ts";
import { checkTotp } from "../totp.ts";
import { ConflictError, type Row } from "../store/types.ts";
import { withTimeout } from "../outbox.ts";
import { accountAllows, isOptOut, CODE_MS, CODE_TRIES, CODES_PER_HOUR, newCode } from "../sms.ts";
import { fail, now, who, type Env } from "./http.ts";
import type { Kit } from "./kit.ts";


/** Bind the helpers to one app's services; stateless, so each route module may build its own */
export function assurance(k: Kit) {
  const { d, repo } = k;

  // --- Factor changes ---------------------------------------------------------
  // Rule for every add, replace, or remove: an account that already has a passkey, authenticator, or text codes
  // (or whose methods we can't check right now) needs this session to have proved one recently.
  // Only a genuinely unenrolled account, such as a new invitee, may add its first from an email session

  /** The access token Cognito lookups use; "local" in dev and tests */
  const tokenOf = (c: Context<Env>) => d.auth?.accessToken(c) ?? "local";

  /** Refuse a factor change the rule above doesn't allow; returns the inventory it read */
  async function mayChangeFactors(c: Context<Env>): Promise<FactorInventory> {
    const { user, actor } = who(c);
    const inv = await factorInventory(repo, d.directory, user, tokenOf(c));
    if (inv.any === "unknown" && !actor.strongSession) fail(503, "factors_unknown", "We couldn't check your sign-in methods just now. Confirm it's you, or try again in a minute.");
    if (inv.any === true && !actor.strongSession) fail(403, "strong_auth_required", "Confirm it's you with a passkey, authenticator app, or text code you already have, then try again.");
    return inv;
  }

  /** Keep the profile's display hints in step with a known inventory (never with an unknown one) */
  async function refreshEnrolled(user: User, inv: FactorInventory) {
    if (inv.any === "unknown") return;
    const passkey = inv.passkey === "unknown" ? user.passkey : inv.passkey;
    if (inv.any === user.strongAuth && Boolean(passkey) === Boolean(user.passkey)) return;
    await repo.saveUser({ ...user, strongAuth: inv.any, passkey, version: user.version + 1, updatedAt: now() }, user.version);
  }

  /**
   * After a factor is removed or replaced: every other session's earlier proof stops counting, this
   * session keeps its own (it just made the change), and the event is recorded and emailed
   */
  async function factorChanged(c: Context<Env>, action: string, summary: string) {
    const { user, jti } = who(c);
    const at = now();
    await repo.raiseAssuranceFloor(user.id, at);
    const mine = jti ? await repo.getSession(jti) : undefined;
    if (jti && mine?.strong) await repo.saveSession(jti, user.id, true, { strongAt: new Date(Date.parse(at) + 1).toISOString(), strongUntil: mine.strongUntil });
    await repo.securityEvent(user.id, action, summary);
  }

  /** Mail a security notice; a mail failure never undoes the change, but it is logged */
  async function notice(user: User, mail: { subject: string; text: string; html: string }) {
    await d.mailer.send(user.email, mail.subject, mail.text, mail.html).catch((e) => console.error(JSON.stringify({ level: "error", message: `security notice: ${String(e)}` })));
  }

  // --- Counted codes ------------------------------------------------------------

  /**
   * Text one code to a number and keep only its hash under this person's key, with the hourly limit
   * per person and the account's daily budget. Shared by number checks and confirming it's you
   */
  async function textCode(user: User, sk: string, to: string, words: (code: string) => string) {
    const texter = d.texter;
    if (!texter) fail(503, "texts_unavailable", "Texts aren't available yet. Email notices still work.");
    const k = { PK: `USER#${user.id}`, SK: sk };
    const prev = await repo.table.get(k.PK, k.SK);
    const recent = ((prev?.sentAt as string[] | undefined) ?? []).filter((t) => Date.now() - Date.parse(t) < 3600_000);
    if (recent.length >= CODES_PER_HOUR) fail(429, "too_many_codes", "Too many codes this hour. Try again later.");
    if (!(await accountAllows(repo))) fail(429, "texts_busy", "Texts are paused for today. Try again tomorrow.");
    const { code, hash } = await newCode(user.id);
    const at = now();
    const version = Number(prev?.version ?? 0) + 1;
    await repo.table.write([{ put: { ...k, hash, phone: to, expiresAt: new Date(Date.now() + CODE_MS).toISOString(), attempts: 0, sentAt: [...recent, at], version, ttl: Math.floor(Date.now() / 1000) + 3600 }, guard: prev ? { version: Number(prev.version) } : { create: true } }]);
    // The person waits for this one, so it gets the same time limit as queued sends
    try {
      await withTimeout(texter.send(to, words(code)), 5_000);
    } catch (e) {
      if (isOptOut(e)) fail(409, "carrier_opted_out", "This number replied STOP earlier. Text START to the number 1NEON texts come from, then ask for a code again.");
      throw e;
    }
  }

  /**
   * Count one try at the phone code before any verdict. A write that loses a race is read again and
   * counted afresh, so parallel guesses can't slip past the limit; still contended after five reads
   * is answered as busy rather than judged uncounted
   */
  async function countPhoneTry(k: { PK: string; SK: string }): Promise<Row> {
    for (let tries = 0; tries < 5; tries++) {
      const row = await repo.table.get(k.PK, k.SK);
      if (!row?.hash || Date.parse(String(row.expiresAt)) < Date.now()) fail(409, "no_code", "Ask for a new code.");
      if (Number(row.attempts) >= CODE_TRIES) fail(429, "locked", "Too many wrong codes. Ask for a new one.");
      try {
        await repo.table.write([{ put: { ...row, attempts: Number(row.attempts) + 1, version: Number(row.version) + 1 }, guard: { version: Number(row.version) } }]);
        return row;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    fail(429, "busy", "Too many tries at once. Wait a moment and try again.");
  }

  /**
   * Check one code against the active authenticator. A verdict is returned only after the write that
   * counts it (a wrong try, or the used time step) has landed; a write that loses a race is read
   * again and decided afresh, so concurrent tries can't skip the count or reuse a code
   */
  async function useTotpCode(uid: string, code: string): Promise<"ok" | "wrong" | "used" | "locked" | "none" | "busy"> {
    for (let tries = 0; tries < 5; tries++) {
      const t = await repo.getTotp(uid);
      if (!t?.confirmed) return "none";
      if (t.lockedUntil && Date.parse(t.lockedUntil) > Date.now()) return "locked";
      const step = checkTotp(t.secret, code);
      const ok = step !== undefined && step > t.lastCounter;
      const fails = t.fails + 1;
      const next = ok
        ? { ...t, lastCounter: step, fails: 0, lockedUntil: undefined, version: t.version + 1 }
        : { ...t, fails: fails >= 5 ? 0 : fails, lockedUntil: fails >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : t.lockedUntil, version: t.version + 1 };
      try {
        await repo.saveTotp(uid, next, { version: t.version });
      } catch (e) {
        if (e instanceof ConflictError) continue;
        throw e;
      }
      return ok ? "ok" : step === undefined ? "wrong" : "used";
    }
    return "busy";
  }

  return { tokenOf, mayChangeFactors, refreshEnrolled, factorChanged, notice, textCode, countPhoneTry, useTotpCode };
}
