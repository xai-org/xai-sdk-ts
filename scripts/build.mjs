#!/usr/bin/env node

import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(fileURLToPath(new URL("..", import.meta.url)));
const TSC = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await rm(path.join(ROOT, "dist"), { recursive: true, force: true });
run([path.join(ROOT, "scripts", "generate-version.mjs"), "--check"]);
run([TSC, "-p", "tsconfig.build.json"]);
