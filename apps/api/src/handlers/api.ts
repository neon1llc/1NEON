// apps/api/src/handlers/api.ts - Lambda entry for the API (behind API Gateway HTTP API, routed from
// CloudFront /1NEON/api/*).


import { handle } from "hono/aws-lambda";
import { createApp } from "../app.ts";
import { CognitoAuth } from "../auth.ts";
import { loadConfig } from "../config.ts";
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { AwsTexter, CognitoDirectory, S3Records, S3Storage, SesMailer } from "../services.ts";
import { StripePayments } from "../payments.ts";
import { beforeDeadline, drainOutbox } from "../outbox.ts";
import { sweepFiles } from "../files.ts";
import { DynamoTable } from "../store/dynamo.ts";
import { Repo } from "../store/repo.ts";
import { bedrockNeo } from "../neo/bedrock.ts";
import { DEFAULT_BUDGET } from "../routes/neo.ts";


// Built once per cold start and reused across invocations
const cfg = loadConfig();
// Fail at cold start, loudly, rather than on the first request
if (!cfg.table || !cfg.userPoolId || !cfg.clientId || !cfg.authDomain || !cfg.mailFrom || !cfg.docsBucket) {
  throw new Error("Missing configuration: TABLE_NAME, USER_POOL_ID, USER_POOL_CLIENT_ID, AUTH_DOMAIN, MAIL_FROM, DOCS_BUCKET");
}


// Production wiring: DynamoDB, Cognito, SES, and S3 behind the same interfaces tests use
const repo = new Repo(new DynamoTable(cfg.table));
const mailer = new SesMailer(cfg.mailFrom);
// Texts only once the toll-free number is set up
const texter = cfg.smsFrom ? new AwsTexter(cfg.smsFrom) : undefined;
const storage = new S3Storage(cfg.docsBucket);

// Stripe's keys stay in SSM (SecureString), read once at cold start; never in the environment or the repo.
// Without both parameters, invoices are still issued and paid by check, Zelle, or wire
async function stripe() {
  if (!cfg.stripeKeyParam || !cfg.stripeWebhookParam) return undefined;
  const r = await new SSMClient({}).send(new GetParametersCommand({ Names: [cfg.stripeKeyParam, cfg.stripeWebhookParam], WithDecryption: true }));
  const value = (name: string) => r.Parameters?.find((x) => x.Name === name)?.Value;
  const key = value(cfg.stripeKeyParam), hook = value(cfg.stripeWebhookParam);
  // A placeholder value (set by Terraform before the real key is put in) leaves online payment off. A restricted key (rk_) with Checkout Sessions write is all it needs
  return key && /^(sk|rk)_/.test(key) && hook?.startsWith("whsec_") ? new StripePayments(key, hook) : undefined;
}
const payments = await stripe();

const app = createApp({
  cfg,
  repo,
  directory: new CognitoDirectory(cfg.userPoolId),
  mailer,
  storage,
  texter,
  auth: new CognitoAuth({ userPoolId: cfg.userPoolId, clientId: cfg.clientId, authDomain: cfg.authDomain, publicUrl: cfg.publicUrl }),
  // Messages wait in the outbox for the scheduled worker below, never inside a request
  outbox: "worker",
  // Neo for signed-in people, once a model is configured; capped by the month's budget
  payments,
  // Locked copies of signed approvals, agreements, invoices, and payments
  records: cfg.recordsBucket ? new S3Records(cfg.recordsBucket) : undefined,
  neo: cfg.neoModel ? { model: bedrockNeo(), modelId: cfg.neoModel, budget: { ...DEFAULT_BUDGET, monthlyUsd: cfg.neoMonthlyUsd ?? DEFAULT_BUDGET.monthlyUsd } } : undefined,
});


// API Gateway HTTP API (payload 2.0) events in, responses out
const http = handle(app);


/**
 * One function, two callers: API Gateway requests, and the EventBridge schedule that runs the outbox
 * worker and the file sweep once a minute. A schedule event has source "aws.events"; nothing from the internet reaches
 * this function except through API Gateway, so that shape can't be forged by a visitor
 */
export const handler = async (event: Parameters<typeof http>[0] | { source?: string }, context: Parameters<typeof http>[1]) => {
  if ((event as { source?: string }).source === "aws.events") {
    // One absolute end for the whole pass, from the time Lambda says is left (less room to log and
    // return). The outbox gets up to seven seconds of it and the file sweep the rest
    const left = typeof context?.getRemainingTimeInMillis === "function" ? context.getRemainingTimeInMillis() : 15_000;
    const end = Date.now() + Math.max(0, left - 2_000);
    const result = await drainOutbox({ repo, mailer, texter, cfg }, { deadline: Math.min(end - 2_000, Date.now() + 7_000) });
    // Then files whose scan finished since the last pass become ready (or rejected) without a re-upload
    const files = await beforeDeadline(sweepFiles({ repo, storage }, { deadline: end - 500 }), end).catch((e) => ({ watched: 0, settled: 0, error: (e as Error).name }));
    // One line per pass in CloudWatch's embedded metric format: counts and queue age only, never
    // addresses or bodies. Written to stdout directly, because the JSON log wrapper would hide the
    // metric directive inside its message field
    process.stdout.write(`${JSON.stringify({ ...outboxMetrics(result), files })}\n`);
    return { ...result, files };
  }
  return http(event as Parameters<typeof http>[0], context);
};


/** A pass's counts as embedded metrics: the oldest message's age and how many gave up this pass */
function outboxMetrics(r: Awaited<ReturnType<typeof drainOutbox>>) {
  return {
    _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: "1NEON", Dimensions: [[]], Metrics: [{ Name: "OutboxOldestAgeSec", Unit: "Seconds" }, { Name: "OutboxFailed", Unit: "Count" }] }] },
    message: "outbox",
    OutboxOldestAgeSec: r.oldestAgeSec,
    OutboxFailed: r.failed,
    deferred: r.deferred,
    possibleDuplicates: r.possibleDuplicates,
    processed: r.processed,
    sent: r.sent,
    retrying: r.retrying,
    pending: r.pending,
  };
}
