// apps/api/src/mail.ts - neon1-branded email: the neon1 mark over a dark Matrix header and the
// site's light working surface, with inline styles only, since mail clients strip style sheets.


// HTML-escape values placed into an email
export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// Brand colors and type, as on neon1.tech
const VOID = "#0D0208", NEON = "#6CFFA8", BRAND = "#035704", PAPER = "#F2F4F2", INK = "#12241A", MUTED = "#56665c";
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
  heading: string;
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
  const signoff = `<p style="margin:26px 0 0;padding-top:16px;border-top:1px solid rgba(18,36,26,.1);font:12px/1.6 ${MONO};color:${MUTED}">${link("neon1", "https://neon1.tech/")} · 1 is glad to be of service.<br>${sentAt(p.at ?? new Date())}</p>`;
  return `<!doctype html><html><head><meta name="color-scheme" content="light only"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:${PAPER};font:16px/1.6 ${SANS};color:${INK}">
<span style="display:none;max-height:0;overflow:hidden">${esc(p.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:24px 16px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 14px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;padding-right:10px"><img src="${MARK}" width="32" height="32" alt="neon1" style="display:block;width:32px;height:32px;border:0"></td>
<td style="vertical-align:middle;font:600 14px ${MONO};letter-spacing:.04em;color:${INK}">neon1 <span style="color:${BRAND}">·</span> ${esc(p.label)}</td>
</tr></table>
</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;overflow:hidden;border:1px solid rgba(18,36,26,.1)">
<tr><td style="background:${VOID};padding:22px 28px">
<h1 style="margin:0;font:600 22px/1.3 ${MONO};letter-spacing:.01em;color:${NEON}">${esc(p.heading)}</h1>
</td></tr>
<tr><td style="background:#fff;padding:28px 28px 24px">
${p.body}${code}${button}${note}${signoff}
</td></tr>
</table>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
