#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(fileURLToPath(new URL("..", import.meta.url)));
const OUT = path.join(ROOT, "artifacts");

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["pack", "--json", "--pack-destination", OUT], {
  cwd: ROOT,
  encoding: "utf8",
});
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

const report = JSON.parse(result.stdout);
if (!Array.isArray(report) || report.length !== 1) {
  throw new Error("npm pack returned an unexpected report");
}
const filename = report[0].filename;
const bytes = await readFile(path.join(OUT, filename));
const digest = createHash("sha256").update(bytes).digest("hex");
await writeFile(path.join(OUT, `${filename}.sha256`), `${digest}  ${filename}\n`);

console.log(`${filename} sha256=${digest}`);
