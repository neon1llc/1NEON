// apps/api/src/handlers/auth-triggers.ts - Cognito triggers. Pre sign-up: only invited, verified
// emails may get an account, including first-time Google sign-ins (which Cognito creates even with
// admin-only sign-up).


import type { PreSignUpTriggerEvent } from "aws-lambda";
import { DynamoTable } from "../store/dynamo.ts";
import { Repo } from "../store/repo.ts";


// TABLE_NAME is set by Terraform on the trigger function
const repo = new Repo(new DynamoTable(process.env.TABLE_NAME!));


/** Pre sign-up: refuse any first sign-in whose email has no invite */
export async function handler(event: PreSignUpTriggerEvent) {
  if (event.triggerSource === "PreSignUp_AdminCreateUser") return event; // our own invite path
  // Self sign-up and federated sign-in are admitted only for an invited email
  const email = String(event.request.userAttributes.email ?? "").toLowerCase();
  if (!email || !(await repo.userIdForEmail(email))) {
    throw new Error("This email hasn't been invited to 1NEON. Ask your organization's admin for an invite.");
  }
  return event;
}
