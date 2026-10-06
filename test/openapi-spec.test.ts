import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { KEEP_PATHS, pathProblems } from "../scripts/openapi-paths.mjs";
import type { paths } from "../src/generated/types.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const specText = readFileSync(new URL("../spec/openapi.json", import.meta.url), "utf8");
const specPaths = Object.keys((JSON.parse(specText) as { paths: Record<string, unknown> }).paths);

describe("OpenAPI spec snapshot", () => {
  it("keeps or ignores every path in spec/openapi.json", () => {
    expect(pathProblems(specPaths)).toEqual([]);
  });

  it("flags a new endpoint that KEEP_PATHS would otherwise drop", () => {
    const keep = new Set([...KEEP_PATHS].filter((path) => path !== "/v1/images/{request_id}"));
    expect(pathProblems(specPaths, keep)).toEqual([
      "/v1/images/{request_id} is new: add it to KEEP_PATHS to generate its types, or to IGNORED_PATHS if the SDK won't wrap it",
    ]);
    expectTypeOf<paths>().toHaveProperty("/v1/images/{request_id}");
  });

  it("flags paths in both lists and listed paths the spec no longer has", () => {
    const keep = new Set(["/v1/kept", "/v1/both", "/v1/removed"]);
    const ignored = new Set(["/v1/ignored", "/v1/both", "/v1/retired"]);
    expect(pathProblems(["/v1/kept", "/v1/ignored", "/v1/both"], keep, ignored)).toEqual([
      "/v1/both is in both KEEP_PATHS and IGNORED_PATHS",
      "KEEP_PATHS has /v1/removed, which the spec no longer has",
      "IGNORED_PATHS has /v1/retired, which the spec no longer has",
    ]);
  });

  it("records the snapshot's SHA-256 in src/generated/types.ts", () => {
    const sha = createHash("sha256").update(specText).digest("hex");
    const generated = readFileSync(new URL("../src/generated/types.ts", import.meta.url), "utf8");
    expect(generated).toContain(`\n * Source SHA-256: ${sha}\n`);
  });

  it("regenerates src/generated/types.ts from the snapshot without changes", () => {
    const result = spawnSync(process.execPath, ["scripts/generate-types.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  }, 30_000);
});
