#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(fileURLToPath(new URL("..", import.meta.url)));
const TEMP = await mkdtemp(path.join(os.tmpdir(), "xai-sdk-package-"));
const PACKAGE = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result.stdout ?? "";
}

function runNode(args, options) {
  return run(process.execPath, args, options);
}

function runNpm(args, options = {}) {
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, options);
}

try {
  const packed = JSON.parse(
    runNpm(["pack", "--json", "--pack-destination", TEMP], { capture: true }),
  );
  assert(Array.isArray(packed) && packed.length === 1, "npm pack returned an unexpected report");

  const report = packed[0];
  const paths = report.files.map((file) => file.path);
  for (const file of paths) {
    assert(
      file === "package.json" ||
        file === "README.md" ||
        file === "LICENSE" ||
        file === "NOTICE" ||
        file.startsWith("dist/"),
      `unexpected file in tarball: ${file}`,
    );
    assert(!file.endsWith(".map"), `source map should not ship: ${file}`);
  }
  assert(paths.includes("dist/index.js"), "tarball is missing dist/index.js");
  assert(paths.includes("dist/index.d.ts"), "tarball is missing dist/index.d.ts");

  await writeFile(
    path.join(TEMP, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await writeFile(path.join(TEMP, "esm.mjs"), `
    import { SDK_USER_AGENT, SDK_VERSION, xAI } from "@xai-official/sdk";
    if (SDK_VERSION !== ${JSON.stringify(PACKAGE.version)}) throw new Error("bad ESM version");
    if (SDK_USER_AGENT !== \`xai-sdk/\${SDK_VERSION} (typescript)\`) throw new Error("bad ESM user agent");
    if (typeof xAI !== "function") throw new Error("missing ESM client");
    if (typeof new xAI({ apiKey: "test" }).images.generate !== "function") throw new Error("missing ESM images");
  `);
  await writeFile(path.join(TEMP, "cjs.cjs"), `
    const { SDK_USER_AGENT, SDK_VERSION, xAI } = require("@xai-official/sdk");
    if (SDK_VERSION !== ${JSON.stringify(PACKAGE.version)}) throw new Error("bad CJS version");
    if (SDK_USER_AGENT !== \`xai-sdk/\${SDK_VERSION} (typescript)\`) throw new Error("bad CJS user agent");
    if (typeof xAI !== "function") throw new Error("missing CJS client");
    if (typeof new xAI({ apiKey: "test" }).images.generate !== "function") throw new Error("missing CJS images");
  `);
  await writeFile(path.join(TEMP, "consumer.ts"), `
    import {
      xAI,
      isImageGenerationCall,
      type CreateParams,
      type DeletedResponse,
      type ImageEditParams,
      type ImageGenerateParams,
      type ImageResponse,
      type KnownImageModelId,
      type ImageGenerationCall,
      type KnownModelId,
      type ModelId,
      type OutputItem,
      type Tool,
    } from "@xai-official/sdk";
    const model = "grok-4.6" satisfies KnownModelId;
    const futureModel = "grok-released-after-this-sdk" satisfies ModelId;
    const deleted = null as DeletedResponse | null;
    const functionTool = {
      type: "function",
      name: "example",
      parameters: { type: "object" },
    } satisfies Tool;
    const webSearchTool = { type: "web_search" } satisfies Tool;
    const params = {
      model,
      input: "test",
      tools: [{ type: "web_search" }],
    } satisfies CreateParams;
    const client: xAI = new xAI({ apiKey: "test", fetch: globalThis.fetch });
    const imageModel = "grok-imagine-image-2.0" satisfies KnownImageModelId;
    const generate = {
      model: imageModel,
      prompt: "test",
      response_format: "b64_json",
    } satisfies ImageGenerateParams;
    const edit = {
      model: imageModel,
      prompt: "test",
      images: [new Blob(["png"], { type: "image/png" }), { file_id: "file_1" }],
    } satisfies ImageEditParams;
    const imageResponse = null as ImageResponse | null;
    const imageTool = { type: "image_generation" } satisfies Tool;
    const imageCalls: ImageGenerationCall[] = ([] as OutputItem[]).filter(isImageGenerationCall);
    void client.voice.speak({ text: "Hi [pause] there.", language: "en" });
    // @ts-expect-error Unknown speech tags are type errors in string literals.
    void client.voice.speak({ text: "Hi [luff] there.", language: "en" });
    void [model, futureModel, deleted, functionTool, webSearchTool, params, client];
    void [imageModel, generate, edit, imageResponse, imageTool, imageCalls];
  `);
  await writeFile(
    path.join(TEMP, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        lib: ["ES2022", "DOM", "DOM.Iterable"],
      },
      include: ["consumer.ts"],
    }),
  );
  await writeFile(
    path.join(TEMP, "tsconfig.node.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2024",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        lib: ["ES2024"],
        types: ["node"],
        typeRoots: [path.join(ROOT, "node_modules", "@types")],
      },
      include: ["consumer.ts"],
    }),
  );

  const tarball = path.join(TEMP, report.filename);
  runNpm(
    [
      "install",
      "--ignore-scripts",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    { cwd: TEMP },
  );
  runNode(["esm.mjs"], { cwd: TEMP });
  runNode(["cjs.cjs"], { cwd: TEMP });
  runNode(
    [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"],
    { cwd: TEMP },
  );
  runNode(
    [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.node.json"],
    { cwd: TEMP },
  );

  const installed = JSON.parse(
    await readFile(path.join(TEMP, "node_modules", "@xai-official", "sdk", "package.json"), "utf8"),
  );
  assert.equal(installed.version, report.version);
  console.log(`Package smoke passed: ${report.filename} (${paths.length} files)`);
} finally {
  await rm(TEMP, { recursive: true, force: true });
}
