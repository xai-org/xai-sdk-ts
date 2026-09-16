# Changelog

All notable changes to the xAI TypeScript SDK will be documented in this file.

## [Unreleased]

### Added

- Open-source contribution, security, ownership, CI, and release safeguards.
- Every request sends an `x-client-request-id` header, available as `http.clientRequestId` on responses and `clientRequestId` on errors.

### Changed

- Debug request logging now omits request bodies to avoid exposing prompts, tool output, or credentials.
- Client instances no longer expose the configured API key through a public getter.
- The default user agent is now `xai-sdk/<version> (typescript)`.
