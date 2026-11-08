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
