// apps/api/src/emails.ts - The emails 1NEON sends, as plain text plus branded HTML.


import { branded, esc, link, sentAt } from "./mail.ts";


/** The invite email: plain text plus the branded HTML version */
export function inviteEmail(opts: { orgName: string; inviter: string; url: string; at?: Date }) {
  const at = opts.at ?? new Date();
  const subject = `You're invited to ${opts.orgName} on 1NEON`;
  const about = "1NEON keeps your projects with neon1 in one place: what you need, the work, how it's measured, and how it becomes the normal way you work.";
  const text = [
    `${opts.inviter} invited you to ${opts.orgName} on 1NEON, the neon1 project portal.`,
    "",
    about,
    "",
    `Join here (sign in with a code sent to this email): ${opts.url}`,
    "",
    "If you weren't expecting this, you can ignore it.",
    "",
    "neon1 · 1 is glad to be of service.",
    sentAt(at),
  ].join("\n");
  const html = branded({
    label: "your invitation",
    preheader: `${opts.inviter} invited you to ${opts.orgName}.`,
    heading: `You're invited to ${opts.orgName}`,
    body: `<p style="margin:0 0 12px">${esc(opts.inviter)} invited you to <b>${esc(opts.orgName)}</b> on ${link("1NEON", "https://neon1.tech/1NEON/")}.</p><p style="margin:0;color:#56665c">${esc(about)}</p>`,
    button: { label: `Join ${opts.orgName}`, url: opts.url },
    note: "You'll sign in with a code sent to this email. If you weren't expecting this, you can ignore it.",
    at,
  });
  return { subject, text, html };
}


/** Notice that a passkey was added, with where to check */
export function passkeyEmail(opts: { url: string; what?: string; at?: Date }) {
  const at = opts.at ?? new Date();
  const what = opts.what ?? "A passkey";
  const subject = `${what} was added to your 1NEON account`;
  const text = [
    `${what} was just added to your 1NEON account. You can now use it to confirm it's you for admin actions.`,
    "",
    `If this wasn't you, reply to this email right away. Your profile: ${opts.url}`,
    "",
    "neon1 · 1 is glad to be of service.",
    sentAt(at),
  ].join("\n");
  const html = branded({
    label: "a sign-in method was added",
    preheader: `${what} was just added to your account.`,
    heading: `${what} was added`,
    body: `<p style="margin:0">${what} was just added to your 1NEON account. You can now use it to confirm it's you for admin actions.</p>`,
    button: { label: "Open your profile", url: opts.url },
    note: "If this wasn't you, reply to this email right away.",
    at,
  });
  return { subject, text, html };
}


/** Notice that a sign-in method was removed or replaced; it goes out even when the person did it */
export function factorRemovedEmail(opts: { url: string; what: string; how: "removed" | "replaced"; at?: Date }) {
  const at = opts.at ?? new Date();
  const subject = `${opts.what} was ${opts.how} on your 1NEON account`;
  const after = opts.how === "replaced" ? "Codes from the old one no longer work." : "It can no longer be used to confirm it's you.";
  const text = [
    `${opts.what} was just ${opts.how} on your 1NEON account. ${after} Other signed-in sessions will need to confirm it's you again before admin actions.`,
    "",
    `If this wasn't you, reply to this email right away. Your profile: ${opts.url}`,
    "",
    "neon1 · 1 is glad to be of service.",
    sentAt(at),
  ].join("\n");
  const html = branded({
    label: "a sign-in method changed",
    preheader: `${opts.what} was just ${opts.how}.`,
    heading: `${opts.what} was ${opts.how}`,
    body: `<p style="margin:0">${esc(opts.what)} was just ${opts.how} on your 1NEON account. ${esc(after)} Other signed-in sessions will need to confirm it's you again before admin actions.</p>`,
    button: { label: "Open your profile", url: opts.url },
    note: "If this wasn't you, reply to this email right away.",
    at,
  });
  return { subject, text, html };
}


/** A notification by email: who did what, where, with a link to look */
export function noticeEmail(opts: { orgName: string; by: string; summary: string; url: string; important?: boolean; at?: Date }) {
  const at = opts.at ?? new Date();
  const subject = `${opts.orgName}: ${opts.summary}`.slice(0, 140);
  const text = [
    `${opts.by} in ${opts.orgName}: ${opts.summary}`,
    "",
    `Open 1NEON: ${opts.url}`,
    "",
    "Choose which of these reach you in your 1NEON profile, under Notifications.",
    sentAt(at),
  ].join("\n");
  const html = branded({
    label: opts.important ? "something important changed" : "something changed",
    preheader: `${opts.by}: ${opts.summary}`,
    heading: opts.summary,
    body: `<p style="margin:0">${esc(opts.by)} in <b>${esc(opts.orgName)}</b>.</p>`,
    button: { label: "Open 1NEON", url: opts.url },
    note: "Choose which of these reach you in your 1NEON profile, under Notifications.",
    at,
  });
  return { subject, text, html };
}
