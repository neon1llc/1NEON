// Runtime configuration from the environment (set by Terraform on the Lambda function).

/** Everything the API reads from its environment. */
export interface Config {
  env: "local" | "dev" | "prod";
  table?: string;
  docsBucket?: string;
  userPoolId?: string;
  clientId?: string;
  authDomain?: string;
  publicUrl: string;
  mailFrom?: string;
  /** Emails that get the operator role (Pradeep). Never stored in the database. */
  operatorEmails: string[];
  /** Local development only: trust an `x-dev-user` header instead of Cognito. */
  devAuth: boolean;
}

/** Read the environment once at start-up; refuse dev sign-in anywhere on Lambda. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const onLambda = Boolean(env.AWS_LAMBDA_FUNCTION_NAME);
  const devAuth = env.DEV_AUTH === "1";
  if (devAuth && onLambda) throw new Error("DEV_AUTH must never be set on Lambda");
  return {
    env: (env.APP_ENV as Config["env"]) ?? "local",
    table: env.TABLE_NAME,
    docsBucket: env.DOCS_BUCKET,
    userPoolId: env.USER_POOL_ID,
    clientId: env.USER_POOL_CLIENT_ID,
    authDomain: env.AUTH_DOMAIN,
    publicUrl: env.PUBLIC_URL ?? "http://localhost:5173",
    mailFrom: env.MAIL_FROM,
    operatorEmails: (env.OPERATOR_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    devAuth,
  };
}
