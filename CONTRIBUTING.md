# Contributing to the SpaceXAI TypeScript SDK

We aren't accepting outside contributions yet. While the SDK is new, we're collecting feedback through [GitHub issues](https://github.com/xai-org/xai-sdk-ts/issues), so please open an issue for bugs and feature requests instead of a pull request. We plan to accept outside contributions later.

The rest of this guide describes how maintainers develop and test the SDK.

## Before you start

- Use an issue to discuss substantial changes before investing in an implementation.
- Never include credentials, customer data, confidential information, internal URLs, proprietary model details, or code you are not authorized to contribute.
- Disclose third-party code and its license in the pull request.
- Report vulnerabilities privately according to [SECURITY.md](./SECURITY.md).

Version changes and releases are managed by SpaceXAI maintainers.

## Development setup

The repository requires Node.js 22.13 or later and pnpm 11.24.0.

```bash
git clone https://github.com/xai-org/xai-sdk-ts.git
cd xai-sdk-ts
pnpm install --frozen-lockfile
```

Create a branch from `main` and make focused changes with tests and documentation.

## Generated files

`src/generated/types.ts`, `src/generated/voice.ts`, `src/models.ts`, and `src/version.ts` are generated. Do not edit them directly.

- Run `pnpm generate:types` to refresh OpenAPI types from the public SpaceXAI schema. It saves the schema to `spec/openapi.json`, and `pnpm test` checks that the types match it.
- When the schema gains a path, `pnpm generate:types` fails until you add the path to `KEEP_PATHS` in `scripts/openapi-paths.mjs` to generate its types, or to `IGNORED_PATHS` if the SDK won't wrap it.
- Run `pnpm generate:models` to refresh known public model IDs.
- Run `pnpm generate:voice` to refresh the speech tags, built-in voice IDs, and voice model IDs from the Voice docs.
- The build verifies that `src/version.ts` matches `package.json`.

Generated changes must be reviewed like handwritten changes. Include the upstream source and resulting hash in the pull request.

## Required checks

Run the same release checks used by CI:

```bash
pnpm release:check
```

This runs tests and coverage, type checking, linting, build and package validation, a clean-package smoke test, and the dependency vulnerability audit.

The required Secret Scan workflow fetches the full repository history and runs [Gitleaks](https://github.com/gitleaks/gitleaks). To reproduce it locally:

```bash
gitleaks git . --config .gitleaks.toml --redact
gitleaks dir . --config .gitleaks.toml --redact
```

GitHub also runs Semgrep and Socket security checks. All required checks must pass before merge.

## Pull requests

1. Open a pull request against `main`.
2. Explain the problem, approach, test coverage, generated changes, and any dependency or public API impact.
3. Confirm that the change contains only publicly releasable material.
4. Address review feedback and keep all required checks passing.

Maintainers merge changes only after the required review approvals.
