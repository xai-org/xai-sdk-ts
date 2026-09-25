#!/usr/bin/env node

const apiKey = process.env.XAI_API_KEY;
const testImages = process.env.XAI_TEST_IMAGES === "1";
const maxOutputTokens = Number(process.env.XAI_TEST_MAX_OUTPUT_TOKENS ?? 64);
const maxCostUsd = Number(process.env.XAI_TEST_MAX_COST_USD ?? (testImages ? 0.15 : 0.05));

if (!apiKey) throw new Error("XAI_API_KEY is required");
if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 256) {
  throw new Error("XAI_TEST_MAX_OUTPUT_TOKENS must be an integer from 1 to 256");
}
if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
  throw new Error("XAI_TEST_MAX_COST_USD must be a positive number");
}

function reportedCostUsd(label, usage) {
  if (typeof usage?.cost_usd !== "number") {
    throw new Error(`${label} did not report a cost, so the cost limit cannot be enforced`);
  }
  return usage.cost_usd;
}

const { xAI } = await import("../dist/index.js");
const model = process.env.XAI_TEST_MODEL ?? "grok-4.6";
const imageModel = process.env.XAI_TEST_IMAGE_MODEL ?? "grok-imagine-image";

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

let image;
let edit;
if (testImages) {
  const generated = await client.images.generate({
    model: imageModel,
    prompt: "A red circle on a white background",
    n: 1,
  });
  const url = generated.data[0]?.url;
  if (!url) {
    throw new Error(`Image smoke returned no URL (requestId=${generated.http.requestId ?? "missing"})`);
  }
  const download = await fetch(url);
  if (!download.ok) throw new Error(`Image smoke URL download failed with ${download.status}`);
  image = {
    model: imageModel,
    requestId: generated.http.requestId,
    costUsd: reportedCostUsd("Image smoke", generated.usage),
  };

  // An untyped Blob exercises data URL inlining and image type detection.
  const source = new Blob([await download.arrayBuffer()]);
  const edited = await client.images.edit({
    model: imageModel,
    prompt: "Make the circle blue",
    image: source,
  });
  if (!edited.data[0]?.url && !edited.data[0]?.b64_json) {
    throw new Error(`Edit smoke failed (requestId=${edited.http.requestId ?? "missing"})`);
  }
  edit = {
    requestId: edited.http.requestId,
    costUsd: reportedCostUsd("Edit smoke", edited.usage),
  };
}

const reportedCost =
  reportedCostUsd("Non-streaming smoke", response.usage) +
  reportedCostUsd("Streaming smoke", stream.usage) +
  (image?.costUsd ?? 0) +
  (edit?.costUsd ?? 0);
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
    image,
    edit,
    totalCostUsd: reportedCost,
  }),
);
