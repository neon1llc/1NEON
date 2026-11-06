// Lambda entry for the API (behind API Gateway HTTP API, routed from CloudFront /1NEON/api/*).
import { handle } from "hono/aws-lambda";
import { createApp } from "../app.ts";
import { CognitoAuth } from "../auth.ts";
import { loadConfig } from "../config.ts";
import { CognitoDirectory, SesMailer } from "../services.ts";
import { DynamoTable } from "../store/dynamo.ts";
import { Repo } from "../store/repo.ts";

const cfg = loadConfig();
// Fail at cold start, loudly, rather than on the first request.
if (!cfg.table || !cfg.userPoolId || !cfg.clientId || !cfg.authDomain || !cfg.mailFrom) {
  throw new Error("Missing configuration: TABLE_NAME, USER_POOL_ID, USER_POOL_CLIENT_ID, AUTH_DOMAIN, MAIL_FROM");
}

const app = createApp({
  cfg,
  repo: new Repo(new DynamoTable(cfg.table)),
  directory: new CognitoDirectory(cfg.userPoolId),
  mailer: new SesMailer(cfg.mailFrom),
  auth: new CognitoAuth({ userPoolId: cfg.userPoolId, clientId: cfg.clientId, authDomain: cfg.authDomain, publicUrl: cfg.publicUrl }),
});

// API Gateway HTTP API (payload 2.0) events in, responses out.
export const handler = handle(app);
