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
import { SendTextMessageCommand, PinpointSMSVoiceV2Client } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";


/** The identity directory: create sign-in accounts for invitees and check strong sign-in */
export interface Directory {
  /** Create a passwordless user for an invited email; no-op if they already exist */
  ensureUser(email: string): Promise<void>;
  /** The strong factors Cognito holds for this person. Throws when it can't tell, so callers can
   * treat the answer as unknown instead of as "none" */
  factors(accessToken: string): Promise<{ totp: boolean; passkeys: number }>;
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


/** What storage reports for a key; `code` is the provider's error name, safe to log */
export type Inspection = { kind: "present"; size: number } | { kind: "absent" } | { kind: "denied" } | { kind: "error"; code: string };
/** The scan's verdict, plus "absent" (no object) and "error" (couldn't ask), which aren't verdicts */
export type ScanVerdict = "pending" | "clean" | "infected" | "unsupported" | "failed" | "absent" | "error";


/** File storage: short-lived links for the browser to upload and download directly, and the scan result */
export interface Storage {
  // A link the browser PUTs the bytes to, with this content type
  putUrl(key: string, contentType: string, size: number): Promise<string>;
  // A download link that saves the file under its own name
  // With `inline`, the browser shows it in a tab instead of saving it (viewable types only, see VIEWABLE in the domain)
  getUrl(key: string, name: string, inline?: string): Promise<string>;
  // What is stored at the key, with each outcome told apart: the size, nothing there, refused (the
  // bucket denies reads until the scan tags a file clean), or a provider problem worth retrying
  inspect(key: string): Promise<Inspection>;
  // The malware scan's verdict: no tag yet means still running; absent and error are kept distinct
  scan(key: string): Promise<ScanVerdict>;
  // Remove the file
  remove(key: string): Promise<void>;
}


/** Outbound text messages; `to` is an E.164 number such as +15551234567 */
export interface Texter {
  send(to: string, body: string): Promise<void>;
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
  async getUrl(key: string, name: string, inline?: string) {
    const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`;
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: disposition, ...(inline ? { ResponseContentType: inline } : {}) }), { expiresIn: LINK_SECONDS });
  }

  // GetObjectAttributes needs s3:GetObject as well as its own permission, so while the bucket denies
  // reads of an unscanned object this answers "denied"; after the clean tag it reads the size
  async inspect(key: string): Promise<Inspection> {
    try {
      const size = (await this.s3.send(new GetObjectAttributesCommand({ Bucket: this.bucket, Key: key, ObjectAttributes: ["ObjectSize"] }))).ObjectSize;
      return size === undefined ? { kind: "error", code: "NoSize" } : { kind: "present", size };
    } catch (e) {
      return s3Failure(e);
    }
  }

  // Tags aren't covered by the read deny, so the verdict can be read while the scan runs. GuardDuty
  // writes NO_THREATS_FOUND, THREATS_FOUND, UNSUPPORTED, ACCESS_DENIED, or FAILED
  async scan(key: string): Promise<ScanVerdict> {
    try {
      const r = await this.s3.send(new GetObjectTaggingCommand({ Bucket: this.bucket, Key: key }));
      const v = r.TagSet?.find((t) => t.Key === "GuardDutyMalwareScanStatus")?.Value;
      if (v === undefined) return "pending";
      return v === "NO_THREATS_FOUND" ? "clean" : v === "THREATS_FOUND" ? "infected" : v === "UNSUPPORTED" ? "unsupported" : "failed";
    } catch (e) {
      const f = s3Failure(e);
      return f.kind === "absent" ? "absent" : "error";
    }
  }

  async remove(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}


/** An S3 error as an inspection: missing object, refused, or anything else by its error name */
function s3Failure(e: unknown): Inspection {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = err.$metadata?.httpStatusCode;
  if (err.name === "NoSuchKey" || err.name === "NotFound" || status === 404) return { kind: "absent" };
  if (err.name === "AccessDenied" || status === 403) return { kind: "denied" };
  return { kind: "error", code: err.name || "Error" };
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
            // Marked verified so Cognito will send sign-in codes there. The invite itself proves
            // nothing; the address is proved when its holder signs in with a code sent to it
            { Name: "email_verified", Value: "true" },
          ],
        }),
      );
    } catch (e) {
      if (!(e instanceof UsernameExistsException)) throw e;
    }
  }

  // Cognito's own authenticator setting and passkeys. Both lookups must answer: a failed passkey
  // list is "don't know", never "no passkeys", so it can't make an enrolled account look unenrolled
  async factors(accessToken: string) {
    const [user, keys] = await Promise.all([
      this.idp.send(new GetUserCommand({ AccessToken: accessToken })),
      this.idp.send(new ListWebAuthnCredentialsCommand({ AccessToken: accessToken, MaxResults: 20 })),
    ]);
    return { totp: (user.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA"), passkeys: keys.Credentials?.length ?? 0 };
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


/** Texts through AWS End User Messaging, from 1NEON's toll-free number; replies of STOP opt out on AWS's side */
export class AwsTexter implements Texter {
  private client = new PinpointSMSVoiceV2Client({});
  constructor(private from: string) {}
  async send(to: string, body: string) {
    await this.client.send(new SendTextMessageCommand({ DestinationPhoneNumber: to, OriginationIdentity: this.from, MessageBody: body, MessageType: "TRANSACTIONAL" }));
  }
}


// The local and test stand-ins and the email templates live in their own files, free of AWS, so the
// browser demo can run the same API; they're re-exported here for existing imports
export { MemoryDirectory, MemoryMailer, MemoryStorage, MemoryTexter } from "./local.ts";
export { inviteEmail, passkeyEmail } from "./emails.ts";
