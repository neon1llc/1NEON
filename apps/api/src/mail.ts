// apps/api/src/mail.ts - neon1-branded email: the neon1 mark and a brand-green label over one
// rounded white card on the site's light surface, with inline styles only, since mail clients
// strip style sheets.


// HTML-escape values placed into an email
export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// Brand colors and type, as on neon1.tech
const BRAND = "#035704", PAPER = "#F2F4F2", INK = "#12241A", MUTED = "#56665c";
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const SANS = "Inter,-apple-system,'Segoe UI',Roboto,sans-serif";

// The mark the site serves for mail: 96px dark green on transparent, shown at 32px for sharp screens
const MARK = "https://neon1.tech/shared/mail/neon1-mark.png";
// Links read as links without shouting: brand green with a thin underline
const LINK = `color:${BRAND};text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px`;


/** A subtle brand link for email bodies */
export function link(label: string, url: string) {
  return `<a href="${esc(url)}" style="${LINK}">${esc(label)}</a>`;
}


/** When a message was sent, in UTC, for its sign-off */
export function sentAt(at: Date) {
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(at);
  return `Sent ${when} UTC`;
}


/** What goes in one email; `code` and `button` are optional and appear in that order after the body */
export interface MailParts {
  label: string; // lowercase, after "neon1 ·" at the top, such as "your sign-in code"
  preheader: string;
  heading: string; // for the plain-text sense of the message; the card itself opens with the body
  body: string; // trusted HTML, with any user values already escaped
  code?: string; // shown large in mono; may be Cognito's {####} placeholder
  button?: { label: string; url: string };
  note?: string; // small print under the button or code
  at?: Date; // send time for the sign-off; defaults to now
}


/** One branded HTML email */
export function branded(p: MailParts) {
  // The code is one unbroken text node that selects whole on a tap or double click; spacing is
  // letter-spacing only, so nothing extra lands in the clipboard
  const code = p.code
    ? `<p style="margin:28px 0 8px;text-align:center"><span style="display:inline-block;font:700 30px ${MONO};letter-spacing:.2em;color:${BRAND};background:#fff;border:1px solid rgba(3,87,4,.3);border-radius:10px;padding:14px 14px 14px 20px;-webkit-user-select:all;user-select:all">${p.code}</span></p>`
    : "";
  const button = p.button
    ? `<p style="margin:30px 0 8px;text-align:center"><a href="${esc(p.button.url)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:13px 24px;border-radius:8px;font:600 14px ${MONO};letter-spacing:.02em">${esc(p.button.label)}</a></p>`
    : "";
  const note = p.note ? `<p style="margin:18px 0 0;text-align:center;color:${MUTED};font-size:13px">${p.note}</p>` : "";
  // The sign-off sits inside the card and ends with the send time. Gmail collapses trailing content
  // that repeats earlier messages in a thread, and sign-in codes thread under one subject, so a
  // detail unique to each message keeps the sign-off on screen
  // Each sign-off line stays on one line, small enough to fit a phone's mail view
  const line = `white-space:nowrap;font:11px/1.7 ${MONO};color:${MUTED}`;
  const signoff = `<div style="margin:26px 0 0;padding-top:14px;border-top:1px solid rgba(18,36,26,.1)"><div style="${line}">${link("neon1", "https://neon1.tech/")} · 1 is glad to be of service.</div><div style="${line}">${sentAt(p.at ?? new Date())}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:${PAPER};font:16px/1.6 ${SANS};color:${INK}">
<span style="display:none;max-height:0;overflow:hidden">${esc(p.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:20px 10px 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 14px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;padding-right:10px"><img src="${MARK}" width="32" height="32" alt="neon1" style="display:block;width:32px;height:32px;border:0"></td>
<td style="vertical-align:middle;white-space:nowrap;font:600 14px ${MONO};letter-spacing:.04em;color:${BRAND}">neon1 · ${esc(p.label)}</td>
</tr></table>
</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid rgba(18,36,26,.1)">
<tr><td style="background:#fff;border-radius:12px;padding:26px 22px 22px">
${p.body}${code}${button}${note}${signoff}
</td></tr>
</table>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
