# Changelog

All notable changes to the xAI TypeScript SDK will be documented in this file.

## [Unreleased]

### Added

- Open-source contribution, security, ownership, CI, and release safeguards.
- Image and video generation model ID types: `ImageModelId`, `KnownImageModelId`, `VideoModelId`, and `KnownVideoModelId`.
- Image generation and editing with `client.images.generate()` and `client.images.edit()`, including multi-image edits and `Blob` or `File` source images.
- Image generation model lookup with `client.images.models.list()` and `client.images.models.get()`.
- `isImageGenerationCall` and typed `response.image_generation_call.*` stream events for the Responses API image generation tool.

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
