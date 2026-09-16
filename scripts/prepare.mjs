import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, "..");

if (!existsSync(join(repo, "node_modules", "typescript", "bin", "tsc"))) {
  console.error("@xai-official/sdk: dist/ is missing and typescript is not installed; run pnpm build");
  process.exit(1);
}

const result = spawnSync(process.execPath, [join(root, "build.mjs")], {
  cwd: repo,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
