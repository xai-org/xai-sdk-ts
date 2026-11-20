#!/usr/bin/env node

/**
 * Repacks a built npm tarball under another package name with tar.
 *
 * Usage: node scripts/rename-artifact.mjs <tarball> <out-dir> [name]
 *
 * The name defaults to MIRROR_PACKAGE_NAME, which the Release workflow
 * publishes after the main package.
 * Only the "name" field in package.json changes. Every other file in the
 * tarball is checked byte for byte against the original, so both names ship
 * the same build. Writes <out-dir>/<file>.tgz and <file>.tgz.sha256.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Second npm name for every release. The build is the same as the main package. */
export const MIRROR_PACKAGE_NAME = "@grok/sdk";

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result.stdout ?? "";
}

async function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

async function extract(tarball, dir) {
  await mkdir(dir, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", dir], dir);
  return path.join(dir, "package");
}

export async function renameTarball(tarball, name, outDir) {
  assert(/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name), `not a scoped package name: ${name}`);
  const source = path.resolve(tarball);
  const out = path.resolve(outDir);
  const temp = await mkdtemp(path.join(os.tmpdir(), "xai-sdk-rename-"));
  try {
    const original = await extract(source, path.join(temp, "original"));
    const work = await extract(source, path.join(temp, "work"));

    const manifestPath = path.join(work, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const previous = manifest.name;
    assert.notEqual(previous, name, `tarball is already named ${name}`);
    manifest.name = name;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    // tar instead of npm pack: npm 10 runs the "prepare" script when packing a
    // directory, even with --ignore-scripts, and the tarball has no scripts/.
    await mkdir(out, { recursive: true });
    const filename = `${name.slice(1).replace("/", "-")}-${manifest.version}.tgz`;
    const renamed = path.join(out, filename);
    await rm(renamed, { force: true });
    const tarEnv = { ...process.env, COPYFILE_DISABLE: "1" };
    run("tar", ["-czf", renamed, "-C", path.dirname(work), "package"], temp, tarEnv);

    const repacked = await extract(renamed, path.join(temp, "repacked"));
    const before = await listFiles(original);
    const after = await listFiles(repacked);
    assert.deepEqual(after, before, "renamed tarball has a different file list");
    for (const file of before) {
      const a = await readFile(path.join(original, file));
      const b = await readFile(path.join(repacked, file));
      if (file === "package.json") {
        const left = JSON.parse(a.toString("utf8"));
        const right = JSON.parse(b.toString("utf8"));
        assert.equal(right.name, name);
        assert.deepEqual({ ...right, name: previous }, left, "package.json changed beyond its name");
      } else {
        assert(a.equals(b), `renamed tarball changed ${file}`);
      }
    }

    const digest = createHash("sha256").update(await readFile(renamed)).digest("hex");
    await writeFile(path.join(out, `${filename}.sha256`), `${digest}  ${filename}\n`);
    return { filename, path: renamed, sha256: digest, files: before.length, from: previous };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tarball, outDir, name = MIRROR_PACKAGE_NAME] = process.argv.slice(2);
  if (!tarball || !outDir) {
    console.error("Usage: node scripts/rename-artifact.mjs <tarball> <out-dir> [name]");
    process.exit(2);
  }
  const result = await renameTarball(tarball, name, outDir);
  console.log(`${result.filename} sha256=${result.sha256} (${result.from} -> ${name}, ${result.files} files)`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `package_name=${name}\n`);
}
