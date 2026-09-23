# Changelog

All notable changes to the xAI TypeScript SDK will be documented in this file.

## [Unreleased]

### Added

- Open-source contribution, security, ownership, CI, and release safeguards.

### Changed

- Debug request logging now omits request bodies to avoid exposing prompts, tool output, or credentials.
- Client instances no longer expose the configured API key through a public getter.
