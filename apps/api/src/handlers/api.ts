// apps/api/src/handlers/api.ts - Lambda entry for the API (behind API Gateway HTTP API, routed from
// CloudFront /1NEON/api/*).


import { handle } from "hono/aws-lambda";
import { createApp } from "../app.ts";
import { CognitoAuth } from "../auth.ts";
import { loadConfig } from "../config.ts";
import { AwsTexter, CognitoDirectory, S3Storage, SesMailer } from "../services.ts";
import { DynamoTable } from "../store/dynamo.ts";
import { Repo } from "../store/repo.ts";


// Built once per cold start and reused across invocations
const cfg = loadConfig();
// Fail at cold start, loudly, rather than on the first request
if (!cfg.table || !cfg.userPoolId || !cfg.clientId || !cfg.authDomain || !cfg.mailFrom || !cfg.docsBucket) {
  throw new Error("Missing configuration: TABLE_NAME, USER_POOL_ID, USER_POOL_CLIENT_ID, AUTH_DOMAIN, MAIL_FROM, DOCS_BUCKET");
}


// Production wiring: DynamoDB, Cognito, SES, and S3 behind the same interfaces tests use
const app = createApp({
  cfg,
  repo: new Repo(new DynamoTable(cfg.table)),
  directory: new CognitoDirectory(cfg.userPoolId),
  mailer: new SesMailer(cfg.mailFrom),
  storage: new S3Storage(cfg.docsBucket),
  // Texts only once the toll-free number is set up
  texter: cfg.smsFrom ? new AwsTexter(cfg.smsFrom) : undefined,
  auth: new CognitoAuth({ userPoolId: cfg.userPoolId, clientId: cfg.clientId, authDomain: cfg.authDomain, publicUrl: cfg.publicUrl }),
});


// API Gateway HTTP API (payload 2.0) events in, responses out
export const handler = handle(app);
