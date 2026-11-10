// apps/api/src/lib/assurance.ts - Second-step helpers shared by sign-in, profile, and factor routes:
// the factor-change rule, enrollment hints, security notices, and counted code checks.


import type { User } from "@1neon/domain";
import type { Context } from "hono";
import { factorInventory, type FactorInventory } from "../factors.ts";
import { checkTotp } from "../totp.ts";
import { newId } from "@1neon/domain";
import { keys } from "../store/repo.ts";
import { ConflictError, type Row, type WriteOp } from "../store/types.ts";
import { bounded } from "../outbox.ts";
import { accountAllows, isOptOut, CODE_MS, CODE_TRIES, CODES_PER_HOUR, CODES_PER_HOUR_PERSON, newCode } from "../sms.ts";
import { fail, now, who, type Env } from "./http.ts";
import type { Kit } from "./kit.ts";


/** One code text in the person's send history */
interface SmsSend {
  at: string;
  to: string;
  purpose: "confirm" | "verify";
}


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
   * Text one code to a number and keep only its hash under this person's key. The code is bound to
   * its purpose, the session that asked, and the number it went to. The send is recorded in a
   * separate history row in the same transaction that stores the code, so the hourly limits (per
   * purpose and number, and per person) still count it after the code is used or replaced. The
   * account's daily budget is counted once per send. Shared by number checks and confirming it's you
   */
  async function textCode(user: User, purpose: "confirm" | "verify", jti: string | undefined, to: string, words: (code: string) => string) {
    const texter = d.texter;
    if (!texter) fail(503, "texts_unavailable", "Texts aren't available yet. Email notices still work.");
    const k = keys.smsChallenge(user.id, purpose);
    const h = keys.smsSent(user.id);
    let counted = false;
    let code: string | undefined;
    for (let tries = 0; tries < 5 && code === undefined; tries++) {
      const [prev, hist] = await Promise.all([repo.table.get(k.PK, k.SK), repo.table.get(h.PK, h.SK)]);
      const fresh = (t: string) => Date.now() - Date.parse(t) < 3600_000;
      const sends = ((hist?.sends as SmsSend[] | undefined) ?? []).filter((x) => fresh(x.at));
      // Code rows written before the history row existed carried their own send times; they still count
      const legacy = ((prev?.sentAt as string[] | undefined) ?? []).filter(fresh).length;
      const same = sends.filter((x) => x.to === to && x.purpose === purpose).length + legacy;
      if (same >= CODES_PER_HOUR || sends.length + legacy >= CODES_PER_HOUR_PERSON) fail(429, "too_many_codes", "Too many codes this hour. Try again later.");
      if (!counted) {
        if (!(await accountAllows(repo))) fail(429, "texts_busy", "Texts are paused for today. Try again tomorrow.");
        counted = true;
      }
      const next = await newCode(user.id);
      const at = now();
      const ttl = Math.floor(Date.now() / 1000) + 3600;
      const challenge = { ...k, id: newId("sms"), purpose, jti: jti ?? "dev", hash: next.hash, phone: to, expiresAt: new Date(Date.now() + CODE_MS).toISOString(), attempts: 0, version: Number(prev?.version ?? 0) + 1, ttl };
      const history = { ...h, sends: [...sends, { at, to, purpose }], version: Number(hist?.version ?? 0) + 1, ttl };
      try {
        await repo.table.write([
          { put: history, guard: hist ? { version: Number(hist.version) } : { create: true } },
          { put: challenge, guard: prev ? { version: Number(prev.version) } : { create: true } },
        ]);
        code = next.code;
      } catch (e) {
        // Another request for a code landed first: read both rows again and count afresh
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    if (code === undefined) fail(429, "busy", "Too many requests at once. Wait a moment and try again.");
    // The person waits for this one, so it gets the same time limit as queued sends
    try {
      await bounded((signal) => texter.send(to, words(code), signal), 5_000);
    } catch (e) {
      if (isOptOut(e)) fail(409, "carrier_opted_out", "This number replied STOP earlier. Text START to the number 1NEON texts come from, then ask for a code again.");
      throw e;
    }
  }

  /**
   * Count one try at a texted code before any verdict, and return the row as it now stands (its live
   * version). Only the session that asked for the code, for this purpose, may try it; anything else
   * reads as no code. A write that loses a race is read again and counted afresh, so parallel guesses
   * can't slip past the limit; still contended after five reads is answered as busy
   */
  async function countPhoneTry(uid: string, purpose: "confirm" | "verify", jti: string | undefined): Promise<Row> {
    const k = keys.smsChallenge(uid, purpose);
    for (let tries = 0; tries < 5; tries++) {
      const row = await repo.table.get(k.PK, k.SK);
      if (!row?.hash || Date.parse(String(row.expiresAt)) < Date.now()) fail(409, "no_code", "Ask for a new code.");
      // Rows from before codes were bound have no purpose or session and fail closed here
      if (row.purpose !== purpose || row.jti !== (jti ?? "dev")) fail(409, "no_code", "Ask for a new code.");
      if (Number(row.attempts) >= CODE_TRIES) fail(429, "locked", "Too many wrong codes. Ask for a new one.");
      const live = { ...row, attempts: Number(row.attempts) + 1, version: Number(row.version) + 1 };
      try {
        await repo.table.write([{ put: live, guard: { version: Number(row.version), id: String(row.id) } }]);
        return live;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    fail(429, "busy", "Too many tries at once. Wait a moment and try again.");
  }

  /**
   * Use up a matched code: delete exactly the version that was counted, in the same transaction as
   * what the code proves (`also`). A concurrent use, a newer code, or another try in between changes
   * the row, so at most one use succeeds and an old answer can never remove a newer code
   */
  async function consumeCode(live: Row, also: WriteOp[]) {
    try {
      await repo.table.write([{ delete: { PK: live.PK, SK: live.SK }, guard: { version: Number(live.version), id: String(live.id) } }, ...also]);
    } catch (e) {
      if (e instanceof ConflictError) fail(409, "no_code", "That code was just used or replaced. Ask for a new one.");
      throw e;
    }
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

  return { tokenOf, mayChangeFactors, refreshEnrolled, factorChanged, notice, textCode, countPhoneTry, consumeCode, useTotpCode };
}
