// apps/api/src/config.ts - Runtime configuration from the environment (set by Terraform on the
// Lambda function).


/** Everything the API reads from its environment */
export interface Config {
  // Deployment stage, reported by the health check
  env: "local" | "dev" | "prod";
  // AWS resources; unset locally, where the memory table and stand-ins run
  table?: string;
  docsBucket?: string;
  userPoolId?: string;
  clientId?: string;
  authDomain?: string;
  // Origin the browser sees, for OAuth redirects and links in email
  publicUrl: string;
  // Sender for invites, on the verified SES domain
  mailFrom?: string;
  /** The toll-free number (its ARN) texts come from; unset means no texts */
  smsFrom?: string;
  /** Emails that get the operator role (Pradeep). Never stored in the database */
  operatorEmails: string[];
  /** Local development only: trust an `x-dev-user` header instead of Cognito */
  devAuth: boolean;
}


/** Read the environment once at start-up; refuse dev sign-in anywhere on Lambda */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Dev sign-in trusts a header, so it must never reach a deployed function
  const onLambda = Boolean(env.AWS_LAMBDA_FUNCTION_NAME);
  const devAuth = env.DEV_AUTH === "1";
  if (devAuth && onLambda) throw new Error("DEV_AUTH must never be set on Lambda");
  // Operator emails compare case-insensitively
  return {
    env: (env.APP_ENV as Config["env"]) ?? "local",
    table: env.TABLE_NAME,
    docsBucket: env.DOCS_BUCKET,
    userPoolId: env.USER_POOL_ID,
    clientId: env.USER_POOL_CLIENT_ID,
    authDomain: env.AUTH_DOMAIN,
    publicUrl: env.PUBLIC_URL ?? "http://localhost:5173",
    mailFrom: env.MAIL_FROM,
    smsFrom: env.SMS_FROM || undefined,
    operatorEmails: (env.OPERATOR_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    devAuth,
  };
}
