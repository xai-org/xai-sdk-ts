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
    <img src="https://img.shields.io/badge/status-experimental-orange.svg" alt="Experimental" />
  </p>
  <p>
    <a href="https://docs.x.ai">Documentation</a>
    ·
    <a href="https://console.x.ai">API keys</a>
    ·
    <a href="https://github.com/xai-org/xai-sdk-ts/issues">Issues</a>
  </p>
</div>

Use Grok from TypeScript with a typed, ESM client built on the xAI REST API. The SDK has no runtime dependencies and includes streaming, structured output, function tools, image input, image generation and editing, file uploads, multi-turn conversations, and access to usage and HTTP metadata.

> **Experimental.** This SDK is in early development. It currently covers the Responses API, image generation and editing, the Files API, and model listing, and its interfaces may change between releases before 1.0. Pin an exact version and read the [changelog](./CHANGELOG.md) when upgrading. Feedback and bug reports are welcome in [issues](https://github.com/xai-org/xai-sdk-ts/issues).

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

### Compacting long conversations

Every turn resends the whole conversation, so input tokens grow as it gets longer. Compact the conversation into a single encrypted item with `responses.compact()`, then start the next input with the compacted `output`. Continuing the `toInput()` example:

```ts
const compacted = await client.responses.compact({
  model: "grok-4.6",
  input: [
    ...input,
    ...first.toInput(),
    { role: "user", content: "What is my name?" },
    ...second.toInput(),
  ],
});

const third = await client.responses.create({
  model: "grok-4.6",
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

For a local image, pass a `Blob` or `File` as `image`. The SDK converts it to a data URL before sending the request, and detects JPEG, PNG, or WebP from the bytes when the `Blob` has no MIME type.

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

## Image generation tool

Add the image generation tool to let the model create or edit images as one step of a response. Each image arrives as an `image_generation_call` output item whose `result` holds base64 image data:

```ts
import { writeFile } from "node:fs/promises";
import { type Tool, isImageGenerationCall, xAI } from "@xai-official/sdk";

const client = new xAI();
const imageGenerationTool = {
  type: "image_generation",
} satisfies Tool;

const response = await client.responses.create({
  model: "grok-4.7",
  input: "Generate an image of a corgi surfing a big wave, in the style of a Japanese woodblock print.",
  tools: [imageGenerationTool],
});

console.log(response.toText());

const call = response.output.find(isImageGenerationCall);
if (call?.result) {
  await writeFile("corgi.jpg", Buffer.from(call.result, "base64"));
}
```

Set `action: "generate"` or `action: "edit"` on the tool to allow only one of those capabilities. When streaming, each call emits `response.image_generation_call.in_progress`, `response.image_generation_call.generating`, and `response.image_generation_call.completed` events, then a `response.output_item.done` event carries the finished item.

To generate or edit an image directly with full control over its size and format, use the [image generation](#image-generation) and [image editing](#image-editing) methods instead.

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

`wait()` polls every 5 seconds for up to 10 minutes. Pass `interval` and `timeout` in milliseconds to change this, and a `signal` to stop waiting. A timeout rejects with `TimeoutError` but does not cancel the job, so you can call `wait()` again. To check once without waiting, call `client.videos.get(request_id)`, which returns `status: "pending"` until the video is ready.

To animate a still image, pass it as `image`. `image`, `reference_images`, and keyframe images accept a public URL, a base64 data URL, a Files API `file_id`, or a `Blob` or `File`, which the SDK converts to a data URL before sending the request:

```ts
import { openAsBlob } from "node:fs";

const { request_id } = await client.videos.generate({
  model: "grok-imagine-video-1.5",
  prompt: "Make the water crash down and slowly pan out the camera",
  image: await openAsBlob("./waterfall.png"),
});
```

Edit a video with `edit()`, or continue it from its last frame with `extend()`. Both return a `request_id` for `wait()`. The source `video` must be an MP4, given as a public URL, a base64 data URL, or a Files API `file_id`. For extensions, `duration` sets the length of the new segment only:

```ts
const edit = await client.videos.edit({
  model: "grok-imagine-video",
  prompt: "Give the woman a silver necklace",
  video: { url: "https://example.com/portrait.mp4" },
});

const extension = await client.videos.extend({
  model: "grok-imagine-video",
  prompt: "The camera slowly zooms out to reveal the city skyline",
  video: { file_id: "file_abc123" },
  duration: 6,
});
```

List the video generation models available to your API key with `client.videos.models.list()`, or look one up by ID with `client.videos.models.get()`.

## Files

Upload a document, image, or video once and refer to it by ID. A file ID works wherever the API accepts a `file_id`, such as an `input_file` part in the Responses API or an image or video input:

```ts
import { openAsBlob } from "node:fs";

const file = await client.files.upload({
  file: await openAsBlob("./report.pdf"),
  filename: "report.pdf",
});

const response = await client.responses.create({
  model: "grok-4.6",
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

const page = await client.files.list({ limit: 100 });
for (const stored of page.data) {
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

`list()` returns the newest files first. To fetch the next page, pass the returned `pagination_token` to `list()`. A page with fewer than `limit` files is the last one. `content()` returns an `xAIBinaryResponse`: stream its `body` or read it with `bytes()`, `text()`, or `blob()`.

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
        model: "grok-4.3",
        input: [
          { role: "system", content: "Classify the sentiment as positive, negative, or neutral." },
          { role: "user", content: item.text },
        ],
      },
    },
  })),
});
```

Each `batch_request` holds one request. `responses` takes the same `CreateParams` as `client.responses.create()`, including the `store: false` default, and its result comes back as a `chat_get_completion` response. `chat_get_completion`, `image_generation`, `image_edit`, `video_generation`, and `video_extension` take the request body of the matching REST endpoint. Results can come back in any order, so give each request a `batch_request_id` that is unique within the batch. Not every model accepts batch requests; each [model page](https://docs.x.ai/developers/models) lists its Batch API support.

Wait until no requests are pending, then page through the results:

```ts
await client.batches.wait(batch.batch_id);

let paginationToken: string | undefined;
do {
  const page = await client.batches.results(batch.batch_id, {
    limit: 100,
    pagination_token: paginationToken,
  });
  for (const { batch_request_id, batch_result } of page.results) {
    if ("error" in batch_result) {
      console.error(batch_request_id, batch_result.error);
    } else {
      console.log(batch_request_id, batch_result.response);
    }
  }
  paginationToken = page.pagination_token ?? undefined;
} while (paginationToken);
```

`wait()` polls every 5 seconds and rejects with `TimeoutError` after 24 hours. Pass `interval`, `timeout`, or `signal` to change that. Results are available as soon as each request finishes, so you can read them before the whole batch completes. Use `client.batches.requests.list()` to check the state of individual requests, `client.batches.list()` to page through your team's batches, and `client.batches.cancel()` to stop the remaining requests. Finished results stay available after cancelling.

## Voice

Convert text to speech with `client.voice.speak()`. The audio comes back as an `xAIBinaryResponse`, encoded as MP3 unless you set `output_format`:

```ts
import { writeFile } from "node:fs/promises";

const speech = await client.voice.speak({
  text: "Welcome to SpaceX. [pause] How can I help you today?",
  language: "en",
  voice_id: "eve",
});

await writeFile("welcome.mp3", await speech.bytes());
```

Shape the delivery with [speech tags](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech#speech-tags) in the text. Inline tags such as `[pause]`, `[long-pause]`, and `[laugh]` go where the sound should happen, and wrapping tags such as `<whisper>It's a secret.</whisper>` change how the enclosed text is spoken. The API doesn't report mistakes in tags, so TypeScript checks string literals as you type: it flags unknown tags such as `[laff]` and suggests the closest one, and it catches wrapping tags that are never closed, closed without being opened, or closed in the wrong order. To use a tag released after this SDK version, add `as string` to the text.

`voice_id` autocompletes the built-in voices and accepts any other string, such as a custom voice ID or a voice added after this SDK version. List the built-in voices with `client.voice.voices.list()`. To start playback before synthesis finishes, read `speech.body` as a stream. Set `with_timestamps: true` to receive JSON with base64 `audio` and per-character `audio_timestamps` instead of audio bytes.

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

## Embeddings

Create vector embeddings for text with one of the embedding models available to your API key:

```ts
const { models } = await client.embeddings.models.list();
const [embeddingModel] = models;
if (!embeddingModel) throw new Error("No embedding models are available to this API key");

const result = await client.embeddings.create({
  model: embeddingModel.id,
  input: ["How do I rotate an API key?", "Create a new key, deploy it, then delete the old key."],
});

for (const item of result.data) {
  console.log(item.index, item.embedding);
}
console.log(result.usage?.total_tokens);
```

Pass a string or an array of up to 128 strings as `input`, or token IDs in the same shapes. Set `encoding_format: "base64"` to receive each embedding as a base64 string instead of an array of floats.

The embedding model catalog also includes modalities, aliases, and pricing. `client.embeddings.models.get(id)` returns one model.

## Tokenization

Tokenize text with a language model to count its tokens or see how it is split:

```ts
const { token_ids } = await client.tokenizer.tokenize({
  model: "grok-4.6",
  text: "Hello world!",
});

console.log(token_ids.length);
for (const token of token_ids) {
  console.log(token.token_id, token.string_token);
}
```

Inference requests add tokens of their own, so `usage.input_tokens` for a prompt can be higher than this count.

## Document search

Search for the document chunks most relevant to a query within one or more [collections](https://docs.x.ai/developers/files/collections):

```ts
const results = await client.documents.search({
  query: "What was the revenue in the last quarter?",
  source: { collection_ids: ["collection_abc123"] },
  filter: 'document_type = "financial_report" AND year > 2020',
  limit: 5,
});

for (const match of results.matches) {
  console.log(match.score, match.file_id, match.chunk_content);
}
```

`filter` matches the [metadata fields](https://docs.x.ai/developers/files/collections/metadata) defined on a collection, and `retrieval_mode` selects semantic, keyword, or hybrid search.

Search requests use your regular API key. To create collections and upload documents, use the [xAI Console](https://console.x.ai) or the Management API, which this SDK does not cover.

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

Image generation models have their own catalog, which includes modalities, aliases, and pricing. `ImageModelId` and `KnownImageModelId` work the same way as the text model types:

```ts
import { type KnownImageModelId } from "@xai-official/sdk";

const imageModel = "grok-imagine-image-2.0" satisfies KnownImageModelId;

const imageModels = await client.images.models.list();
for (const availableImageModel of imageModels.models) {
  console.log(availableImageModel.id, availableImageModel.aliases);
}

const imageModelInfo = await client.images.models.get(imageModel);
console.log(imageModelInfo);
```

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

Requests that generate content, such as `responses.create`, `images.generate`, and `images.edit`, retry only explicit `429` responses by default. Read-only requests may also retry transient HTTP failures. Retry delays honor `Retry-After` and use jittered exponential backoff.

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

Set `XAI_DEBUG=1` to print each request's method, URL, and headers as a cURL command:

```bash
XAI_DEBUG=1 node app.js
```

Authentication headers and common credential fields are redacted. Request bodies are always omitted because prompts and tool outputs may contain sensitive data.

Structured API failures expose `error.type`, `error.code`, and `error.param` when the server returns them. The xAI request ID is also available at `response.http.requestId` and `error.requestId`. Include it when reporting an API problem.

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

Generated API types live in `src/generated/types.ts`, speech tags, voice IDs, and voice model IDs in `src/generated/voice.ts`, and the model ID union in `src/models.ts`. Run `pnpm generate:types` for API types, `pnpm generate:voice` for the Voice API values, and `pnpm generate:models` for model IDs instead of editing those files by hand.

## Contributing and security

We aren't accepting outside contributions yet, but plan to later. Please [open an issue](https://github.com/xai-org/xai-sdk-ts/issues) for bugs and feature requests. [CONTRIBUTING.md](./CONTRIBUTING.md) covers local development.

Report suspected vulnerabilities privately as described in [SECURITY.md](./SECURITY.md). Do not include credentials, confidential data, or unredacted request bodies in public issues.

## License

Licensed under the [Apache License 2.0](./LICENSE).
