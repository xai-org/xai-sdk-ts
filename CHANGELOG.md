# Changelog

All notable changes to the SpaceXAI TypeScript SDK will be documented in this file.

## [Unreleased]

### Added

- `output.upload_urls` on image requests uploads each image to a signed URL that you provide.
- `service_tier: "fast"`, which is interchangeable with `"priority"` and uses a model's fast deployment where it has one.
- `grok-imagine-video-1.5-lite` in `KnownVideoModelId`.

### Changed

- Updated the API types to the current OpenAPI spec. The `max_output_tokens` doc comment now says that it limits only visible output tokens, as the API does: reasoning and function call tokens don't count toward it.

## [0.2.2] - 2026-10-05

### Fixed

- A `responses.create()` without `stream` now resolves when a `retryBeforeOutput` retry returns JSON, as it does when the first attempt returns JSON, instead of throwing `Streaming response must use text/event-stream`.

## [0.2.1] - 2026-10-02

### Added

- `toJson(schema)` validates structured output with a Standard Schema validator, such as a Zod, Valibot, or ArkType schema, and returns the schema's typed output.
- A `"json"` stream event and `parsePartialJson()` for reading structured output while it streams.
- `checkSpeechText()` and `stripInvalidSpeechTags()` check speech tags at runtime, for text such as model output. `INLINE_SPEECH_TAGS` and `WRAPPING_SPEECH_TAGS` list the known tags.
- `retryBeforeOutput` retries a streamed `responses.create()` that fails before the model produces any output, within `maxRetries`.

### Changed

- A `429` without `Retry-After` now backs off from 1 second, up to 30 seconds, instead of from 250 milliseconds.

## [0.2.0] - 2026-10-02

### Changed

- **Breaking:** Renamed the client class from `xAI` to `SpaceXAI`, and the `xAIResponse`, `xAIStream`, `xAIStreamEvent`, and `xAIBinaryResponse` types to `ModelResponse`, `ResponseStream`, `ResponseStreamEvent`, and `BinaryResponse`.
- Client error messages start with `SpaceXAI:` instead of `xAI:`.
- The README, package description, and doc comments say SpaceXAI.

## [0.1.0] - 2026-10-02

Initial public release.

### Added

- Responses API: create, stream, retrieve, delete, and compact responses, with multi-turn conversations, image input, and structured output.
- Streaming with `on()` listeners for text, reasoning, tool calls, images, citations, and every server-sent event, and `done()` for the final response.
- Function tools, the shell tool, and helpers for the built-in tools in `@xai-official/sdk/tools`: web search, X search, code execution, collections search, remote MCP servers, image generation, and tool search.
- Image generation and editing, and video generation, editing, and extension, with local image and video uploads.
- Files, Batch, and Voice APIs, including text to speech, transcription, and custom voices.
- Tokenization, model catalogs, and account lookup.
- Automatic pagination for list methods.
- Retries, timeouts, cancellation, typed errors, and an `x-client-request-id` header on every request.
