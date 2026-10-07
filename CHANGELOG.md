# Changelog

All notable changes to the SpaceXAI TypeScript SDK will be documented in this file.

## [0.2.3] - 2026-10-07

### Added

- `output.upload_urls` on image requests uploads each image to a signed URL that you provide.
- `service_tier: "fast"`, which is interchangeable with `"priority"` and uses a model's fast deployment where it has one.
- `grok-imagine-video-1.5-lite` in `KnownVideoModelId`.
- `last_frame` for `videos.generate()`, the image the video ends on. It takes the same inputs as `image`.
- `reference_audios` for `videos.generate()` is typed: each entry is a preset voice as `{ voice_id }`, which autocompletes the built-in voices, a clip as `{ url }`, or a `Blob` or `File`, which the SDK converts to a data URL like `reference_images`. The `ReferenceAudioInput` type describes an entry.
- `gender` on the voices that `voice.list()` and `voice.get()` return.
- `instructions` and `turn_detection` in the `session` of `voice.clientSecrets.create()`.
- `grok-4.20-multi-agent` in `KnownModelId`, alongside `grok-4.20-multi-agent-0309`.

### Fixed

- Streams no longer fail with `SSE event exceeds 1048576 characters` when one event is larger than 1 MiB, such as the encrypted reasoning that `grok-4.20-multi-agent` sends for all its agents in one event when `store` is false. The final event carries the whole response, so each event now gets the same limit as a JSON response, `maxResponseBodyBytes`. The SDK still requests encrypted reasoning for every model, so `toInput()` keeps the agents' context between turns.
- `voice.transcribe()` names a `Blob` without a file name after its audio format, such as `audio.mp3`, so the API can tell the format. The format comes from the Blob's MIME type or, when it has none, as with `openAsBlob()`, from its first bytes, which the SDK recognizes for MP3, AAC, WAV, FLAC, Ogg, Opus, M4A, MP4, Matroska, and WebM. With `diarize: true`, such a Blob failed with `Unsupported audio_format: 'blob'`. A `File` keeps its name, an explicit `audio_format` is sent as before, and `voice.custom.create()` names its upload the same way.
- `stripInvalidSpeechTags()` no longer removes bracketed text that isn't a speech tag, such as `[they]` in a quote. Bracketed text counts as a tag when it's a known tag, has a hyphen like `[new-tag]`, or resembles a known inline tag, like `[laff]` or `[laughs]`. Other bracketed words, such as `[music]`, are read aloud, and `checkSpeechText()` and the `SpeechText` type don't report them.
- `stripInvalidSpeechTags()` removes markup that isn't a speech tag, such as `<citation id="web:23"/>`, which the API would read aloud, and keeps the text it wraps. `checkSpeechText()` and the `SpeechText` type report it.
- `batches.wait()` no longer returns right after `batches.create({ input_file_id })`, while the batch reports no requests because it's still loading the file. A batch without requests counts as finished only once it's cancelled or expires.
- `videos.generate()` converts a `Blob` or `File` anywhere in the request to a data URL. A Blob in `last_frame` or `reference_audios` was sent as `{}`.
- The package includes `CHANGELOG.md`, which the README links to.

### Changed

- Updated the API types to the current OpenAPI spec. The `max_output_tokens` doc comment now says that it limits only visible output tokens, as the API does: reasoning and function call tokens don't count toward it.
- `maxResponseBodyBytes` also limits each event in a response stream, which had a fixed limit of 1 MiB. Stream events can now be up to 32 MiB by default, and a client that sets a lower `maxResponseBodyBytes` applies it to stream events too.

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
