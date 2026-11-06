// apps/api/src/mail.ts - neon1-branded email: the site's dark Matrix header over its light working
// surface, with inline styles only, since mail clients strip style sheets.


// HTML-escape values placed into an email
export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// Brand colors and type, as on neon1.tech
const VOID = "#0D0208", NEON = "#6CFFA8", BRAND = "#035704", PAPER = "#F2F4F2", INK = "#12241A", MUTED = "#56665c";
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const SANS = "Inter,-apple-system,'Segoe UI',Roboto,sans-serif";


/** What goes in one email; `code` and `button` are optional and appear in that order after the body */
export interface MailParts {
  preheader: string;
  heading: string;
  body: string; // trusted HTML, with any user values already escaped
  code?: string; // shown large in mono; may be Cognito's {####} placeholder
  button?: { label: string; url: string };
  note?: string; // small print under the button or code
}


/** One branded HTML email */
export function branded(p: MailParts) {
  const code = p.code
    ? `<p style="margin:28px 0 8px;text-align:center"><span style="display:inline-block;font:700 30px ${MONO};letter-spacing:.32em;color:${BRAND};background:#fff;border:1px solid rgba(3,87,4,.3);border-radius:10px;padding:14px 18px 14px 26px">${p.code}</span></p>`
    : "";
  const button = p.button
    ? `<p style="margin:30px 0 8px;text-align:center"><a href="${esc(p.button.url)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:13px 24px;border-radius:8px;font:600 14px ${MONO};letter-spacing:.02em">${esc(p.button.label)}</a></p>`
    : "";
  const note = p.note ? `<p style="margin:18px 0 0;text-align:center;color:${MUTED};font-size:13px">${p.note}</p>` : "";
  return `<!doctype html><html><head><meta name="color-scheme" content="light only"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:${PAPER};font:16px/1.6 ${SANS};color:${INK}">
<span style="display:none;max-height:0;overflow:hidden">${esc(p.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border-radius:12px;overflow:hidden;border:1px solid rgba(18,36,26,.1)">
<tr><td style="background:${VOID};padding:26px 28px 22px">
<p style="margin:0;font:700 22px ${MONO};letter-spacing:.06em;color:${NEON}">neon<span style="font-weight:700">1</span></p>
<p style="margin:4px 0 0;font:12px ${MONO};letter-spacing:.08em;color:#84a98c">1NEON · the neon1 project portal</p>
</td></tr>
<tr><td style="background:#fff;padding:30px 28px 32px">
<h1 style="margin:0 0 14px;font:600 22px/1.3 ${SANS};letter-spacing:-.01em;color:${BRAND}">${esc(p.heading)}</h1>
${p.body}${code}${button}${note}
</td></tr>
</table>
<p style="margin:18px 0 0;font:12px ${MONO};color:${MUTED}">neon1 · 1 is glad to be of service.</p>
</td></tr></table>
</body></html>`;
}
