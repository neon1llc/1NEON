// Outside services behind small interfaces, so local dev and tests run without AWS.
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  GetUserCommand,
  ListWebAuthnCredentialsCommand,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

/** The sign-in directory (Cognito). */
export interface Directory {
  /** Create a passwordless user for an invited email; no-op if they already exist. */
  ensureUser(email: string): Promise<void>;
  /** Has the user set up a passkey or an authenticator app? */
  hasStrongAuth(accessToken: string): Promise<boolean>;
}

export interface Mailer {
  send(to: string, subject: string, text: string, html: string): Promise<void>;
}

export class CognitoDirectory implements Directory {
  private idp = new CognitoIdentityProviderClient({});
  constructor(private userPoolId: string) {}

  async ensureUser(email: string) {
    try {
      await this.idp.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: email }));
      return;
    } catch {
      /* not found: create */
    }
    try {
      await this.idp.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          MessageAction: "SUPPRESS", // 1NEON sends its own invite email
          UserAttributes: [
            { Name: "email", Value: email },
            { Name: "email_verified", Value: "true" },
          ],
        }),
      );
    } catch (e) {
      if (!(e instanceof UsernameExistsException)) throw e;
    }
  }

  async hasStrongAuth(accessToken: string) {
    const [user, keys] = await Promise.all([
      this.idp.send(new GetUserCommand({ AccessToken: accessToken })),
      this.idp.send(new ListWebAuthnCredentialsCommand({ AccessToken: accessToken })).catch(() => undefined),
    ]);
    const totp = (user.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA");
    return totp || (keys?.Credentials?.length ?? 0) > 0;
  }
}

export class SesMailer implements Mailer {
  private ses = new SESv2Client({});
  constructor(private from: string) {}

  async send(to: string, subject: string, text: string, html: string) {
    await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text }, Html: { Data: html } } } },
      }),
    );
  }
}

/** Local and test stand-ins. */
export class MemoryDirectory implements Directory {
  readonly users = new Set<string>();
  async ensureUser(email: string) {
    this.users.add(email);
  }
  async hasStrongAuth() {
    return true;
  }
}

export class MemoryMailer implements Mailer {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  async send(to: string, subject: string, text: string) {
    this.sent.push({ to, subject, text });
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function inviteEmail(opts: { orgName: string; inviter: string; url: string }) {
  const subject = `You're invited to ${opts.orgName} on 1NEON`;
  const text = [
    `${opts.inviter} invited you to ${opts.orgName} on 1NEON, the neon1 project portal.`,
    "",
    "1NEON keeps your projects with neon1 in one place: what you need, the work, how it's measured, and what comes next.",
    "",
    `Join here (sign in with a code sent to this email): ${opts.url}`,
    "",
    "If you weren't expecting this, you can ignore it.",
    "",
    "neon1 · 1 is glad to be of service.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F2F4F2;font:16px/1.6 -apple-system,Segoe UI,Inter,sans-serif;color:#12241A">
<div style="max-width:520px;margin:0 auto;padding:40px 24px">
<p style="font:600 15px ui-monospace,Menlo,monospace;color:#035704;letter-spacing:.06em;margin:0 0 24px">1NEON</p>
<p>${esc(opts.inviter)} invited you to <b>${esc(opts.orgName)}</b> on 1NEON, the neon1 project portal.</p>
<p style="color:#56665c">1NEON keeps your projects with neon1 in one place: what you need, the work, how it's measured, and what comes next.</p>
<p style="margin:32px 0"><a href="${esc(opts.url)}" style="background:#035704;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font:500 14px ui-monospace,Menlo,monospace">Join ${esc(opts.orgName)}</a></p>
<p style="color:#56665c;font-size:14px">You'll sign in with a code sent to this email. If you weren't expecting this, you can ignore it.</p>
<p style="color:#56665c;font-size:13px;margin-top:40px">neon1 · 1 is glad to be of service.</p>
</div></body></html>`;
  return { subject, text, html };
}
