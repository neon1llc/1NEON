// apps/api/src/sms.ts - Text message rules: consent is bound to one verified number, every send is
// within per-person and account-wide daily budgets, and texts say only that something is waiting,
// with a link, never client names, file names, or project details.


import type { User } from "@1neon/domain";
import type { Repo } from "./store/repo.ts";


// The consent wording version shown on the profile; recorded with each yes
export const SMS_POLICY = "2026-11-09";
// A verification code lives ten minutes, allows five tries, and a person may ask for three an hour
export const CODE_MS = 10 * 60 * 1000;
export const CODE_TRIES = 5;
export const CODES_PER_HOUR = 3;
// Daily ceilings: per person for notices, and for every text the account sends (codes included)
export const PERSON_DAILY = 10;
export const ACCOUNT_DAILY = 200;


/** A phone number as E.164 (+15551234567), or undefined if it doesn't read as a US or full international number */
export function e164(phone: string | undefined) {
  const raw = (phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}


/** Ready for notices: agreed, not opted out, and the verified number is still the profile's number */
export function smsReady(u: User) {
  return Boolean(u.smsConsentAt && u.smsVerifiedAt && u.smsPhone && !u.smsOptedOutAt && u.smsPhone === e164(u.phone));
}


/** Where texts stand for this person, for the profile to explain */
export function smsState(u: User, available: boolean): "unavailable" | "no_number" | "not_agreed" | "opted_out" | "unverified" | "ready" {
  if (!available) return "unavailable";
  if (!e164(u.phone)) return "no_number";
  if (u.smsOptedOutAt && !u.smsConsentAt) return "opted_out";
  if (!u.smsConsentAt) return "not_agreed";
  return smsReady(u) ? "ready" : "unverified";
}


/**
 * The profile fields after a save. A changed number clears consent and verification, so nothing is
 * sent to a new number until its holder proves it and agrees; turning texts off clears consent
 */
export function smsAfterSave(u: User, phone: string | undefined, consent: boolean | undefined): Partial<User> {
  const changed = phone !== undefined && e164(phone) !== e164(u.phone);
  const out: Partial<User> = {};
  if (changed) Object.assign(out, { smsConsentAt: undefined, smsPolicy: undefined, smsPhone: undefined, smsVerifiedAt: undefined });
  if (consent === false) Object.assign(out, { smsConsentAt: undefined, smsPolicy: undefined });
  if (consent === true && (changed || !u.smsConsentAt)) Object.assign(out, { smsConsentAt: new Date().toISOString(), smsPolicy: SMS_POLICY, smsOptedOutAt: undefined });
  // Agreeing again after a STOP needs a fresh code: the carrier keeps blocking the number until its
  // holder texts START, and the code is what shows they did
  if (consent === true && !u.smsConsentAt && u.smsOptedOutAt) Object.assign(out, { smsPhone: undefined, smsVerifiedAt: undefined });
  return out;
}


/** The only notice text: no client, project, or file names; the portal shows the detail after sign-in */
export function textNotice(publicUrl: string) {
  return `1NEON: there's something new for you. See it at ${publicUrl.replace(/^https?:\/\//, "")}/1NEON after you sign in. Reply STOP to opt out, HELP for help.`;
}


/** The verification text */
export function codeText(code: string) {
  return `1NEON code: ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this text. Reply STOP to opt out.`;
}


/**
 * A fresh six-digit code and its hash (only the hash is stored). Web Crypto, not node:crypto, so the
 * browser demo runs the same code; draws above the last whole million are redrawn to stay uniform
 */
export async function newCode(uid: string) {
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= 4_294_000_000);
  const code = String(buf[0]! % 1_000_000).padStart(6, "0");
  return { code, hash: await hashCode(uid, code) };
}


/** Hash a code with the person's ID, so a stored hash is useless for anyone else */
export async function hashCode(uid: string, code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${uid}:${code.replace(/\D/g, "")}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}


/** Count one text against the person's and the account's budgets for today; false means over */
export async function smsSendAllowed(repo: Repo, uid: string) {
  const day = new Date().toISOString().slice(0, 10);
  const person = await repo.table.increment(`USER#${uid}`, `SMSCOUNT#${day}`);
  if (person > PERSON_DAILY) return false;
  return accountAllows(repo, day);
}


/** Count one text against the account's daily budget */
export async function accountAllows(repo: Repo, day = new Date().toISOString().slice(0, 10)) {
  return (await repo.table.increment("COUNTER", `SMS#${day}`)) <= ACCOUNT_DAILY;
}


/** The carrier's "this number replied STOP" refusal from AWS End User Messaging */
export function isOptOut(e: unknown) {
  const err = e as { name?: string; Reason?: string; message?: string };
  return err?.Reason === "DESTINATION_PHONE_NUMBER_OPTED_OUT" || /opted.?out/i.test(String(err?.message ?? ""));
}
