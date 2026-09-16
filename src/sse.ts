const SSE_DONE = "[DONE]";
export const MAX_SSE_EVENT_CHARS = 1_048_576;

type ParseSseOptions = {
  onBytes?: () => void;
  closeSignal?: AbortSignal;
};

/**
 * Incremental SSE parser. Yields parsed JSON objects (or `{ type: "ping" }`).
 * `data: [DONE]` ends the stream.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  opts: ParseSseOptions = {},
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const chunk = await readChunk(reader, opts.closeSignal);
      if (!chunk) return;
      const { done, value } = chunk;
      if (value && value.byteLength > 0) opts.onBytes?.();
      if (done) {
        const flushed = flushBlocks(buf + decoder.decode());
        if (flushed.rest.length > MAX_SSE_EVENT_CHARS) {
          throw new Error(`SSE event exceeds ${MAX_SSE_EVENT_CHARS} characters`);
        }
        for (const item of flushed.items) {
          if (item === SSE_DONE) return;
          yield item;
        }
        if (flushed.rest.trim().length > 0) {
          const tail = parseBlock(flushed.rest);
          if (tail === SSE_DONE) return;
          if (tail !== undefined) yield tail;
        }
        return;
      }
      buf += decoder.decode(value, { stream: true });
      const { items, rest } = flushBlocks(buf);
      buf = rest;
      if (buf.length > MAX_SSE_EVENT_CHARS) {
        throw new Error(`SSE event exceeds ${MAX_SSE_EVENT_CHARS} characters`);
      }
      for (const item of items) {
        if (item === SSE_DONE) return;
        yield item;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // already cancelled
    }
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array> | undefined> {
  if (!signal) return reader.read();
  if (signal.aborted) {
    await reader.cancel().catch(() => {});
    return undefined;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      void reader.cancel().then(
        () => finish(() => resolve(undefined)),
        () => finish(() => resolve(undefined)),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function flushBlocks(buf: string): { items: Array<unknown>; rest: string } {
  const parts = buf.split(/(?:\r\n|\r|\n)(?:\r\n|\r|\n)/);
  const rest = parts.pop() ?? "";
  const items: Array<unknown> = [];
  for (const block of parts) {
    if (block.length > MAX_SSE_EVENT_CHARS) {
      throw new Error(`SSE event exceeds ${MAX_SSE_EVENT_CHARS} characters`);
    }
    const parsed = parseBlock(block);
    if (parsed !== undefined) items.push(parsed);
  }
  return { items, rest };
}

function parseBlock(block: string): unknown | undefined {
  let eventName: string | undefined;
  const dataLines: Array<string> = [];
  for (const rawLine of block.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
      continue;
    }
  }
  if (dataLines.length === 0) {
    if (eventName === "ping") return { type: "ping" };
    return undefined;
  }
  const data = dataLines.join("\n");
  if (data === SSE_DONE) return SSE_DONE;
  try {
    const parsed: unknown = JSON.parse(data);
    if (eventName && isRecord(parsed) && parsed.type == null) {
      return { ...parsed, type: eventName };
    }
    return parsed;
  } catch {
    if (eventName === "ping") return { type: "ping" };
    return { type: "unknown", raw: data };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
