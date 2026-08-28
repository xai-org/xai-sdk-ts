<div align="center">
  <a href="https://x.ai">
    <img src="https://avatars.githubusercontent.com/u/130314967?s=200&v=4" alt="xAI" width="96" />
  </a>
  <h1>xAI TypeScript SDK</h1>
  <p>The official TypeScript SDK for the xAI API</p>
  <p>
    <a href="./LICENSE">
      <img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache 2.0 license" />
    </a>
    <img src="https://img.shields.io/badge/Node.js-%E2%89%A522.13-339933?logo=node.js&logoColor=white" alt="Node.js 22.13 or later" />
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  </p>
  <p>
    <a href="https://docs.x.ai">Documentation</a>
    ·
    <a href="https://console.x.ai">API keys</a>
    ·
    <a href="https://github.com/xai-org/xai-sdk-ts/issues">Issues</a>
  </p>
</div>

Use Grok from TypeScript with a typed, ESM client built on the xAI REST API. The SDK has no runtime dependencies and includes streaming, structured output, function tools, image input, multi-turn conversations, and access to usage and HTTP metadata.

## Requirements

- Node.js 22.13 or later
- An [xAI API key](https://console.x.ai)
- An ESM project

## Installation

Install the package with your preferred package manager:

```bash
npm install @xai-official/sdk
```

```bash
pnpm add @xai-official/sdk
```

The package is currently marked private while it is under development, so the registry commands above are for the first public release. Until then, install a local checkout:

```bash
git clone https://github.com/xai-org/xai-sdk-ts.git
cd xai-sdk-ts
pnpm install
pnpm build

cd ../your-app
pnpm add ../xai-sdk-ts
```

Repository development uses pnpm 11.24.0, as declared in `package.json`.

## Quickstart

Set your API key in the environment. The client reads `XAI_API_KEY` automatically.

```bash
export XAI_API_KEY="your-api-key"
```

```ts
import { xAI } from "@xai-official/sdk";

const client = new xAI();

const response = await client.responses.create({
  model: "grok-4.6",
  input: "Explain why the sky is blue in one sentence.",
});

console.log(response.toText());
```

Keep API keys on the server. The SDK blocks browser and Worker use by default because shipping a secret key to client-side code exposes it to users.

## Streaming

Set `stream: true` and iterate over the server-sent events. The stream accumulates the final response as events arrive.

```ts
const stream = await client.responses.create({
  model: "grok-4.6",
  input: "Write a short story about a curious robot.",
  stream: true,
});

for await (const event of stream) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta);
  }
}

console.log(`\n${stream.usage.total_tokens} tokens`);
```

After iteration completes, the stream exposes `toText()`, `toInput()`, `toJson()`, `parsed`, `id`, `status`, `output`, `usage`, and `http`.

If you stop consuming a stream early, call `await stream.close()` to cancel its response body.

## Multi-turn conversations

Responses are not stored by default. Use `toInput()` to carry the model output, including encrypted reasoning content, into the next turn. Reuse one `prompt_cache_key` across the conversation to improve prompt cache routing:

```ts
import { randomUUID } from "node:crypto";
import { type InputItem, xAI } from "@xai-official/sdk";

const client = new xAI();
const promptCacheKey = `conversation:${randomUUID()}`;
const input = [
  { role: "user", content: "My name is Ada. Remember it." },
] satisfies InputItem[];

const first = await client.responses.create({
  model: "grok-4.6",
  input,
  prompt_cache_key: promptCacheKey,
});

const second = await client.responses.create({
  model: "grok-4.6",
  input: [
    ...input,
    ...first.toInput(),
    { role: "user", content: "What is my name?" },
  ],
  prompt_cache_key: promptCacheKey,
});

console.log(second.toText());
```

Use a different cache key for each unrelated conversation.

To continue a stored response by ID, opt in to storage:

```ts
const first = await client.responses.create({
  model: "grok-4.6",
  input: "My name is Ada. Remember it.",
  store: true,
});

const second = await client.responses.create({
  model: "grok-4.6",
  input: "What is my name?",
  previous_response_id: first.id,
  store: true,
});
```

## Image input

Pass an image URL alongside text:

```ts
const response = await client.responses.create({
  model: "grok-4.6",
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "Describe this image." },
        {
          type: "input_image",
          image_url: "https://example.com/image.jpg",
          detail: "high",
        },
      ],
    },
  ],
});

console.log(response.toText());
```

For a local image, pass a `Blob` or `File` as `image`. The SDK converts it to a data URL before sending the request.

```ts
import { readFile } from "node:fs/promises";

const bytes = new Uint8Array(await readFile("./image.png"));
const image = new Blob([bytes], { type: "image/png" });

const response = await client.responses.create({
  model: "grok-4.6",
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "What is in this image?" },
        { type: "input_image", image },
      ],
    },
  ],
});
```

## Structured output

Provide a JSON Schema through `text.format`. Call `toJson()` to parse the completed text output.

```ts
const response = await client.responses.create({
  model: "grok-4.6",
  input: "Give me a city to visit in Japan.",
  text: {
    format: {
      type: "json_schema",
      name: "travel_suggestion",
      schema: {
        type: "object",
        properties: {
          city: { type: "string" },
          reason: { type: "string" },
        },
        required: ["city", "reason"],
        additionalProperties: false,
      },
    },
  },
});

const suggestion = response.toJson();
console.log(suggestion);
```

`toJson()` returns `unknown`. Validate the result before using it at a trust boundary. The non-throwing `response.parsed` getter returns `null` when the output is incomplete or is not valid JSON.

## Tools

Describe functions with JSON Schema, run the requested function in your application, then return its output to the model:

```ts
import {
  type InputItem,
  type Tool,
  isFunctionCall,
  xAI,
} from "@xai-official/sdk";

const client = new xAI();
const prompt = "What is the weather in San Francisco?";
const input = [{ role: "user", content: prompt }] satisfies InputItem[];
const getWeatherTool = {
  type: "function",
  name: "get_weather",
  description: "Get the current weather for a location.",
  parameters: {
    type: "object",
    properties: {
      location: { type: "string" },
    },
    required: ["location"],
    additionalProperties: false,
  },
} satisfies Tool;

async function getWeather(location: string) {
  return { location, temperatureC: 18, conditions: "sunny" };
}

const response = await client.responses.create({
  model: "grok-4.6",
  input,
  parallel_tool_calls: false,
  tools: [getWeatherTool],
});

const call = response.output.find(isFunctionCall);
if (!call) {
  throw new Error("The model did not request a function");
}

const { location } = JSON.parse(call.arguments) as { location: string };
const weather = await getWeather(location);

const answer = await client.responses.create({
  model: "grok-4.6",
  input: [
    ...input,
    ...response.toInput(),
    {
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(weather),
    },
  ],
});

console.log(answer.toText());
```

Treat function names and arguments as untrusted input. Only dispatch functions you have explicitly allowed, and validate arguments before executing them.

## Server-side search

Add the web search tool when a prompt needs current information:

```ts
import { type Tool, xAI } from "@xai-official/sdk";

const client = new xAI();
const webSearchTool = {
  type: "web_search",
} satisfies Tool;

const response = await client.responses.create({
  model: "grok-4.6",
  input: "What are the latest developments in commercial spaceflight?",
  tools: [webSearchTool],
});

console.log(response.toText());
console.log(response.usage.num_server_side_tools_used);
```

See the [xAI documentation](https://docs.x.ai) for the available server-side tools and their options.

## Working with responses

Every completed response provides:

- `response.toText()` to concatenate output text
- `response.toInput()` to carry all output items into a later request
- `response.toJson()` to parse completed JSON output
- `response.parsed` for non-throwing JSON parsing
- `response.output` for typed output items
- `response.usage` for token counts, server-side tool use, and cost when available
- `response.http` for the HTTP status, headers, and xAI request ID

Use the exported type guards when inspecting output items:

```ts
import {
  isFunctionCall,
  isMessage,
  isReasoning,
} from "@xai-official/sdk";

for (const item of response.output) {
  if (isMessage(item)) {
    console.log("message", item.content);
  } else if (isFunctionCall(item)) {
    console.log("function", item.name, item.arguments);
  } else if (isReasoning(item)) {
    console.log("reasoning item", item.id);
  }
}
```

## Models

Use model IDs directly. `ModelId` suggests known string literals while still accepting models released after the installed SDK version:

```ts
import { type KnownModelId } from "@xai-official/sdk";

const model = "grok-4.6" satisfies KnownModelId;

const available = await client.models.list();
for (const availableModel of available.data) {
  console.log(availableModel.id);
}

const modelInfo = await client.models.get(model);
console.log(modelInfo);
```

`KnownModelId` is generated from the [xAI model documentation](https://docs.x.ai/developers/models). Use it when you want strict validation against the models known to this SDK release.

## Response storage

The SDK sends `store: false` unless you opt in. This differs from the API wire default. With storage disabled, the SDK requests encrypted reasoning content so `response.toInput()` can preserve context between turns.

Pass `store: true` when you need to retrieve, continue, inspect, or delete a response by ID:

```ts
const stored = await client.responses.create({
  model: "grok-4.6",
  input: "Save this response.",
  store: true,
});

const fetched = await client.responses.get(stored.id);
const inputItems = await client.responses.inputItems.list(stored.id);
await client.responses.delete(stored.id);
```

## Timeouts, retries, and cancellation

Configure defaults on the client:

```ts
const client = new xAI({
  timeout: 60_000,
  idleTimeout: 30_000,
  maxRetries: 2,
});
```

Override them for one request and pass an `AbortSignal` when needed:

```ts
const controller = new AbortController();

const pending = client.responses.create(
  {
    model: "grok-4.6",
    input: "Write a detailed report.",
  },
  {
    signal: controller.signal,
    timeout: 120_000,
    maxRetries: 0,
  },
);

controller.abort();
await pending;
```

Create requests retry explicit `429` responses by default. Read-only requests may also retry transient HTTP failures. Retry delays honor `Retry-After` and use jittered exponential backoff.

## Errors

All SDK errors extend `APIError`. Status-specific classes are exported for common API failures.

```ts
import {
  APIError,
  AuthenticationError,
  RateLimitError,
} from "@xai-official/sdk";

try {
  await client.responses.create({
    model: "grok-4.6",
    input: "Hello",
  });
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error("Check XAI_API_KEY");
  } else if (error instanceof RateLimitError) {
    console.error("Rate limited. Retry later.");
  } else if (APIError.is(error)) {
    console.error(error.status, error.code, error.param, error.requestId, error.message);
  } else {
    throw error;
  }
}
```

The SDK exports `APIConnectionError`, `APIProtocolError`, `APIStatusError`, `AbortError`, `AuthenticationError`, `NotFoundError`, `OverloadedError`, `PermissionDeniedError`, `RateLimitError`, and `TimeoutError`.

## Debugging requests

Set `XAI_DEBUG=1` to print each request as a reproducible cURL command:

```bash
XAI_DEBUG=1 node app.js
```

Authentication headers and common credential fields are redacted. Request bodies are not, so avoid debug logging where prompts or tool outputs may contain sensitive data.

Structured API failures expose `error.type`, `error.code`, and `error.param` when the server returns them. The xAI request ID is also available at `response.http.requestId` and `error.requestId`. Include it when reporting an API problem.

## Development

Install dependencies and run the checks:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm pack:check
```

Check the package from a clean temporary install:

```bash
pnpm pack:smoke
```

Create a distributable tarball and SHA-256 checksum in `artifacts/`:

```bash
pnpm pack:artifact
```

Generated API types live in `src/generated/types.ts`, and the model ID union lives in `src/models.ts`. Run `pnpm generate:types` for API types and `pnpm generate:models` for model IDs instead of editing those files by hand.

## License

Licensed under the [Apache License 2.0](./LICENSE).
