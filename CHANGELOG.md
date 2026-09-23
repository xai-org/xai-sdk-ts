# Changelog

All notable changes to the xAI TypeScript SDK will be documented in this file.

## [Unreleased]

### Added

- Open-source contribution, security, ownership, CI, and release safeguards.
- Image and video generation model ID types: `ImageModelId`, `KnownImageModelId`, `VideoModelId`, and `KnownVideoModelId`.
- Image generation and editing with `client.images.generate()` and `client.images.edit()`, including multi-image edits and `Blob` or `File` source images.
- Image generation model lookup with `client.images.models.list()` and `client.images.models.get()`.
- `isImageGenerationCall` and typed `response.image_generation_call.*` stream events for the Responses API image generation tool.
- Video generation, image-to-video, editing, and extension with `client.videos.generate()`, `client.videos.edit()`, and `client.videos.extend()`, including `Blob` or `File` image inputs.
- `client.videos.get()` to check a video request and `client.videos.wait()` to poll it until it is no longer pending, with `interval`, `timeout`, and `signal` options.
- Video generation model lookup with `client.videos.models.list()` and `client.videos.models.get()`.
- File uploads and management with `client.files.upload()`, `list()` (newest first by default), `get()`, and `delete()`, plus `content()`, which downloads a file's bytes as an `xAIBinaryResponse`.
- Public file URLs with `client.files.createPublicUrl()` and `client.files.revokePublicUrl()`.
- Batch API support with `client.batches.create()`, `list()`, `get()`, `cancel()`, and `results()`, plus `client.batches.requests.add()` and `client.batches.requests.list()`.
- `client.batches.wait()` polls a batch until no requests are pending.
- Batch `responses` requests take the same `CreateParams` as `client.responses.create()`, with the same `Blob` image inlining and `store: false` default.
- Conversation compaction with `client.responses.compact()`, which returns a single encrypted item to start the next request's input, plus the `CompactParams` and `CompactResponse` types.
- Text to speech with `client.voice.speak()`, which returns the audio as an `xAIBinaryResponse`, or JSON with base64 audio and per-character timings when `with_timestamps` is true.
- Speech tag checks for string literals passed to `client.voice.speak()`: unknown tags such as `[laff]` are type errors that suggest the closest tag, and so are wrapping tags that are never closed or closed out of order, because the API accepts both without an error. Text typed as `string` is sent as written, so tags released after the SDK still work.
- `VoiceId`, `TranscriptionModelId`, and `RealtimeModelId` types, each with a `Known…` variant for strict checks. `voice_id`, the `model` for `client.voice.transcribe()`, and a client secret's `session.model` autocomplete the documented values and accept any other string.
- Speech to text with `client.voice.transcribe()` for `Blob` or `File` uploads and audio URLs.
- Built-in voice lookup with `client.voice.voices`, custom voice management with `client.voice.custom`, and client secrets for browser realtime sessions with `client.voice.clientSecrets.create()`.
- Embeddings with `client.embeddings.create()`, and embedding model lookup with `client.embeddings.models.list()` and `client.embeddings.models.get()`.
- Text tokenization with `client.tokenizer.encode()`, which returns each token's ID, text, and bytes.
- Collection document search with `client.documents.search()`.
- Language model lookup with `client.models.language.list()` and `client.models.language.get()`, including modalities, aliases, and token pricing.
- API key and caller lookup with `client.account.apiKey()` and `client.account.me()`.

### Changed

- Debug request logging now omits request bodies to avoid exposing prompts, tool output, or credentials.
- Client instances no longer expose the configured API key through a public getter.
- Generated API types and known model IDs are refreshed from the current xAI documentation, adding `grok-4.7`.
- `usage.cost_in_usd_ticks` is always present and `null` when the API omits it, like `cost_in_nano_usd`.
- `usage.server_side_tool_usage_details` is passed through as the API sends it, so its type now includes `null`.

### Fixed

- `usage.cost_usd` is derived from `cost_in_usd_ticks`, falling back to `cost_in_nano_usd`. It was `null` for every Responses call because the API no longer reports `cost_in_nano_usd`.
- Usage objects keep wire fields the SDK does not normalize, such as `context_details`.
- `Blob` and `File` image inputs without a MIME type are sent with the type detected from their bytes (JPEG, PNG, or WebP). The API rejects untyped image data URLs with `invalid_image`.
- Error messages include the server's explanation when an endpoint reports the error as a plain string, instead of only the HTTP status text.
