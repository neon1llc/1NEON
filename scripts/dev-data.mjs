// scripts/dev-data.mjs - Give dev.neon1.tech/1NEON a fresh copy of production's data: the table and
// the uploaded documents. Production is only ever read; dev's table and documents are replaced.
// Outbox messages, sign-in sessions, and Cognito identity links are not copied, so nothing queued in
// production is sent from dev and everyone signs in to dev afresh. Locked records stay in production.
// Usage (an admin AWS profile, never CI): AWS_PROFILE=neon1 node scripts/dev-data.mjs [--yes]

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

// The AWS SDK lives in the API workspace
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");


// Source and target; the guard below refuses anything else
const FROM = { table: "1neon-prod", docs: "neon1-1neon-docs-prod" };
const TO = { table: "1neon-dev", docs: "neon1-1neon-docs-dev" };
if (!TO.table.endsWith("-dev") || !TO.docs.endsWith("-dev") || FROM.table === TO.table) throw new Error("dev-data: target must be dev");

// Rows that belong to one environment only
const SKIP = (row) => row.PK === "OUTBOX" || row.PK.startsWith("SESSION#") || row.PK.startsWith("SUB#");

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }), { marshallOptions: { removeUndefinedValues: true } });


/** Every row of a table, page by page */
async function* rows(table) {
  let start;
  do {
    const page = await db.send(new ScanCommand({ TableName: table, ExclusiveStartKey: start }));
    yield* page.Items ?? [];
    start = page.LastEvaluatedKey;
  } while (start);
}


/** Batch writes of 25, retrying whatever DynamoDB hands back unprocessed */
async function write(table, requests) {
  for (let i = 0; i < requests.length; i += 25) {
    let batch = { [table]: requests.slice(i, i + 25) };
    for (let tries = 0; Object.keys(batch).length && batch[table]?.length; tries++) {
      if (tries > 8) throw new Error("dev-data: DynamoDB kept throttling");
      const r = await db.send(new BatchWriteCommand({ RequestItems: batch }));
      batch = r.UnprocessedItems ?? {};
      if (batch[table]?.length) await new Promise((ok) => setTimeout(ok, 200 * 2 ** tries));
    }
  }
}


// Say what will happen, and wait for --yes
if (!process.argv.includes("--yes")) {
  console.log(`This replaces dev's data with production's: ${FROM.table} -> ${TO.table}, s3://${FROM.docs} -> s3://${TO.docs}.`);
  console.log("Production is only read. Run again with --yes to go ahead.");
  process.exit(0);
}

// 1. Empty dev's table
const old = [];
for await (const r of rows(TO.table)) old.push({ DeleteRequest: { Key: { PK: r.PK, SK: r.SK } } });
await write(TO.table, old);
console.log(`dev-data: cleared ${old.length} dev rows`);

// 2. Copy production's rows, less the environment-only ones
const copy = [];
let skipped = 0;
for await (const r of rows(FROM.table)) {
  if (SKIP(r)) skipped++;
  else copy.push({ PutRequest: { Item: r } });
}
await write(TO.table, copy);
console.log(`dev-data: copied ${copy.length} rows (${skipped} outbox, session, and sign-in link rows left out)`);

// 3. Documents, scan tags included, so downloads behave as they do in production
execFileSync("aws", ["s3", "sync", `s3://${FROM.docs}`, `s3://${TO.docs}`, "--delete", "--only-show-errors"], { stdio: "inherit" });
console.log("dev-data: documents copied. Sign in to dev again (sessions are not copied).");
