// apps/api/src/services.ts - Outside services behind small interfaces, so local dev and tests run
// without AWS.


import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  GetUserCommand,
  ListWebAuthnCredentialsCommand,
  StartWebAuthnRegistrationCommand,
  CompleteWebAuthnRegistrationCommand,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { DeleteObjectCommand, GetObjectCommand, GetObjectTaggingCommand, GetObjectAttributesCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { branded, esc, link, sentAt } from "./mail.ts";


/** The identity directory: create sign-in accounts for invitees and check strong sign-in */
export interface Directory {
  /** Create a passwordless user for an invited email; no-op if they already exist */
  ensureUser(email: string): Promise<void>;
  /** Has the user set up a passkey or an authenticator app? */
  hasStrongAuth(accessToken: string): Promise<boolean>;
  /** Begin adding a passkey: the browser's creation options */
  startPasskey(accessToken: string): Promise<unknown>;
  /** Finish adding a passkey with the browser's signed credential */
  finishPasskey(accessToken: string, credential: unknown): Promise<void>;
}


/** Outbound email */
export interface Mailer {
  // Send one message with plain text and HTML bodies
  send(to: string, subject: string, text: string, html: string): Promise<void>;
}


/** File storage: short-lived links for the browser to upload and download directly, and the scan result */
export interface Storage {
  // A link the browser PUTs the bytes to, with this content type
  putUrl(key: string, contentType: string, size: number): Promise<string>;
  // A download link that saves the file under its own name
  getUrl(key: string, name: string): Promise<string>;
  // The stored size in bytes, or undefined when nothing is there yet
  stat(key: string): Promise<number | undefined>;
  // The malware scan's verdict; nothing to read yet means it's still running
  scan(key: string): Promise<"pending" | "clean" | "infected">;
  // Remove the file
  remove(key: string): Promise<void>;
}


// Upload and download links live five minutes: long enough for a phone on a slow network
const LINK_SECONDS = 300;


/** S3, scanned by GuardDuty, which tags each object with its result */
export class S3Storage implements Storage {
  // Region and credentials come from the Lambda environment
  private s3 = new S3Client({});
  constructor(private bucket: string) {}

  // The declared size is signed into the link, so S3 refuses a body of any other length
  async putUrl(key: string, contentType: string, size: number) {
    return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }), { expiresIn: LINK_SECONDS, signableHeaders: new Set(["content-length", "content-type"]) });
  }

  // The bucket refuses this download until GuardDuty tags the object clean
  async getUrl(key: string, name: string) {
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: disposition }), { expiresIn: LINK_SECONDS });
  }

  // GetObjectAttributes is its own permission, so it works before the scan tags the file clean
  async stat(key: string) {
    try {
      return (await this.s3.send(new GetObjectAttributesCommand({ Bucket: this.bucket, Key: key, ObjectAttributes: ["ObjectSize"] }))).ObjectSize;
    } catch {
      return undefined;
    }
  }

  async scan(key: string) {
    try {
      const r = await this.s3.send(new GetObjectTaggingCommand({ Bucket: this.bucket, Key: key }));
      const v = r.TagSet?.find((t) => t.Key === "GuardDutyMalwareScanStatus")?.Value;
      return v === "NO_THREATS_FOUND" ? "clean" : v === "THREATS_FOUND" ? "infected" : "pending";
    } catch {
      return "pending"; // not uploaded yet
    }
  }

  async remove(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}


/** Cognito user pool as the directory */
export class CognitoDirectory implements Directory {
  // Region and credentials come from the Lambda environment
  private idp = new CognitoIdentityProviderClient({});
  constructor(private userPoolId: string) {}

  // Create the Cognito user for an invitee if missing; an existing user is fine
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
            // The invite proves the address belongs to the person we invited
            { Name: "email_verified", Value: "true" },
          ],
        }),
      );
    } catch (e) {
      if (!(e instanceof UsernameExistsException)) throw e;
    }
  }

  // Strong sign-in means an authenticator app (TOTP) or at least one passkey
  async hasStrongAuth(accessToken: string) {
    const [user, keys] = await Promise.all([
      this.idp.send(new GetUserCommand({ AccessToken: accessToken })),
      this.idp.send(new ListWebAuthnCredentialsCommand({ AccessToken: accessToken })).catch(() => undefined),
    ]);
    const totp = (user.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA");
    return totp || (keys?.Credentials?.length ?? 0) > 0;
  }

  // Passkey registration runs on the person's own access token; no admin rights involved
  async startPasskey(accessToken: string) {
    return (await this.idp.send(new StartWebAuthnRegistrationCommand({ AccessToken: accessToken }))).CredentialCreationOptions;
  }

  async finishPasskey(accessToken: string, credential: unknown) {
    await this.idp.send(new CompleteWebAuthnRegistrationCommand({ AccessToken: accessToken, Credential: credential as never }));
  }
}


/** SES v2 sender for invites and notices */
export class SesMailer implements Mailer {
  // Region and credentials come from the Lambda environment
  private ses = new SESv2Client({});
  constructor(private from: string) {}

  // One recipient per message, so addresses never leak between invitees
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


/** Local and test stand-ins */
/** Files in memory; the dev API serves the links, and everything counts as scanned clean */
export class MemoryStorage implements Storage {
  readonly files = new Map<string, { type: string; bytes: Uint8Array }>();
  async putUrl(key: string) {
    return `/1NEON/api/dev-files/${encodeURIComponent(key)}`;
  }
  async getUrl(key: string) {
    return `/1NEON/api/dev-files/${encodeURIComponent(key)}`;
  }
  async stat(key: string) {
    return this.files.get(key)?.bytes.length;
  }
  async scan(key: string) {
    return this.files.has(key) ? "clean" as const : "pending" as const;
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}



export class MemoryDirectory implements Directory {
  // Emails that would have accounts, for assertions in tests
  readonly users = new Set<string>();
  // Record the invitee instead of calling Cognito
  async ensureUser(email: string) {
    this.users.add(email);
  }
  // Local and test users count as strongly signed in, so admin actions can be exercised
  async hasStrongAuth() {
    return true;
  }
  // Passkeys can't be made without a browser; local runs return fixed options and accept anything
  async startPasskey() {
    return { challenge: "bG9jYWw", rp: { id: "localhost", name: "1NEON" }, user: { id: "bG9jYWw", name: "local", displayName: "local" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] };
  }
  async finishPasskey() {}
}


// Keeps sent mail in memory so tests can read invites
export class MemoryMailer implements Mailer {
  // Every message sent, oldest first
  readonly sent: { to: string; subject: string; text: string; html: string }[] = [];
  // Record the message instead of sending it
  async send(to: string, subject: string, text: string, html: string) {
    this.sent.push({ to, subject, text, html });
  }
}


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
