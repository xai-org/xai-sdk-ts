# Changelog

All notable changes to the SpaceXSI TypeScript SDK will be documented in this file.

## [Unreleased]

### Added

- `voice.transcribe()` takes `"webm"`, `"avi"`, and `"mov"` for `audio_format`. A `Blob` without a name is sent as `audio.avi` or `audio.mov` when its MIME type is `video/x-msvideo`, `video/avi`, `video/vnd.avi`, or `video/quicktime`, or when it has no MIME type and its first bytes show AVI or QuickTime. QuickTime files were sent as `audio.mp4` before, which the API also reads.
- `guidelines` on `responses.create()` takes the `"cyber"` category and the `"allow"` behavior. The API accepts `"allow"` only with `"cyber"`, and `"decline"` only with `"nsfw"`, `"violence"`, and `"profanity"`, and rejects other pairs with `400`. `"cyber"` must be enabled for the API key, and the API answers `403` when it isn't.
- `incomplete_details.reason` can be `"content_filter"`.

### Changed

- Updated the API types to the current OpenAPI spec. The spec also adds an `ImageBackground` schema that no endpoint uses yet, so it changes no request or response type.

## [0.2.6] - 2026-10-28

### Changed

- **Behavior change:** `timeout`, `idleTimeout`, and the `timeout` and `interval` of `videos.wait()` and `batches.wait()` are capped at 24 hours, so none of them waits without a limit. A longer value means 24 hours, and so does a `timeout` or `idleTimeout` of `0` or less, which used to mean no limit. A `wait()` timeout of `0` or less still expires at once, and an `interval` of `0` or less still polls again without a pause. A `wait()` that times out rejects with `TimeoutError`, so call it again to wait longer.
- Renamed the client class from `SpaceXAI` to `SpaceXSI`. `SpaceXAI` is still exported as a deprecated alias of the same class, so `new SpaceXAI()`, `instanceof SpaceXAI`, and the `SpaceXAI` type keep working, and editors mark them as deprecated. Replace `SpaceXAI` with `SpaceXSI` to drop the warning.
- Client error messages start with `SpaceXSI:` instead of `SpaceXAI:`.
- The README, package description and author, and doc comments say SpaceXSI.

### Fixed

- With `retryBeforeOutput`, a streamed `responses.create()` whose connection drops after the `200` headers but before the first byte of the event stream is retried, like a connection that fails before the headers. It used to reject with `APIConnectionError` after one request, while a drop after the first byte was retried. An idle or per-attempt timeout, or a caller abort, before the first byte still fails the call, and the default without `retryBeforeOutput` is unchanged.
- `Infinity`, or a value of more than about 24.8 days, no longer makes `timeout`, `idleTimeout`, or a `wait()` timeout expire at once, or a `wait()` interval poll every millisecond. Node and browsers keep a timer delay in a signed 32-bit integer, and a larger one overflows. These values now mean 24 hours. `NaN` counts as `0` for all of these options, so a `timeout` of `NaN` now means 24 hours instead of timing out at once.

## [0.2.5] - 2026-10-23

### Changed

- **Breaking:** `guidelines` on `responses.create()` takes the API's new categories. `category` is `"nsfw"`, `"violence"`, or `"profanity"`, and `behavior` is `"decline"`, the only behavior. `"sexual"` is renamed to `"nsfw"`, and the `"self_harm"` and `"illicit"` categories and the `"offer_support"` behavior are removed. The API rejects the old values with `422` and TypeScript reports them as errors, so replace `"sexual"` with `"nsfw"` and remove guidelines that use `"self_harm"`, `"illicit"`, or `"offer_support"`.
- Updated the API types to the current OpenAPI spec. A request whose `guidelines` can't be applied, such as one to a multi-agent model or one that sets `stop`, fails with `400`. `temperature` above 1 is sampled at 1, and `top_p` above the model's default, 0.95 for Grok models, is sampled at that default. The documented `top_p` default is now 0.95, and a response's `temperature` and `top_p` are the values the request sent, or the model's defaults when it omitted them. Uploads to Azure Blob SAS URLs in image `output.upload_urls` and video `output.upload_url` also send `x-ms-blob-type: BlockBlob`, and video uploads send `Content-Type: video/mp4`.
- The spec now allows up to 20 handles in `allowed_x_handles` and `excluded_x_handles` for the `x_search` tool, up from 10, and the `xSearch()` doc comment gives the limit.

## [0.2.4] - 2026-10-16

### Added

- `aspect_ratio` for `videos.generate()` accepts `"21:9"` and `"5:2"`.
- `KnownRealtimeModelId` includes `"grok-voice-3.0"` and `"grok-voice-2.0"`. `"grok-voice-latest"` now points to `grok-voice-3.0`.
- `guidelines` on `responses.create()`: per-category instructions for model output. Each entry is `{ type: "policy", category, behavior }`, where `category` is `"sexual"`, `"violence"`, `"self_harm"`, `"illicit"`, or `"profanity"` and `behavior` is `"decline"` (any category) or `"offer_support"` (`self_harm` only).

### Changed

- Regenerated types from the current API spec. The spec now describes `search_parameters`, `web_search_options`, and the `live_search` tool as deprecated: live search has been removed and these requests fail (`410 Gone` on Responses). Use the `web_search` and `x_search` tools instead. The tool limit in the `tools` description is now 1000.

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
