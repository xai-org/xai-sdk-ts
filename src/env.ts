type NodeProcess = {
  versions?: { node?: string; bun?: string };
  env?: Record<string, string | undefined>;
};

function nodeProcess(): NodeProcess | undefined {
  const proc = (globalThis as { process?: NodeProcess }).process;
  return proc;
}

export function isNode(): boolean {
  return Boolean(nodeProcess()?.versions?.node);
}

export function isBrowser(): boolean {
  const scope = globalThis as {
    window?: { document?: unknown };
    WorkerGlobalScope?: unknown;
  };
  return Boolean(scope.window?.document) || typeof scope.WorkerGlobalScope === "function";
}

export function assertNodeVersion(): void {
  const versions = nodeProcess()?.versions;
  if (versions?.bun) return;
  const raw = versions?.node;
  if (!raw) return;
  const [majorRaw, minorRaw] = raw.split(".");
  const major = Number.parseInt(majorRaw ?? "0", 10);
  const minor = Number.parseInt(minorRaw ?? "0", 10);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`@xai-official/sdk requires Node.js 22.13 or later (found ${raw})`);
  }
}

export function readEnvApiKey(): string | undefined {
  const key = nodeProcess()?.env?.XAI_API_KEY;
  return key && key.length > 0 ? key : undefined;
}

export function debugEnabled(): boolean {
  return nodeProcess()?.env?.XAI_DEBUG === "1";
}

/** Runtime label for `xai-sdk-language` (`python/3.12` in the Python SDK). */
export function sdkLanguage(): string {
  const versions = nodeProcess()?.versions;
  const bun =
    versions?.bun ??
    (globalThis as { Bun?: { version?: string } }).Bun?.version;
  if (bun) return `bun/${majorMinor(bun)}`;
  const deno = (globalThis as { Deno?: { version?: { deno?: string } } }).Deno?.version?.deno;
  if (deno) return `deno/${majorMinor(deno)}`;
  const raw = versions?.node;
  if (!raw) return "javascript";
  return `node/${majorMinor(raw)}`;
}

function majorMinor(version: string): string {
  const [major, minor] = version.split(".");
  return `${major ?? "0"}.${minor ?? "0"}`;
}
