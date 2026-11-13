// apps/api/src/handlers/auth-triggers.ts - Cognito triggers. Pre sign-up: only invited, verified
// emails may get an account, including first-time Google sign-ins (which Cognito creates even with
// admin-only sign-up). Custom message: sign-in and verification codes in the neon1 email design.


import type { CustomMessageTriggerEvent, PreSignUpTriggerEvent } from "aws-lambda";
import { signInCodeEmail } from "../emails.ts";
import { branded, link } from "../mail.ts";
import { DynamoTable } from "../store/dynamo.ts";
import { Repo } from "../store/repo.ts";


// TABLE_NAME is set by Terraform on the trigger function
const repo = new Repo(new DynamoTable(process.env.TABLE_NAME!));
// The sign-in page that codes are entered on (PUBLIC_URL is set by Terraform; dev.neon1.tech in dev)
const PORTAL = `${process.env.PUBLIC_URL ?? "https://neon1.tech"}/1NEON/`;


/** One function serves both triggers; Cognito names the trigger in triggerSource */
export async function handler(event: PreSignUpTriggerEvent | CustomMessageTriggerEvent) {
  if (event.triggerSource.startsWith("CustomMessage_")) return message(event as CustomMessageTriggerEvent);
  return preSignUp(event as PreSignUpTriggerEvent);
}


// The wording for each kind of code Cognito sends; {####} is where Cognito puts the code. Subjects
// carry no code: Cognito documents the placeholder for the message body only
const CODES: Record<string, { subject: string; label: string; heading: string; lead: string }> = {
  CustomMessage_Authentication: { subject: "Your portal sign-in code", label: "your sign-in code", heading: "Your sign-in code", lead: `Use this code to sign in to ${link("1NEON", PORTAL)}.` },
  CustomMessage_ForgotPassword: { subject: "Your 1NEON reset code", label: "your reset code", heading: "Your reset code", lead: "Enter this code to choose a new password." },
  CustomMessage_UpdateUserAttribute: { subject: "Confirm your new email for 1NEON", label: "confirm your email", heading: "Confirm your new email", lead: `Enter this code in ${link("1NEON", PORTAL)} to confirm this address.` },
  CustomMessage_VerifyUserAttribute: { subject: "Confirm your email for 1NEON", label: "confirm your email", heading: "Confirm your email", lead: `Enter this code in ${link("1NEON", PORTAL)} to confirm this address.` },
};


/** Custom message: put the code in the branded design; any other message keeps Cognito's default */
export function message(event: CustomMessageTriggerEvent, at = new Date()) {
  const kind = CODES[event.triggerSource];
  if (!kind) return event;
  // Sign-in codes share their template with the browser demo
  if ((event.triggerSource as string) === "CustomMessage_Authentication") {
    const mail = signInCodeEmail({ code: (event as CustomMessageTriggerEvent).request.codeParameter, portal: PORTAL, at });
    event.response.emailSubject = mail.subject;
    event.response.emailMessage = mail.html;
    return event;
  }
  event.response.emailSubject = kind.subject;
  event.response.emailMessage = branded({
    label: kind.label,
    preheader: `${kind.heading}: it works for a few minutes.`,
    heading: kind.heading,
    body: `<p style="margin:0">${kind.lead}</p>`,
    code: event.request.codeParameter,
    note: "It works for a few minutes. If you didn't ask for it, you can ignore this email.",
    at,
  });
  return event;
}


/** Pre sign-up: refuse any first sign-in whose email has no invite */
async function preSignUp(event: PreSignUpTriggerEvent) {
  if (event.triggerSource === "PreSignUp_AdminCreateUser") return event; // our own invite path
  // Self sign-up and federated sign-in are admitted only for an invited email
  const email = String(event.request.userAttributes.email ?? "").toLowerCase();
  if (!email || !(await repo.userIdForEmail(email))) {
    throw new Error("This email hasn't been invited to 1NEON. Ask your organization's admin for an invite.");
  }
  return event;
}
