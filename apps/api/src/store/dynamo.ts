// DynamoDB backend for the single table: guarded writes, transactions, and consistent reads.
import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { ConflictError, type Guard, type Row, type TableStore, type WriteOp } from "./types.ts";

// The condition parts of a write request.
interface Cond {
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
}

/** Translate a write guard into a DynamoDB condition expression. */
function condition(guard: Guard | undefined): Cond {
  if (!guard || "always" in guard) return {};
  // An expired row may linger until TTL deletion runs; treat it as absent.
  if ("create" in guard)
    return {
      ConditionExpression: "attribute_not_exists(PK) OR #ttl < :now",
      ExpressionAttributeNames: { "#ttl": "ttl" },
      ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) },
    };
  // Version guard: the write lands only if nobody saved since the caller read the row.
  return {
    ConditionExpression: "#v = :v",
    ExpressionAttributeNames: { "#v": "version" },
    ExpressionAttributeValues: { ":v": guard.version },
  };
}

/** DynamoDB single-table backend. Reads are strongly consistent on the base table. */
export class DynamoTable implements TableStore {
  private doc: DynamoDBDocumentClient;

  constructor(
    private table: string,
    client = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  // Consistent reads: a save is visible to the very next request, which the conflict checks rely on.
  async get(pk: string, sk: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: pk, SK: sk }, ConsistentRead: true }));
    return this.live(r.Item as Row | undefined);
  }

  async query(pk: string, prefix = "", opts: { limit?: number; reverse?: boolean } = {}) {
    return this.all({
      TableName: this.table,
      KeyConditionExpression: prefix ? "PK = :pk AND begins_with(SK, :p)" : "PK = :pk",
      ExpressionAttributeValues: prefix ? { ":pk": pk, ":p": prefix } : { ":pk": pk },
      ConsistentRead: true,
      ScanIndexForward: !opts.reverse,
      Limit: opts.limit,
    }, opts.limit);
  }

  // Index reads are eventually consistent (DynamoDB offers nothing else for GSIs).
  async queryIndex(index: "GSI1" | "GSI2", pk: string, prefix = "") {
    return this.all({
      TableName: this.table,
      IndexName: index,
      KeyConditionExpression: prefix ? `${index}PK = :pk AND begins_with(${index}SK, :p)` : `${index}PK = :pk`,
      ExpressionAttributeValues: prefix ? { ":pk": pk, ":p": prefix } : { ":pk": pk },
    });
  }

  async write(ops: WriteOp[]) {
    // One write: a plain conditional put or delete, cheaper than a transaction.
    if (ops.length === 1) {
      const op = ops[0]!;
      try {
        if ("put" in op) await this.doc.send(new PutCommand({ TableName: this.table, Item: op.put, ...condition(op.guard) }));
        else await this.doc.send(new DeleteCommand({ TableName: this.table, Key: op.delete, ...condition(op.guard) }));
      } catch (e) {
        // Hand back the current row so the caller can show "theirs" next to "yours".
        if (e instanceof ConditionalCheckFailedException) {
          const key = "put" in op ? op.put : op.delete;
          throw new ConflictError(await this.get(key.PK, key.SK));
        }
        throw e;
      }
      return;
    }
    // Several writes: one transaction (up to 100 items), all or nothing.
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: ops.map((op) =>
            "put" in op
              ? { Put: { TableName: this.table, Item: op.put, ...condition(op.guard) } }
              : { Delete: { TableName: this.table, Key: op.delete, ...condition(op.guard) } },
          ),
        }),
      );
    } catch (e) {
      if (e instanceof TransactionCanceledException) {
        // Find which guard failed and return that row as the conflict.
        const i = e.CancellationReasons?.findIndex((r) => r.Code === "ConditionalCheckFailed") ?? -1;
        const op = ops[i];
        const key = op && ("put" in op ? op.put : op.delete);
        throw new ConflictError(key ? await this.get(key.PK, key.SK) : undefined);
      }
      throw e;
    }
  }

  /** Counters for client IDs and project keys; ADD is atomic, so two creates never share a number. */
  async increment(pk: string, sk: string) {
    const r = await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: pk, SK: sk },
        UpdateExpression: "ADD n :one",
        ExpressionAttributeValues: { ":one": 1 },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number(r.Attributes?.n);
  }

  /** Follow pagination until done, or until `limit` live rows are collected. */
  private async all(input: QueryCommandInput, limit?: number) {
    const out: Row[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(new QueryCommand({ ...input, ExclusiveStartKey: start }));
      for (const item of (r.Items ?? []) as Row[]) if (this.live(item)) out.push(item);
      start = r.LastEvaluatedKey;
    } while (start && (!limit || out.length < limit));
    return limit ? out.slice(0, limit) : out;
  }

  /** TTL deletion can lag by hours, so expired rows are filtered on read. */
  private live(r: Row | undefined) {
    return r && !(typeof r.ttl === "number" && r.ttl * 1000 < Date.now()) ? r : undefined;
  }
}
