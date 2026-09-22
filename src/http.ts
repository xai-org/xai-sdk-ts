import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  DEFAULT_MAX_RESPONSE_BODY_BYTES,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  IDEMPOTENT_RETRY_STATUS,
  RETRYABLE_STATUS,
  SDK_USER_AGENT,
} from "./constants.js";
import { apiKeyFor } from "./credentials.js";
import { debugEnabled, isNode, sdkLanguage } from "./env.js";
import { SDK_VERSION } from "./version.js";
import {
  APIConnectionError,
  APIError,
  APIProtocolError,
  AbortError,
  TimeoutError,
  errorFromAbort,
  errorFromResponse,
  errorFromUnknown,
  requestIdFromHeaders,
} from "./errors.js";
import type { HttpMeta, RequestOpts } from "./types.js";
import type { xAI } from "./client.js";

export function joinURL(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

const REDACT_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
]);

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "REDACTED";
      u.password = "REDACTED";
    }
    for (const key of u.searchParams.keys()) {
      if (/key|token|secret|password|auth/i.test(key)) u.searchParams.set(key, "[REDACTED]");
    }
    return u.toString();
  } catch {
    return url;
  }
}

function redactHeader(key: string, value: string): string {
  const normalized = key.toLowerCase();
  const sensitive =
    REDACT_HEADERS.has(normalized) ||
    /(?:auth|token|secret|api[-_]?key|cookie|credential|session)/i.test(normalized);
  if (!sensitive) return value;
  if (normalized === "authorization" && /^bearer\s+/i.test(value)) return "Bearer [REDACTED]";
  return "[REDACTED]";
}

export function formatCurl(method: string, url: string, headers: Headers, body?: string | FormData): string {
  const lines = [`curl -sS -X ${method} '${escapeSingle(redactUrl(url))}'`];
  headers.forEach((value, key) => {
    lines.push(`  -H '${escapeSingle(`${key}: ${redactHeader(key, value)}`)}'`);
  });
  const command = lines.join(" \\\n");
  return body === undefined ? command : `${command}\n# Request body omitted because it may contain sensitive data.`;
}

function escapeSingle(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

export function combineSignals(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  return mergeSignals(signals).signal;
}

function mergeSignals(signals: (AbortSignal | undefined)[]): { signal?: AbortSignal; cleanup: () => void } {
  const list = signals.filter((s): s is AbortSignal => Boolean(s));
  if (list.length === 0) return { cleanup: () => {} };
  if (list.length === 1) return { signal: list[0], cleanup: () => {} };
  if (typeof AbortSignal.any === "function") return { signal: AbortSignal.any(list), cleanup: () => {} };
  const controller = new AbortController();
  const onAbort = () => {
    const first = list.find((s) => s.aborted);
    controller.abort(first?.reason);
  };
  for (const s of list) {
    if (s.aborted) {
      onAbort();
      return { signal: controller.signal, cleanup: () => {} };
    }
    s.addEventListener("abort", onAbort);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const s of list) s.removeEventListener("abort", onAbort);
    },
  };
}

export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000);
  }
  const base = 250 * 2 ** attempt;
  const capped = Math.min(base, 8_000);
  return capped * (0.5 + Math.random() * 0.5);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(errorFromAbort(signal, null));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal ? errorFromAbort(signal, null) : new AbortError("Request aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function buildHeaders(client: xAI, opts: RequestOpts | undefined, accept: string, jsonBody: boolean): Headers {
  const headers = new Headers(client.defaultHeaders);
  if (opts?.headers) {
    new Headers(opts.headers).forEach((v, k) => headers.set(k, v));
  }
  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${apiKeyFor(client)}`);
  if (jsonBody && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!headers.has("accept")) headers.set("accept", accept);
  if (isNode() && !headers.has("user-agent")) headers.set("user-agent", SDK_USER_AGENT);
  headers.set("xai-sdk-version", `typescript/${SDK_VERSION}`);
  headers.set("xai-sdk-language", sdkLanguage());
  return headers;
}

export type InternalRequest = {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  stream?: boolean;
  binary?: boolean;
  opts?: RequestOpts;
};

export function withQuery(url: string, query?: Record<string, string | number | undefined>): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function timeoutSignal(ms: number | undefined): { signal?: AbortSignal; cleanup: () => void } {
  if (ms === undefined || ms <= 0) return { cleanup: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError("Request timed out")), ms);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

function isReadOnlyMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

export function shouldRetryStatus(method: string, status: number): boolean {
  if (RETRYABLE_STATUS.has(status)) return true;
  return isReadOnlyMethod(method) && IDEMPOTENT_RETRY_STATUS.has(status);
}

function isRedirectFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /redirect/i.test(message);
}

class HookError extends Error {
  constructor(hook: "onRequest" | "onResponse", cause: unknown) {
    super(`${hook} hook failed`, { cause });
  }
}

async function waitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  requestId: string | null,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw errorFromAbort(signal, requestId);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(errorFromAbort(signal, requestId));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function callHook<T extends Request | Response>(
  name: "onRequest" | "onResponse",
  hook: (value: T) => void | Promise<void>,
  value: T,
  signal: AbortSignal | undefined,
  requestId: string | null,
): Promise<void> {
  try {
    await waitWithSignal(Promise.resolve().then(() => hook(value)), signal, requestId);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new HookError(name, error);
  }
}

async function callResponseHook(
  hook: (response: Response) => void | Promise<void>,
  response: Response,
  signal: AbortSignal | undefined,
  requestId: string | null,
): Promise<void> {
  try {
    await callHook("onResponse", hook, response, signal, requestId);
  } finally {
    if (response.body) {
      void response.body.cancel().catch(() => {
        // The hook already consumed or cancelled its clone.
      });
    }
  }
}

export type SendResult = {
  response: Response;
  http: HttpMeta;
  payload: unknown;
  body: ReadableStream<Uint8Array> | null;
  sawByte: boolean;
};

export async function send(client: xAI, req: InternalRequest): Promise<SendResult> {
  const timeout = req.opts?.timeout ?? client.timeout;
  const maxRetries = req.opts?.maxRetries ?? client.maxRetries;
  const idleTimeout = req.opts?.idleTimeout ?? client.idleTimeout;
  const maxResponseBodyBytes =
    req.opts?.maxResponseBodyBytes ?? client.maxResponseBodyBytes;
  const hasBody = req.body !== undefined && req.method !== "GET" && req.method !== "HEAD";
  const body = !hasBody ? undefined : req.body instanceof FormData ? req.body : JSON.stringify(req.body);
  const url = withQuery(joinURL(client.baseURL, req.path), req.query);
  const stream = Boolean(req.stream);
  const binary = Boolean(req.binary);
  const accept = stream ? "text/event-stream" : binary ? "*/*" : "application/json";

  let attempt = 0;
  let lastRequestId: string | null = null;

  while (true) {
    const headers = buildHeaders(client, req.opts, accept, typeof body === "string");
    const t = timeoutSignal(timeout);
    const merged = mergeSignals([req.opts?.signal, t.signal]);
    const signal = merged.signal;
    const cleanupAttempt = () => {
      t.cleanup();
      merged.cleanup();
    };
    if (signal?.aborted) {
      cleanupAttempt();
      throw errorFromAbort(signal, lastRequestId);
    }

    const request = new Request(url, {
      method: req.method,
      headers,
      body,
      signal,
      redirect: "error",
    });
    if (debugEnabled()) {
      console.error(formatCurl(req.method, url, headers, body));
    }

    let receivedResponse = false;
    try {
      if (client.onRequest) {
        await callHook("onRequest", client.onRequest, request.clone(), signal, lastRequestId);
      }
      const response = await client.fetch(request);
      receivedResponse = true;
      lastRequestId = requestIdFromHeaders(response.headers);
      const responseForHook = client.onResponse ? response.clone() : undefined;

      if (!response.ok) {
        const text = await readBodyWithIdle(
          response,
          idleTimeout,
          signal,
          lastRequestId,
          Math.min(maxResponseBodyBytes, DEFAULT_MAX_ERROR_BODY_BYTES),
        );
        const err = await errorFromResponse(response, parsePayload(text));
        if (client.onResponse && responseForHook) {
          try {
            await callResponseHook(client.onResponse, responseForHook, signal, lastRequestId);
          } catch {
            // The HTTP status is authoritative; hooks must not mask it.
          }
        }
        cleanupAttempt();
        if (signal?.aborted) throw err;
        if (shouldRetryStatus(req.method, response.status) && attempt < maxRetries) {
          attempt += 1;
          await sleep(retryDelayMs(attempt - 1, response.headers.get("retry-after")), req.opts?.signal);
          continue;
        }
        throw err;
      }

      if (client.onResponse && responseForHook) {
        await callResponseHook(client.onResponse, responseForHook, signal, lastRequestId);
      }
      const http: HttpMeta = {
        status: response.status,
        headers: response.headers,
        requestId: lastRequestId,
      };

      if (stream || binary) {
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (stream && contentType !== "text/event-stream") {
          await response.body?.cancel().catch(() => {});
          cleanupAttempt();
          throw new APIProtocolError("Streaming response must use text/event-stream", {
            requestId: lastRequestId,
          });
        }
        if (!response.body) {
          cleanupAttempt();
          if (binary) return { response, http, payload: undefined, body: null, sawByte: false };
          throw new APIConnectionError("SSE response had no body", { requestId: lastRequestId });
        }
        const peeked = await peekFirstChunk(
          response,
          idleTimeout,
          signal,
          lastRequestId,
          cleanupAttempt,
        );
        if (peeked.error) cleanupAttempt();
        if (peeked.error && !peeked.sawByte) throw peeked.error;
        return { response, http, payload: undefined, body: peeked.stream, sawByte: peeked.sawByte };
      }

      const text = await readBodyWithIdle(
        response,
        idleTimeout,
        signal,
        lastRequestId,
        maxResponseBodyBytes,
      );
      cleanupAttempt();
      const payload = parsePayload(text);
      if (req.opts?.http?.body) http.body = payload;
      return { response, http, payload, body: null, sawByte: true };
    } catch (err) {
      cleanupAttempt();
      if (APIError.is(err) && err.status !== undefined) throw err;
      if (signal?.aborted) throw errorFromAbort(signal, lastRequestId);
      if (err instanceof HookError) throw errorFromUnknown(err.cause, lastRequestId);
      if (receivedResponse || isRedirectFailure(err)) {
        if (APIError.is(err)) throw err;
        throw errorFromUnknown(err, lastRequestId);
      }
      if (APIError.is(err) && err.name !== "APIConnectionError") throw err;
      if (isReadOnlyMethod(req.method) && attempt < maxRetries) {
        attempt += 1;
        await sleep(retryDelayMs(attempt - 1, null), req.opts?.signal);
        continue;
      }
      throw errorFromUnknown(err, lastRequestId);
    }
  }
}

type PeekResult = {
  sawByte: boolean;
  stream: ReadableStream<Uint8Array> | null;
  error?: APIError;
};

async function peekFirstChunk(
  response: Response,
  idleTimeout: number,
  signal: AbortSignal | undefined,
  requestId: string | null,
  onFinalize: () => void,
): Promise<PeekResult> {
  const body = response.body;
  if (!body) return { sawByte: false, stream: null, error: new APIConnectionError("SSE response had no body", { requestId }) };

  const reader = body.getReader();
  try {
    const first = await readOnce(reader, idleTimeout, signal, requestId);
    const chunks: Uint8Array[] = [];
    let ended = first.done;
    if (first.value && first.value.byteLength > 0) chunks.push(first.value);
    const sawByte = chunks.length > 0;
    const idleWrapped = makePullStream(
      reader,
      chunks,
      ended,
      idleTimeout,
      signal,
      requestId,
      onFinalize,
    );
    return { sawByte, stream: idleWrapped };
  } catch (err) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    const mapped = errorFromUnknown(err, requestId);
    return { sawByte: false, stream: null, error: mapped };
  }
}

function makePullStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  prefix: Uint8Array[],
  ended: boolean,
  idleTimeout: number,
  signal: AbortSignal | undefined,
  requestId: string | null,
  onFinalize: () => void,
): ReadableStream<Uint8Array> {
  const pending = [...prefix];
  let done = ended;
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    onFinalize();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pending.length > 0) {
        controller.enqueue(pending.shift()!);
        return;
      }
      if (done) {
        controller.close();
        finalize();
        return;
      }
      try {
        const next = await readOnce(reader, idleTimeout, signal, requestId);
        if (next.done) {
          done = true;
          controller.close();
          finalize();
          return;
        }
        controller.enqueue(next.value);
      } catch (err) {
        try {
          await reader.cancel();
        } catch {
          // already cancelled
        }
        finalize();
        controller.error(errorFromUnknown(err, requestId));
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finalize();
      }
    },
  });
}

async function readOnce(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeout: number,
  signal: AbortSignal | undefined,
  requestId: string | null,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(errorFromAbort(signal, requestId));
      return;
    }
    let settled = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (idle !== undefined) clearTimeout(idle);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      void reader.cancel().catch(() => {});
      finish(() => reject(errorFromAbort(signal!, requestId)));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (idleTimeout > 0) {
      idle = setTimeout(() => {
        void reader.cancel().catch(() => {});
        finish(() => reject(new TimeoutError("Idle timeout", { requestId })));
      }, idleTimeout);
    }
    reader.read().then(
      (value) => finish(() => resolve(value)),
      (err) => finish(() => reject(err)),
    );
  });
}

async function readBodyWithIdle(
  response: Response,
  idleTimeout: number,
  signal: AbortSignal | undefined,
  requestId: string | null,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytesRead = 0;
  try {
    while (true) {
      const result = await readOnce(reader, idleTimeout, signal, requestId);
      if (result.done) break;
      bytesRead += result.value.byteLength;
      if (maxBytes > 0 && bytesRead > maxBytes) {
        throw new APIProtocolError(`Response body exceeds ${maxBytes} bytes`, {
          requestId,
        });
      }
      out += decoder.decode(result.value, { stream: true });
    }
    out += decoder.decode();
    return out;
  } catch (err) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function parsePayload(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BODY_BYTES,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
};
