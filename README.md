<div align="center">
  <a href="https://x.ai">
    <img src="https://avatars.githubusercontent.com/u/130314967?s=200&v=4" alt="SpaceXAI" width="96" />
  </a>
  <h1>SpaceXAI TypeScript SDK</h1>
  <p>The official TypeScript SDK for the SpaceXAI API</p>
  <p>
    <a href="./LICENSE">
      <img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache 2.0 license" />
    </a>
    <img src="https://img.shields.io/badge/Node.js-%E2%89%A522.13-339933?logo=node.js&logoColor=white" alt="Node.js 22.13 or later" />
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/status-experimental-orange.svg" alt="Experimental" />
  </p>
  <p>
    <a href="https://console.x.ai">API keys</a>
    ·
    <a href="https://github.com/xai-org/xai-sdk-ts/issues">Issues</a>
  </p>
</div>

Use Grok from TypeScript with a typed, ESM client built on the SpaceXAI REST API. The SDK has no runtime dependencies and includes streaming, structured output, function tools, image input, image and video generation, file uploads, batch processing, text to speech and transcription, multi-turn conversations, and access to usage and HTTP metadata.

> **Experimental.** This SDK is in early development. It currently covers the Responses API, image and video generation, the Files, Batch, and Voice APIs, tokenization, and model and account lookup, and its interfaces may change between releases before 1.0. Pin an exact version and read the [changelog](./CHANGELOG.md) when upgrading. Feedback and bug reports are welcome in [issues](https://github.com/xai-org/xai-sdk-ts/issues).

## Requirements

- Node.js 22.13 or later
- A [SpaceXAI API key](https://console.x.ai)
- An ESM project

## Installation

Install the package with your preferred package manager:

```bash
npm install @xai-official/sdk
```

```bash
pnpm add @xai-official/sdk
```

## Quickstart

Set your API key in the environment. The client reads `XAI_API_KEY` automatically.

```bash
export XAI_API_KEY="your-api-key"
```

```ts
import { SpaceXAI } from "@xai-official/sdk";

const client = new SpaceXAI();

const response = await client.responses.create({
  model: "grok-4.7",
  input: "Explain why the sky is blue in one sentence.",
});

console.log(response.toText());
```

Keep API keys on the server. The SDK blocks browser and Worker use by default because shipping a secret key to client-side code exposes it to users.

## Streaming

Set `stream: true` to receive output as it's generated. Listen for answer text with `on("text")`, then `await stream.done()` for the final response:

```ts
const stream = await client.responses.create({
  model: "grok-4.7",
  input: "Write a short story about a curious robot.",
  stream: true,
});

const response = await stream
  .on("text", (text) => process.stdout.write(text))
  .done();

console.log(`\n${response.usage.total_tokens} tokens`);
```

`done()` resolves to the same response object a non-streamed request returns. It rejects if the stream fails or closes before the response completes. An error partway through a stream, such as `Service temporarily unavailable`, ends the response and isn't retried, because the model may already have produced output. That also applies to `responses.create()` without `stream`, which streams under the hood. To retry failures that happen before any output, set [`retryBeforeOutput`](#timeouts-retries-and-cancellation).

Reasoning models think before they answer, and at the default effort a long answer can take minutes to start. For text that streams to a UI, set `reasoning: { effort: "low" }`, or show `"reasoning"` events while the model thinks.

Besides `"text"`, `on()` has helper events for the rest of a response:

- `"reasoning"` for each chunk of reasoning text or reasoning summary
- `"tool_call"` for each tool call once its arguments are complete, whether your code or SpaceXAI runs it. Check `call.type` to tell them apart
- `"client_tool_call"` for each call that your code runs: your function tools and shell commands
- `"server_tool_call"` for each call to a tool that SpaceXAI runs, such as web search or code execution
- `"image"` for each finished image generation call, with the base64 image in `result`
- `"citation"` for each URL citation in the answer
- `"json"` for structured output: the output parsed so far, each time more text arrives. See [Streaming structured output](#streaming-structured-output)

Each tool call fires once, when its arguments are complete. For your function tools, that's when to run the function, since nothing has run it yet. To show that a call has started before its arguments arrive, listen for `"response.output_item.added"`.

```ts
const response = await stream
  .on("reasoning", (text) => process.stderr.write(text))
  .on("text", (text) => process.stdout.write(text))
  .on("tool_call", (call) => console.error(`\n${call.type} ${call.status}`))
  .done();
```

`on()` also takes any server-sent event type, such as `"response.completed"`, and passes the listener the typed event. Events the SDK doesn't recognize arrive as `"unknown"`, with the original payload in `event.raw`.

You can also iterate over the stream to handle events in a loop. After the loop, `done()` resolves right away with the final response:

```ts
for await (const event of stream) {
  if (event.type === "response.function_call_arguments.delta") {
    process.stdout.write(event.delta);
  }
}

const response = await stream.done();
console.log(response.toText());
```

`stream.http` has the HTTP status, headers, and request IDs as soon as `create()` returns.

If you stop consuming a stream early, call `await stream.close()` to cancel its response body.

## Multi-turn conversations

Responses are not stored by default. Use `toInput()` to carry the model output, including encrypted reasoning content, into the next turn. Reuse one `prompt_cache_key` across the conversation to improve prompt cache routing:

```ts
import { randomUUID } from "node:crypto";
import { type InputItem, SpaceXAI } from "@xai-official/sdk";

const client = new SpaceXAI();
const promptCacheKey = `conversation:${randomUUID()}`;
const input: Array<InputItem> = [
  { role: "user", content: "My name is Ada. Remember it." },
];

const first = await client.responses.create({
  model: "grok-4.7",
  input,
  prompt_cache_key: promptCacheKey,
});

const second = await client.responses.create({
  model: "grok-4.7",
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
  model: "grok-4.7",
  input: "My name is Ada. Remember it.",
  store: true,
});

const second = await client.responses.create({
  model: "grok-4.7",
  input: "What is my name?",
  previous_response_id: first.id,
  store: true,
});
```

### Compacting long conversations

Every turn resends the whole conversation, so input tokens grow as it gets longer. Compact the conversation into a single encrypted item with `responses.compact()`, then start the next input with the compacted `output`. Continuing the `toInput()` example:

```ts
const compacted = await client.responses.compact({
  model: "grok-4.7",
  input: [
    ...input,
    ...first.toInput(),
    { role: "user", content: "What is my name?" },
    ...second.toInput(),
  ],
});

const third = await client.responses.create({
  model: "grok-4.7",
  input: [
    ...compacted.output,
    { role: "user", content: "Spell my name backwards." },
  ],
  prompt_cache_key: promptCacheKey,
});

console.log(third.toText());
```

Pass `compacted.output` unchanged and add new turns after it. The conversation must still fit in the model's context window when you compact it. `compacted.usage` reports the tokens the compaction used and `dropped_message_count`, the number of messages it replaced.

## Image input

Pass an image URL alongside text:

```ts
const response = await client.responses.create({
  model: "grok-4.7",
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

For a local image, pass a `Blob` or `File` as `image`. The SDK converts it to a data URL before sending the request, and detects JPEG, PNG, or WebP from the bytes when the `Blob` has no MIME type.

```ts
import { readFile } from "node:fs/promises";

const bytes = new Uint8Array(await readFile("./image.png"));
const image = new Blob([bytes], { type: "image/png" });

const response = await client.responses.create({
  model: "grok-4.7",
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
  model: "grok-4.7",
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

To validate and type the result in one step, pass a [Standard Schema](https://standardschema.dev) validator. `toJson(schema)` returns the schema's output, with any coercions and defaults applied, typed as the schema's output type. It throws if the JSON doesn't match, listing each problem with its path. Supported validators:

- [Zod](https://zod.dev) 3.24 or later
- [Valibot](https://valibot.dev) 1
- [ArkType](https://arktype.io) 2
- [Effect Schema](https://effect.website/docs/schema/introduction/) 4, wrapped with `Schema.toStandardSchemaV1()`

`toJson()` validates synchronously, so validators that only validate asynchronously, such as Yup, aren't supported. Neither are schemas with async refinements.

```ts
import { z } from "zod";

const TravelSuggestion = z.object({ city: z.string(), reason: z.string() });

const { city, reason } = response.toJson(TravelSuggestion);
```

### Streaming structured output

When you stream a request with a JSON Schema in `text.format`, the `"json"` event receives the output parsed so far each time more text arrives. Unfinished strings, arrays, and objects are closed, so you always get an object you can render. As the model writes a podcast script, the event receives values like these:

```js
{ title: "Why the" }
{ title: "Why the sky is blue", lines: [{ speaker: "host", text: "Wel" }] }
{ title: "Why the sky is blue", lines: [{ speaker: "host", text: "Welcome back! Today a simple question." }, { speaker: "gu" }] }
{ title: "Why the sky is blue", lines: [{ speaker: "host", text: "Welcome back! Today a simple question." }, { speaker: "guest", text: "Why is the sky blue?" }] }
```

A string can stop mid-word, even an enum value such as `"gu"` on its way to `"guest"`. A number is left out until it's complete, so you never see `1` for what becomes `12`. In an array, every item before the last one is finished, so you can use each item as soon as the next one starts. This prints each line of the script once it's finished:

```ts
const stream = await client.responses.create({
  model: "grok-4.7",
  input: "Write a short two-person podcast script about why the sky is blue.",
  reasoning: { effort: "low" },
  text: {
    format: {
      type: "json_schema",
      name: "podcast_script",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                speaker: { type: "string", enum: ["host", "guest"] },
                text: { type: "string" },
              },
              required: ["speaker", "text"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "lines"],
        additionalProperties: false,
      },
    },
  },
  stream: true,
});

type Line = { speaker: string; text: string };
const print = (line: Line) => console.log(`${line.speaker}: ${line.text}`);
let finished = 0;

const response = await stream
  .on("json", (partial) => {
    const lines = (partial as { lines?: Array<Line> }).lines ?? [];
    while (finished < lines.length - 1) print(lines[finished++]!);
  })
  .done();

const script = response.toJson() as { title: string; lines: Array<Line> };
for (const line of script.lines.slice(finished)) print(line);
```

To speak each line while the model writes the next one, call `client.voice.speak()` in place of `print`. Values from the `"json"` event aren't validated, so read the complete result from the final response with `toJson()`.

The `"json"` event runs `parsePartialJson()` on the text received so far, and you can call it yourself. It works like `JSON.parse` on JSON that's cut off partway: instead of throwing, it returns what's there so far, with open strings, arrays, and objects closed. It returns `undefined` when the text holds no value yet or is broken rather than unfinished:

```ts
import { parsePartialJson } from "@xai-official/sdk";

parsePartialJson('{"title":"Why the'); // { title: "Why the" }
parsePartialJson('{"title":"Why the sky is blue","minutes":1'); // { title: "Why the sky is blue" }
parsePartialJson('{"title":"Why the sky is blue","minutes":12}'); // { title: "Why the sky is blue", minutes: 12 }
parsePartialJson('{"title" "oops"}'); // undefined
```

Call it when you read the events in a loop instead of with `on()`, or on text you forward elsewhere, such as to a browser:

```ts
let text = "";
for await (const event of stream) {
  if (event.type === "response.output_text.delta") {
    text += event.delta;
    console.log(parsePartialJson(text));
  }
}
```

## Tools

Describe functions with JSON Schema, run the requested function in your application, then return its output to the model:

```ts
import { type InputItem, type Tool, isFunctionCall, SpaceXAI } from "@xai-official/sdk";

const client = new SpaceXAI();
const prompt = "What is the weather in San Francisco?";
const input: Array<InputItem> = [{ role: "user", content: prompt }];
const getWeatherTool: Tool = {
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
};

async function getWeather(args: unknown) {
  if (
    typeof args !== "object" ||
    args === null ||
    !("location" in args) ||
    typeof args.location !== "string"
  ) {
    throw new Error("get_weather expects a location string");
  }
  return { location: args.location, temperatureC: 18, conditions: "sunny" };
}

const response = await client.responses.create({
  model: "grok-4.7",
  input,
  parallel_tool_calls: false,
  tools: [getWeatherTool],
});

const call = response.output.find(isFunctionCall);
if (!call) throw new Error("The model did not call get_weather");
const result = await getWeather(JSON.parse(call.arguments));

const answer = await client.responses.create({
  model: "grok-4.7",
  input: [
    ...input,
    ...response.toInput(),
    { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) },
  ],
});

console.log(answer.toText());
```

`parallel_tool_calls: false` limits the model to one function call per turn, so this example only has to handle one. By default the model can ask for several at once, which the [tool call loop](#tool-call-loop) handles.

Treat function names and arguments as untrusted input. Only dispatch functions you have explicitly allowed, and validate arguments before executing them, as `getWeather()` does.

### Tool call loop

To let the model call tools until it has an answer, run a loop. Stream a turn, run each function call as soon as it finishes streaming, then send the outputs back along with the model's output. Stop when a turn makes no function calls, and cap the number of turns so a model that keeps calling tools can't loop forever. This reuses `getWeatherTool` and `getWeather` from the example above:

```ts
import { type FunctionToolCall, type InputItem, type Tool, SpaceXAI } from "@xai-official/sdk";

const client = new SpaceXAI();
const tools: Array<Tool> = [getWeatherTool];
const handlers: Record<string, (args: unknown) => Promise<unknown>> = {
  get_weather: getWeather,
};

async function runTool(call: FunctionToolCall): Promise<InputItem> {
  let output: unknown;
  try {
    const handler = handlers[call.name];
    if (!handler) throw new Error(`Unknown tool: ${call.name}`);
    output = await handler(JSON.parse(call.arguments));
  } catch (err) {
    output = { error: err instanceof Error ? err.message : String(err) };
  }
  return {
    type: "function_call_output",
    call_id: call.call_id,
    output: JSON.stringify(output),
  };
}

const input: Array<InputItem> = [
  { role: "user", content: "Compare the weather in Paris and Tokyo." },
];

for (let turn = 0; turn < 10; turn++) {
  const toolRuns: Array<Promise<InputItem>> = [];
  const stream = await client.responses.create({
    model: "grok-4.7",
    input,
    tools,
    stream: true,
  });
  const response = await stream
    .on("text", (text) => process.stdout.write(text))
    .on("client_tool_call", (call) => {
      if (call.type === "function_call") toolRuns.push(runTool(call));
    })
    .done();
  if (toolRuns.length === 0) break;

  const toolOutputs = await Promise.all(toolRuns);
  input.push(...response.toInput(), ...toolOutputs);
}
```

The `handlers` map is the list of functions the model may call. `runTool()` returns errors to the model instead of throwing, so the model can recover, and a failing tool can't crash the loop while the stream is still running.

### Shell commands

With the `shell` tool, the model writes shell commands and your application runs them. Use it for agents that work on your machine, such as exploring a repository, running tests, or checking disk space. Each call arrives through the `client_tool_call` listener as a `shell_call`, with the commands in `action.commands`. The model writes these commands, so run them in a sandbox or container, or check each one before running it:

```ts
import { exec } from "node:child_process";
import { SpaceXAI } from "@xai-official/sdk";

const client = new SpaceXAI();

const stream = await client.responses.create({
  model: "grok-4.7",
  input: "How much free disk space does this machine have?",
  tools: [{ type: "shell", environment: { type: "local" } }],
  stream: true,
});

await stream
  .on("client_tool_call", (call) => {
    if (call.type === "shell_call") {
      for (const command of call.action.commands) {
        exec(command, (error, stdout, stderr) => console.log(stdout || stderr));
      }
    }
  })
  .done();
```

To let the model use the results, send them back in the next request, like the function outputs in the [tool call loop](#tool-call-loop): `{ type: "shell_call_output", call_id: call.call_id, output: [{ stdout, stderr, outcome: { type: "exit", exit_code: 0 } }] }`.

To give the model skills, list them in the tool's `environment`. A skill is a directory with a `SKILL.md` file of instructions. The model sees each skill's name and description, and when a task matches one, it reads the `SKILL.md` through your shell tool and follows it. If you only allow certain commands, allow reading the skill's directory:

```ts
const shell: Tool = {
  type: "shell",
  environment: {
    type: "local",
    skills: [
      {
        name: "release-notes",
        description: "Write release notes from this repo's git log in our house style.",
        path: "./skills/release-notes",
      },
    ],
  },
};
```

Asked to write release notes, the model reads `./skills/release-notes/SKILL.md`, runs the `git log` command it describes, and writes the notes in the format it specifies.

## Built-in tools

Besides your own functions, the API has built-in tools. Create them with the helpers from `@xai-official/sdk/tools`, which check each tool's options as you type. SpaceXAI runs these tools and includes their results in the response:

- `webSearch()` (`web_search`) searches the web. Options include `allowed_domains`, `excluded_domains`, `user_location`, and `search_context_size`.
- `xSearch()` (`x_search`) searches posts on X. Options include `allowed_x_handles`, `excluded_x_handles`, `from_date`, and `to_date`.
- `codeExecution()` (`code_interpreter`) writes and runs Python code to answer the prompt.
- `collectionsSearch()` (`file_search`) searches the [collections](https://docs.x.ai/developers/files/collections) listed in `vector_store_ids`.
- `imageGeneration()` (`image_generation`) creates or edits images.
- `mcp()` (`mcp`) calls tools on the remote MCP server at `server_url`, identified by `server_label`.
- `toolSearch()` (`tool_search`) loads the definitions of tools marked `defer_loading: true` when the model needs them, instead of putting every definition in the prompt.

Two kinds of tools run in your application instead: `function` for your own functions, as shown in [Tools](#tools), and `shell`, where the model writes shell commands for your application to run, as shown in [Shell commands](#shell-commands). When you stream, calls to both arrive through the `client_tool_call` listener.

The helpers return plain tool objects, so you can also write `{ type: "web_search" }` yourself. `Tool` autocompletes the known types and accepts any other `type`, such as a tool released after this SDK version, but it doesn't check options the way the helpers do. See the [SpaceXAI documentation](https://docs.x.ai) for each tool's options.

### Web search

Add the web search tool when a prompt needs current information:

```ts
import { SpaceXAI } from "@xai-official/sdk";
import { webSearch } from "@xai-official/sdk/tools";

const client = new SpaceXAI();

const response = await client.responses.create({
  model: "grok-4.7",
  input: "What are the latest developments in commercial spaceflight?",
  tools: [webSearch()],
});

console.log(response.toText());
console.log(response.usage.num_server_side_tools_used);
```

### X search

Search posts on X, optionally limited to certain accounts and dates:

```ts
import { xSearch } from "@xai-official/sdk/tools";

const response = await client.responses.create({
  model: "grok-4.7",
  input: "What has SpaceXAI announced on X this month?",
  tools: [xSearch({ allowed_x_handles: ["xai"], from_date: "2026-09-01" })],
});
```

`allowed_x_handles` and `excluded_x_handles` each take up to 20 handles and can't be used together. Set `enable_image_understanding` or `enable_video_understanding` to let the model look at media in posts.

`to_date` is exclusive, so a single day runs from that date to the next: `xSearch({ from_date: "2026-10-01", to_date: "2026-10-02" })`. Without dates, the model chooses which dates to search.

When you stream, each finished search reaches the `server_tool_call` listener as a `custom_tool_call`. Its `name` is the search that ran, such as `x_keyword_search`, and `input` holds the search arguments as a JSON string:

```ts
await stream
  .on("server_tool_call", (call) => {
    if (call.type === "custom_tool_call") console.log(call.name, call.input);
  })
  .done();
```

### Code execution

Let the model write and run Python for calculations and data analysis:

```ts
import { codeExecution } from "@xai-official/sdk/tools";

const response = await client.responses.create({
  model: "grok-4.7",
  input: "What is the standard deviation of 12, 15, 19, 22, and 31?",
  tools: [codeExecution()],
});
```

The code runs in a sandbox with common libraries installed. The tool takes no options.

### Collections search

Search documents you've added to [collections](https://docs.x.ai/developers/files/collections):

```ts
import { collectionsSearch } from "@xai-official/sdk/tools";

const response = await client.responses.create({
  model: "grok-4.7",
  input: "What does our refund policy say about digital purchases?",
  tools: [collectionsSearch({ vector_store_ids: ["your-collection-id"], max_num_results: 10 })],
});
```

### Remote MCP servers

Give the model the tools of a remote MCP server. SpaceXAI connects to the server and calls its tools during the response:

```ts
import { mcp } from "@xai-official/sdk/tools";

const response = await client.responses.create({
  model: "grok-4.7",
  input: "What is the modelcontextprotocol/typescript-sdk repository for?",
  tools: [mcp({ server_url: "https://mcp.deepwiki.com/mcp", server_label: "deepwiki" })],
});
```

The server must use the Streaming HTTP or SSE transport. Limit the model to some of the server's tools with `allowed_tools`, and pass credentials with `authorization` or `headers`. `require_approval` and `connector_id` aren't supported yet. For a server with many tools, set `defer_loading: true` on it and add `toolSearch()`, so the model loads only the tool definitions it needs.

### Image generation tool

Add the image generation tool to let the model create or edit images as one step of a response. Each image arrives as an `image_generation_call` output item whose `result` holds base64 image data:

```ts
import { writeFile } from "node:fs/promises";
import { isImageGenerationCall, SpaceXAI } from "@xai-official/sdk";
import { imageGeneration } from "@xai-official/sdk/tools";

const client = new SpaceXAI();

const response = await client.responses.create({
  model: "grok-4.7",
  input: "Generate an image of a corgi surfing a big wave, in the style of a Japanese woodblock print.",
  tools: [imageGeneration()],
});

console.log(response.toText());

const call = response.output.find(isImageGenerationCall);
if (call?.result) {
  await writeFile("corgi.jpg", Buffer.from(call.result, "base64"));
}
```

Pass `action: "generate"` or `action: "edit"` to `imageGeneration()` to allow only one of those capabilities. When streaming, each call emits `response.image_generation_call.in_progress`, `response.image_generation_call.generating`, and `response.image_generation_call.completed` events, then a `response.output_item.done` event carries the finished item.

To generate or edit an image directly with full control over its size and format, use the [image generation](#image-generation) and [image editing](#image-editing) methods instead.

## Working with responses

Every completed response provides:

- `response.toText()` to concatenate output text
- `response.toInput()` to carry all output items into a later request
- `response.toJson()` to parse completed JSON output
- `response.parsed` for non-throwing JSON parsing
- `response.output` for typed output items
- `response.usage` for token counts, server-side tool use, and cost when available
- `response.http` for the HTTP status, headers, SpaceXAI request ID, and client request ID
- `response.raw` for the response object as the API sent it, including fields this SDK doesn't know yet

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

## Image generation

Generate images from a text prompt with a Grok Imagine model. Images are returned as temporary URLs by default, so download or process them promptly:

```ts
const result = await client.images.generate({
  model: "grok-imagine-image-2.0",
  prompt: "A collage of London landmarks in a stenciled street-art style",
});

console.log(result.data[0]?.url);
console.log(result.usage?.cost_usd);
```

Request up to 10 images with `n`, and shape the output with `aspect_ratio`, `resolution`, and `quality`. Only `grok-imagine-image-2.0` supports `quality`. Set `response_format: "b64_json"` to receive base64 data instead of URLs:

```ts
import { writeFile } from "node:fs/promises";

const result = await client.images.generate({
  model: "grok-imagine-image-2.0",
  prompt: "A futuristic city skyline at night",
  n: 4,
  aspect_ratio: "16:9",
  resolution: "2k",
  response_format: "b64_json",
});

for (const [index, image] of result.data.entries()) {
  if (image.b64_json) {
    await writeFile(`skyline-${index}.jpg`, Buffer.from(image.b64_json, "base64"));
  }
}
```

Base64 output is about a third larger than the image file, so large batches of high-resolution images can approach the default 32 MiB response size limit. Raise `maxResponseBodyBytes` for those requests:

```ts
const result = await client.images.generate(
  {
    model: "grok-imagine-image-2.0",
    prompt: "A futuristic city skyline at night",
    n: 10,
    resolution: "2k",
    response_format: "b64_json",
  },
  { maxResponseBodyBytes: 128 * 1024 * 1024 },
);
```

Each result provides `data`, `usage`, and `http`. `usage.cost_usd` converts the reported `cost_in_usd_ticks` to US dollars, and `usage` is `null` when the API omits it.

### Deferred image requests

Set `deferred: true` to have `generate()` or `edit()` return a `request_id` right away while the images generate in the background. `wait()` polls until they're ready:

```ts
const { request_id } = await client.images.generate({
  model: "grok-imagine-image-2.0",
  prompt: "A collage of London landmarks in a stenciled street-art style",
  deferred: true,
});

const result = await client.images.wait(request_id);
if (result.status === "done") {
  console.log(result.data?.[0]?.url);
  console.log(result.usage?.cost_usd);
} else {
  console.error(result.status, result.error?.code, result.error?.message);
}
```

`wait()` resolves once the status is no longer `pending`: `done`, with `data` and `usage`, or `failed`, with an `error` that has a `code` and `message`. It polls every second for up to 5 minutes. Pass `interval` and `timeout` in milliseconds to change this, and a `signal` to stop waiting. A timeout rejects with `TimeoutError`, so you can call `wait()` again. Neither a timeout nor an aborted `signal` cancels the request, and the API has no way to cancel one. To check once without waiting, call `client.images.get(request_id)`, which returns `status: "pending"` until the images are ready. A `request_id` that's unknown or whose result has expired rejects with `NotFoundError`. Deferred requests support only the default `response_format: "url"`.

To store images in your own bucket instead of with SpaceXAI, pass `output.upload_urls`: signed URLs that accept an HTTP `PUT`, one per image. Each image is uploaded to its URL, and its `url` in the result is that upload URL. This works with or without `deferred`, but Zero Data Retention teams must set it to use `deferred`:

```ts
const { request_id } = await client.images.generate({
  model: "grok-imagine-image-2.0",
  prompt: "A lighthouse at dawn",
  n: 2,
  deferred: true,
  output: {
    upload_urls: [
      "https://storage.example.com/lighthouse-1.jpg?signature=...",
      "https://storage.example.com/lighthouse-2.jpg?signature=...",
    ],
  },
});
```

Each upload's `Content-Type` is the image's `mime_type`, which is `image/jpeg` unless the requested quality produces PNG, so sign the URLs for that type or without a `Content-Type` constraint.

## Image editing

Pass a source image with your prompt to edit it. `image` accepts a public URL, a base64 data URL, a Files API `file_id`, or a `Blob` or `File`, which the SDK converts to a data URL before sending the request:

```ts
import { openAsBlob } from "node:fs";

const photo = await openAsBlob("./photo.png");

const result = await client.images.edit({
  model: "grok-imagine-image-2.0",
  prompt: "Render this as a pencil sketch with detailed shading",
  image: photo,
});

console.log(result.data[0]?.url);
```

When a `Blob` or `File` has no MIME type, as with `openAsBlob()` or `new File([bytes], "photo.png")`, the SDK detects JPEG, PNG, or WebP from its first bytes. The API rejects image data URLs that are not typed as one of those formats.

To combine up to five source images, pass `images` instead of `image` and refer to them in the prompt as `<IMAGE_0>`, `<IMAGE_1>`, and so on. The output follows the first image's aspect ratio unless you set `aspect_ratio`:

```ts
const result = await client.images.edit({
  model: "grok-imagine-image-2.0",
  prompt: "Place the cat from <IMAGE_0> on the sofa from <IMAGE_1>",
  images: [
    { url: "https://example.com/cat.png" },
    { file_id: "file_abc123" },
  ],
  aspect_ratio: "16:9",
});
```

Edits also accept `deferred` and `output`, as described in [Deferred image requests](#deferred-image-requests).

## Video generation

Video generation runs as a background job. `generate()` starts the job and returns its `request_id`, and `wait()` polls until the job finishes:

```ts
const { request_id } = await client.videos.generate({
  model: "grok-imagine-video-1.5",
  prompt: "A paper boat drifting down a rain-soaked street",
  duration: 8,
  aspect_ratio: "16:9",
  resolution: "720p",
});

const result = await client.videos.wait(request_id);
if (result.status === "done") {
  console.log(result.video?.url);
  console.log(result.usage?.cost_usd);
} else {
  console.error(result.status, result.error?.code, result.error?.message);
}
```

`wait()` resolves once the status is no longer `pending`: `done`, `failed`, or `expired`. A failed result includes an `error` with a `code` and `message`. If `video.respect_moderation` is `false`, the video did not pass moderation and has no URL. Video URLs are temporary, so download the file promptly.

`wait()` polls every 5 seconds for up to 10 minutes. Pass `interval` and `timeout` in milliseconds to change this, and a `signal` to stop waiting. A timeout rejects with `TimeoutError`, so you can call `wait()` again. Neither a timeout nor an aborted `signal` cancels the job: the video keeps generating and is billed when it finishes. The API has no way to cancel a video yet. To check once without waiting, call `client.videos.get(request_id)`, which returns `status: "pending"` until the video is ready.

To animate a still image, pass it as `image`. `image`, `reference_images`, and keyframe images accept a public URL, a base64 data URL, a Files API `file_id`, or a `Blob` or `File`, which the SDK converts to a data URL before sending the request:

```ts
import { openAsBlob } from "node:fs";

const { request_id } = await client.videos.generate({
  model: "grok-imagine-video-1.5",
  prompt: "Make the water crash down and slowly pan out the camera",
  image: await openAsBlob("./waterfall.png"),
});
```

Edit a video with `edit()`, or continue it from its last frame with `extend()`. Both return a `request_id` for `wait()`. The source `video` must be an MP4, given as a public URL, a base64 data URL, a Files API `file_id`, or a `Blob` or `File`, which the SDK converts to a data URL before sending the request. For extensions, `duration` sets the length of the new segment only:

```ts
import { openAsBlob } from "node:fs";

const edit = await client.videos.edit({
  model: "grok-imagine-video",
  prompt: "Give the woman a silver necklace",
  video: await openAsBlob("portrait.mp4"),
});

const extension = await client.videos.extend({
  model: "grok-imagine-video",
  prompt: "The camera slowly zooms out to reveal the city skyline",
  video: { file_id: "file_abc123" },
  duration: 6,
});
```

A `Blob` or `File` without a MIME type is sent as `video/mp4`. Because the video travels inside the request as base64, which is a third larger than the file, upload large videos with `client.files.upload()` (up to 50 MB) and pass `{ file_id }` instead.

List the video generation models available to your API key with `client.models.video.list()`, or look one up by ID with `client.models.video.get()`.

## Files

Upload a document, image, or video once and refer to it by ID. A file ID works wherever the API accepts a `file_id`, such as an `input_file` part in the Responses API or an image or video input:

```ts
import { openAsBlob } from "node:fs";

const file = await client.files.upload({
  file: await openAsBlob("./report.pdf"),
  filename: "report.pdf",
});

const response = await client.responses.create({
  model: "grok-4.7",
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "Summarize the key findings in this report." },
        { type: "input_file", file_id: file.id },
      ],
    },
  ],
});

console.log(response.toText());
```

The API records the upload's filename as the file's `filename`. A `File` uses its own name, and a plain `Blob`, such as one from `openAsBlob()`, needs `filename`. Files are kept until you delete them; set `expires_after` to between 3,600 and 2,592,000 seconds (1 hour to 30 days) to have one deleted automatically.

List, download, share, and delete stored files:

```ts
import { writeFile } from "node:fs/promises";

for await (const stored of client.files.list()) {
  console.log(stored.id, stored.filename, stored.bytes);
}

const content = await client.files.content(file.id);
await writeFile("report-copy.pdf", await content.bytes());

const { public_url } = await client.files.createPublicUrl(file.id, {
  expires_after: 86_400,
});
console.log(public_url);

await client.files.revokePublicUrl(file.id);
await client.files.delete(file.id);
```

`list()` returns the newest files first and fetches further pages as the loop needs them. `content()` returns an `BinaryResponse`: stream its `body` or read it with `bytes()`, `text()`, or `blob()`.

Anyone with a public URL can download the file without an API key. Only images, videos, and PDFs up to 50 MiB can be made public. A file has at most one public URL, so calling `createPublicUrl()` again returns the existing URL and updates its expiry if you pass a new `expires_after`. Without `expires_after`, the URL lasts as long as the file unless you revoke it. After revoking, copies already cached by the CDN can still be served briefly.

## Batch API

The Batch API processes large volumes of requests asynchronously at a reduced price. Most requests complete within 24 hours. Create a batch, then add requests to it:

```ts
const batch = await client.batches.create({ name: "feedback_sentiment" });

const feedback = [
  { id: "feedback_001", text: "The product exceeded my expectations!" },
  { id: "feedback_002", text: "Shipping took way too long." },
];

await client.batches.requests.add(batch.batch_id, {
  batch_requests: feedback.map((item) => ({
    batch_request_id: item.id,
    batch_request: {
      responses: {
        model: "grok-4.7",
        input: [
          { role: "system", content: "Classify the sentiment as positive, negative, or neutral." },
          { role: "user", content: item.text },
        ],
      },
    },
  })),
});
```

Each `batch_request` holds one request. `responses` takes the same `CreateParams` as `client.responses.create()`, including the `store: false` default, and its result comes back as a `chat_get_completion` response. `image_generation`, `image_edit`, `video_generation`, and `video_extension` take the request body of the matching REST endpoint. Results can come back in any order, so give each request a `batch_request_id` that is unique within the batch. Not every model accepts batch requests; each [model page](https://docs.x.ai/developers/models) lists its Batch API support.

Wait until no requests are pending, then read the results:

```ts
await client.batches.wait(batch.batch_id);

for await (const { batch_request_id, batch_result } of client.batches.results(batch.batch_id)) {
  if ("error" in batch_result) {
    console.error(batch_request_id, batch_result.error);
  } else {
    console.log(batch_request_id, batch_result.response);
  }
}
```

`wait()` polls every 5 seconds and rejects with `TimeoutError` after 24 hours. Pass `interval`, `timeout`, or `signal` to change that. Results are available as soon as each request finishes, so you can read them before the whole batch completes. Use `client.batches.requests.list()` to check the state of individual requests, `client.batches.list()` to list your team's batches, and `client.batches.cancel()` to stop the remaining requests. Finished results stay available after cancelling.

## Voice

Convert text to speech with `client.voice.speak()`. The audio comes back as an `BinaryResponse`, encoded as MP3 unless you set `output_format`:

```ts
import { writeFile } from "node:fs/promises";

const speech = await client.voice.speak({
  text: "Welcome to SpaceX. [pause] How can I help you today?",
  language: "en",
  voice_id: "eve",
});

await writeFile("welcome.mp3", await speech.bytes());
```

Shape the delivery with [speech tags](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech#speech-tags) in the text. Inline tags such as `[pause]`, `[long-pause]`, and `[laugh]` go where the sound should happen, and wrapping tags such as `<whisper>It's a secret.</whisper>` change how the enclosed text is spoken. The API doesn't report mistakes in tags, so TypeScript checks string literals as you type: it flags unknown tags such as `[laff]` and suggests the closest one, and it catches wrapping tags that are never closed, closed without being opened, or closed in the wrong order. To use a tag released after this SDK version, add `as UnsafeSpeechText` to the text, which skips the check. Searching for `UnsafeSpeechText` then finds every tag to clean up once the SDK knows it:

```ts
import { type UnsafeSpeechText } from "@xai-official/sdk";

await client.voice.speak({
  text: "Hello [new-tag] there." as UnsafeSpeechText,
  language: "en",
});
```

The type check only covers string literals, so text typed as `string` is sent unchecked. That matters for text you don't write yourself, such as a script the model wrote or text your users submit: the model can make up a tag such as `[laff]`, and the API reads it aloud. Put the real tags in the prompt with `INLINE_SPEECH_TAGS` and `WRAPPING_SPEECH_TAGS`, then call `stripInvalidSpeechTags()` before speaking, which removes any tag the API wouldn't recognize and keeps the words it wraps. `checkSpeechText()` returns the same problems the type check reports, for logging, for showing to a user, or for asking the model to fix its text:

```ts
import { INLINE_SPEECH_TAGS, checkSpeechText, stripInvalidSpeechTags } from "@xai-official/sdk";

const tags = INLINE_SPEECH_TAGS.map((tag) => `[${tag}]`).join(", ");
const response = await client.responses.create({
  model: "grok-4.7",
  input: `Write the opening line of a podcast about volcanoes. You can use these speech tags: ${tags}.`,
});
const line = response.toText();

const problems = checkSpeechText(line); // For example: ["Unknown speech tag [laff], did you mean [laugh]?"]
if (problems.length > 0) console.warn(problems);

await client.voice.speak({ text: stripInvalidSpeechTags(line), language: "en" });
```

`voice_id` autocompletes the built-in voices and accepts any other string, such as a custom voice ID or a voice added after this SDK version. List the built-in voices with `client.voice.list()`. To start playback before synthesis finishes, read `speech.body` as a stream. Set `with_timestamps: true` to receive JSON with base64 `audio` and per-character `audio_timestamps` instead of audio bytes.

Transcribe a recording with `client.voice.transcribe()`. Pass the audio as a `Blob` or `File`, or pass `url` to have the API download it:

```ts
import { openAsBlob } from "node:fs";

const transcript = await client.voice.transcribe({
  file: await openAsBlob("./meeting.mp3"),
  language: "en",
  format: true,
});

console.log(transcript.text);
```

`format: true` writes spoken numbers, currencies, and units in written form, and requires `language`. Word-level timings are in `transcript.words`.

Clone a voice from a reference clip of up to 120 seconds with `client.voice.custom.create()`. Creating custom voices through the API requires an Enterprise plan:

```ts
import { openAsBlob } from "node:fs";

const voice = await client.voice.custom.create({
  file: await openAsBlob("./reference.wav"),
  name: "Friendly Narrator",
  language: "en",
});

console.log(voice.voice_id);
```

Pass the returned `voice_id` to `speak()` or a realtime session like a built-in voice. `client.voice.custom` also provides `list()`, `get()`, `update()`, `delete()`, and `getAudio()`, which downloads the reference clip.

Realtime voice sessions in a browser should authenticate with a short-lived client secret instead of your API key. Create one on your server:

```ts
const secret = await client.voice.clientSecrets.create({
  expires_after: { seconds: 300 },
});
```

Send `secret.value` to the browser, which passes `xai-client-secret.<value>` as the WebSocket subprotocol when it connects to `wss://api.x.ai/v1/realtime`. Secrets expire after 10 minutes by default, and `expires_after.seconds` can be at most 3600.

## Tokenization

Encode text with a language model's tokenizer to count its tokens or see how it is split:

```ts
const { token_ids } = await client.tokenizer.encode({
  model: "grok-4.7",
  text: "Hello world!",
});

console.log(token_ids.length);
for (const token of token_ids) {
  console.log(token.token_id, token.string_token);
}
```

Inference requests add tokens of their own, so `usage.input_tokens` for a prompt can be higher than this count.

The API has no decode endpoint, but each token carries its bytes, so you can turn encoded tokens back into text. Decode `token_bytes` rather than joining `string_token`, because a token can hold part of a multi-byte character:

```ts
const text = new TextDecoder().decode(
  new Uint8Array(token_ids.flatMap((token) => token.token_bytes)),
);
```

## Models

Use model IDs directly. `ModelId` suggests known string literals while still accepting models released after the installed SDK version:

```ts
import { type KnownModelId } from "@xai-official/sdk";

const model: KnownModelId = "grok-4.7";

const available = await client.models.list();
for (const availableModel of available.data) {
  console.log(availableModel.id);
}

const modelInfo = await client.models.get(model);
console.log(modelInfo);
```

`KnownModelId` is generated from the [SpaceXAI model documentation](https://docs.x.ai/developers/models). Use it when you want strict validation against the models known to this SDK release.

Image generation models have their own catalog, which includes modalities, aliases, and pricing. `ImageModelId` and `KnownImageModelId` work the same way as the text model types:

```ts
import { type KnownImageModelId } from "@xai-official/sdk";

const imageModel: KnownImageModelId = "grok-imagine-image-2.0";

const imageModels = await client.models.image.list();
for (const availableImageModel of imageModels.models) {
  console.log(availableImageModel.id, availableImageModel.aliases);
}

const imageModelInfo = await client.models.image.get(imageModel);
console.log(imageModelInfo);
```

Chat and image understanding models have their own catalog, which includes modalities, aliases, token pricing, and supported reasoning efforts:

```ts
const languageModels = await client.models.language.list();
for (const languageModel of languageModels.models) {
  console.log(languageModel.id, languageModel.input_modalities);
}

const languageModelInfo = await client.models.language.get("grok-4.7");
console.log(languageModelInfo.capabilities?.reasoning_effort);
```

Token prices such as `prompt_text_token_price` are in USD cents per 100 million tokens. Divide them by 10,000 for US dollars per million tokens.

## Account

`client.account.apiKey()` returns the name, status, and permissions of the API key the client is using:

```ts
const apiKeyInfo = await client.account.apiKey();
console.log(apiKeyInfo.name, apiKeyInfo.acls, apiKeyInfo.api_key_disabled);
```

## Response storage

The SDK sends `store: false` unless you opt in. This differs from the API wire default. With storage disabled, the SDK requests encrypted reasoning content so `response.toInput()` can preserve context between turns.

Pass `store: true` when you need to retrieve, continue, inspect, or delete a response by ID:

```ts
const stored = await client.responses.create({
  model: "grok-4.7",
  input: "Save this response.",
  store: true,
});

const fetched = await client.responses.get(stored.id);
const inputItems = await client.responses.inputItems.list(stored.id);
await client.responses.delete(stored.id);
```

## Pagination

List methods that return results in pages fetch the next page for you in a `for await` loop:

```ts
for await (const file of client.files.list()) {
  console.log(file.id);
}
```

This works for `files.list()`, `batches.list()`, `batches.results()`, `batches.requests.list()`, `voice.custom.list()`, and `responses.inputItems.list()`. Awaiting one of these calls instead returns a single page.

## Timeouts, retries, and cancellation

Configure defaults on the client:

```ts
const client = new SpaceXAI({
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
    model: "grok-4.7",
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

Requests that generate content, such as `responses.create`, `images.generate`, and `images.edit`, retry only explicit `429` responses by default. Read-only requests may also retry transient HTTP failures. Retry delays honor `Retry-After` and otherwise use jittered exponential backoff, which starts at 1 second for a `429`.

Set `retryBeforeOutput: true`, on the client or on one request, to also retry streamed `responses.create()` calls, including ones without `stream`, when they fail before the model produces any output: a `5xx` status, a dropped connection, or a stream error such as a `503` right after `response.created`. All retries of a call share `maxRetries`, so a call makes at most `maxRetries + 1` requests. Events from the failed attempt don't reach your listeners or loop, and every attempt sends the same `x-client-request-id`. Each retry starts a new response, and the API may still bill the failed attempt's input tokens, so this is off by default. Errors after output has started are never retried, and neither are `5xx` responses to `stream: false` requests, which can arrive after the model has finished.

When you leave out `stream`, `responses.create()` streams the response under the hood and resolves to the final response. Streamed responses send headers right away, so long reasoning requests aren't cut off by limits on waiting for headers, such as the 5 minutes that Node's built-in `fetch` allows whatever `timeout` is set to. Reasoning can also go quiet for minutes, so these requests only apply `idleTimeout` when you pass it on the request. Set `stream: false` to send a plain JSON request instead.

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
    model: "grok-4.7",
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

Set `XAI_DEBUG=1` to print each request's method, URL, and headers as a cURL command:

```bash
XAI_DEBUG=1 node app.js
```

Authentication headers and common credential fields are redacted. Request bodies are always omitted because prompts and tool outputs may contain sensitive data.

Structured API failures expose `error.type`, `error.code`, and `error.param` when the server returns them. The SpaceXAI request ID is also available at `response.http.requestId` and `error.requestId`. Include it when reporting an API problem.

Every request also sends an `x-client-request-id` header with a UUID generated by the SDK. The ID stays the same across retries and is available at `response.http.clientRequestId` and `error.clientRequestId`, even when a request fails before the API responds. To use your own ID, set `x-client-request-id` in the request `headers`.

## Development

Install dependencies and run the checks:

```bash
pnpm install
pnpm check
pnpm pack:check
pnpm pack:smoke
```

Run every release gate, including the dependency audit:

```bash
pnpm release:check
```

Create a distributable tarball and SHA-256 checksum in `artifacts/`:

```bash
pnpm pack:artifact
```

Generated API types live in `src/generated/types.ts`, speech tags, voice IDs, and voice model IDs in `src/generated/voice.ts`, and the model ID union in `src/models.ts`. Run `pnpm generate:types` for API types, `pnpm generate:voice` for the Voice API values, and `pnpm generate:models` for model IDs instead of editing those files by hand. `pnpm generate:types` saves the OpenAPI spec it used to `spec/openapi.json`, and the tests fail if the generated types don't match it.

## Contributing and security

We aren't accepting outside contributions yet, but plan to later. Please [open an issue](https://github.com/xai-org/xai-sdk-ts/issues) for bugs and feature requests. [CONTRIBUTING.md](./CONTRIBUTING.md) covers local development.

Report suspected vulnerabilities privately as described in [SECURITY.md](./SECURITY.md). Do not include credentials, confidential data, or unredacted request bodies in public issues.

## License

Licensed under the [Apache License 2.0](./LICENSE).
