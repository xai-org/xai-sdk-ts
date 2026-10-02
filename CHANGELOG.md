# Changelog

All notable changes to the SpaceXAI TypeScript SDK will be documented in this file.

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
