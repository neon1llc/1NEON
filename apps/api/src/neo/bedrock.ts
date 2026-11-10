// apps/api/src/neo/bedrock.ts - Neo's model in production: Claude on Amazon Bedrock through the
// Claude SDK's Bedrock client, signed with the function's own role (bedrock:InvokeModel on one
// inference profile, allowed by the role policy and the neon1-boundary-1neon boundary). Imported only
// by the Lambda handler, so local runs and the browser demo never load it.


import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import type { NeoModel } from "./agent.ts";


/** A model call bounded to 20 seconds and one retry, so a question always ends inside the route's deadline */
export function bedrockNeo(region = process.env.AWS_REGION ?? "us-east-1"): NeoModel {
  const client = new AnthropicBedrock({ awsRegion: region, maxRetries: 1, timeout: 20_000 });
  return (params) => client.messages.create(params);
}
