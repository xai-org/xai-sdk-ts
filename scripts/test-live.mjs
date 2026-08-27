#!/usr/bin/env node

const apiKey = process.env.XAI_API_KEY;
const maxOutputTokens = Number(process.env.XAI_TEST_MAX_OUTPUT_TOKENS ?? 64);
const maxCostUsd = Number(process.env.XAI_TEST_MAX_COST_USD ?? 0.05);

if (!apiKey) throw new Error("XAI_API_KEY is required");
if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 256) {
  throw new Error("XAI_TEST_MAX_OUTPUT_TOKENS must be an integer from 1 to 256");
}
if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
  throw new Error("XAI_TEST_MAX_COST_USD must be a positive number");
}

const { xAI } = await import("../dist/index.js");
const model = process.env.XAI_TEST_MODEL ?? "grok-4.6";

const client = new xAI({
  apiKey,
  maxRetries: 0,
  timeout: 120_000,
  idleTimeout: 60_000,
});
const body = {
  model,
  input: "Reply with exactly: OK",
  max_output_tokens: maxOutputTokens,
  store: false,
};

const response = await client.responses.create(body);
if (!response.id || response.status !== "completed" || !response.toText()) {
  throw new Error(`Non-streaming smoke failed (status=${response.status}, id=${response.id || "missing"})`);
}

const stream = await client.responses.create({ ...body, stream: true });
let sawTerminalEvent = false;
try {
  for await (const event of stream) {
    if (event.type === "response.completed") sawTerminalEvent = true;
    if (event.type === "error" || event.type === "response.failed") {
      throw new Error(`Streaming smoke received ${event.type}`);
    }
  }
} finally {
  await stream.close();
}
if (!sawTerminalEvent || stream.status !== "completed" || !stream.toText()) {
  throw new Error(`Streaming smoke failed (status=${stream.status}, id=${stream.id || "missing"})`);
}
const reportedCost = (response.usage.cost_usd ?? 0) + (stream.usage.cost_usd ?? 0);
if (reportedCost > maxCostUsd) {
  throw new Error(`Live smoke reported $${reportedCost}, above $${maxCostUsd} limit`);
}

console.log(
  JSON.stringify({
    model,
    nonStreaming: {
      requestId: response.http.requestId,
      responseId: response.id,
      costUsd: response.usage.cost_usd,
    },
    streaming: {
      requestId: stream.http.requestId,
      responseId: stream.id,
      costUsd: stream.usage.cost_usd,
    },
    totalCostUsd: reportedCost,
  }),
);
