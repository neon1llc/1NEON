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
