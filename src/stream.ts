import {
  RETRYABLE_STATUS,
  SERVER_ERROR_RETRY_STATUS,
  isKnownStreamEventType,
  isServerToolCallType,
} from "./constants.js";
import { retryDelayMs, sleep, type RetryBudget } from "./http.js";
import {
  AbortError,
  APIConnectionError,
  APIProtocolError,
  TimeoutError,
  errorFromUnknown,
  streamErrorEvent,
  withClientRequestId,
  type APIError,
} from "./errors.js";
import { parsePartialJson } from "./partial-json.js";
import { parseSse } from "./sse.js";
import { isImageGenerationCall, isMessage } from "./porcelain.js";
import { ModelResponse } from "./response.js";
import type {
  ClientToolCall,
  HttpMeta,
  ImageGenerationCall,
  OutputMessage,
  ServerToolCall,
  ToolCall,
  UrlCitation,
  ResponseStreamEvent,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isClientToolCall(item: unknown): item is ClientToolCall {
  return isRecord(item) && (item.type === "function_call" || item.type === "shell_call");
}

function isServerToolCall(item: unknown): item is ServerToolCall {
  return isRecord(item) && isServerToolCallType(item.type);
}

function urlCitations(message: OutputMessage): Array<UrlCitation> {
  const citations: Array<UrlCitation> = [];
  if (!Array.isArray(message.content)) return citations;
  for (const part of message.content) {
    if (!isRecord(part) || part.type !== "output_text" || !Array.isArray(part.annotations)) continue;
    for (const annotation of part.annotations) {
      if (isRecord(annotation) && annotation.type === "url_citation" && typeof annotation.url === "string") {
        citations.push(annotation as UrlCitation);
      }
    }
  }
  return citations;
}

type HelperListeners = {
  text: (text: string) => void;
  reasoning: (text: string) => void;
  tool_call: (call: ToolCall) => void;
  client_tool_call: (call: ClientToolCall) => void;
  server_tool_call: (call: ServerToolCall) => void;
  image: (image: ImageGenerationCall) => void;
  citation: (citation: UrlCitation) => void;
  json: (value: unknown) => void;
};

type StreamListeners = HelperListeners & {
  [T in ResponseStreamEvent["type"]]: (event: Extract<ResponseStreamEvent, { type: T }>) => void;
};

const HELPER_EVENTS: Record<keyof HelperListeners, true> = {
  text: true,
  reasoning: true,
  tool_call: true,
  client_tool_call: true,
  server_tool_call: true,
  image: true,
  citation: true,
  json: true,
};

/** Sends the request again when a stream fails before any output, for `retryBeforeOutput`. */
export type StreamRetry = {
  /** `body` is null when a request that accepts JSON gets the final response as JSON, in `payload`. */
  resend: () => Promise<{ body: ReadableStream<Uint8Array> | null; http: HttpMeta; payload: unknown }>;
  /** Shared with the HTTP retries of every request in the call. */
  budget: RetryBudget;
};

/** Events the API sends before any output. Retrying an attempt that only sent these is invisible to the caller. */
function isLifecycleEvent(event: ResponseStreamEvent): boolean {
  return event.type === "ping" || event.type === "response.created" || event.type === "response.in_progress";
}

function isRetryableBeforeOutput(error: APIError): boolean {
  if (error instanceof APIConnectionError) return true;
  return error.status !== undefined && (RETRYABLE_STATUS.has(error.status) || SERVER_ERROR_RETRY_STATUS.has(error.status));
}

export class ResponseStream implements AsyncIterable<ResponseStreamEvent> {
  #http: HttpMeta;
  #body: ReadableStream<Uint8Array> | null;
  #closed = false;
  #consumed = false;
  #closeController = new AbortController();
  #requestId: string | null;
  #signal: AbortSignal | undefined;
  #retry: StreamRetry | undefined;
  #maxEventChars: number | undefined;
  #jsonText: string | undefined;
  #listeners = new Map<string, Array<(value: never) => void>>();
  #final: Record<string, unknown> | undefined;
  #error: APIError | undefined;
  #ended = Promise.withResolvers<void>();
  #done: Promise<ModelResponse> | undefined;

  constructor(init: {
    body: ReadableStream<Uint8Array> | null;
    http: HttpMeta;
    signal?: AbortSignal;
    /** The request asked for JSON output, so text deltas also feed the `"json"` helper event. */
    json?: boolean;
    retry?: StreamRetry;
    /** Longest server-sent event in characters. The terminal event carries the whole response. */
    maxEventChars?: number;
  }) {
    this.#http = init.http;
    this.#body = init.body;
    this.#requestId = init.http.requestId;
    this.#signal = init.signal;
    this.#retry = init.retry;
    this.#maxEventChars = init.maxEventChars;
    this.#jsonText = init.json ? "" : undefined;
    // Keeps an iteration error from becoming an unhandled rejection when done() is never called.
    this.#ended.promise.catch(() => {});
  }

  /** HTTP metadata of the request whose stream is being read, which changes if `retryBeforeOutput` sends it again. */
  get http(): HttpMeta {
    return this.#http;
  }

  /**
   * Calls `listener` for each event of the given type, or for a helper event such as `"text"` or `"tool_call"`,
   * whether a loop or `done()` reads the stream.
   */
  on<K extends keyof StreamListeners>(event: K, listener: StreamListeners[K]): this {
    if (!Object.hasOwn(HELPER_EVENTS, event) && event !== "unknown" && !isKnownStreamEventType(event)) {
      throw new TypeError(`Unsupported stream event: ${String(event)}`);
    }
    const listeners = this.#listeners.get(event) ?? [];
    listeners.push(listener);
    this.#listeners.set(event, listeners);
    return this;
  }

  /**
   * Reads the rest of the stream, unless a loop is already reading it, and resolves to the final response.
   * Rejects if the stream fails or closes before the response completes.
   */
  done(): Promise<ModelResponse> {
    if (!this.#done) {
      if (!this.#consumed) void this.#drain();
      this.#done = this.#ended.promise.then(() => this.#finalResponse());
    }
    return this.#done;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeController.abort();
    const body = this.#body;
    this.#body = null;
    if (body) {
      try {
        await body.cancel();
      } catch {
        // already cancelled
      }
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<ResponseStreamEvent> {
    if (this.#consumed) throw new Error("Stream already iterated");
    this.#consumed = true;
    try {
      for await (const event of this.#events()) {
        this.#emit(event.type, event);
        this.#emitHelpers(event);
        yield event;
      }
    } catch (err) {
      this.#ended.reject(err);
      throw err;
    } finally {
      this.#ended.resolve();
    }
  }

  #emit(name: keyof StreamListeners, value: unknown): void {
    for (const listener of this.#listeners.get(name) ?? []) listener(value as never);
  }

  #emitToolCall(item: unknown): void {
    if (isClientToolCall(item)) {
      this.#emit("tool_call", item);
      this.#emit("client_tool_call", item);
    } else if (isServerToolCall(item)) {
      this.#emit("tool_call", item);
      this.#emit("server_tool_call", item);
    }
  }

  #emitHelpers(event: ResponseStreamEvent): void {
    switch (event.type) {
      case "response.output_text.delta":
        this.#emit("text", event.delta);
        this.#emitJson(event.delta);
        break;
      case "response.reasoning_text.delta":
      case "response.reasoning_summary_text.delta":
        this.#emit("reasoning", event.delta);
        break;
      case "response.output_item.done":
        this.#emitToolCall(event.item);
        if (isImageGenerationCall(event.item)) this.#emit("image", event.item);
        if (isMessage(event.item)) {
          for (const citation of urlCitations(event.item)) this.#emit("citation", citation);
        }
        break;
      default:
        break;
    }
  }

  #emitJson(delta: string): void {
    if (this.#jsonText === undefined) return;
    this.#jsonText += delta;
    if (!this.#listeners.has("json")) return;
    const value = parsePartialJson(this.#jsonText);
    if (value !== undefined) this.#emit("json", value);
  }

  async #drain(): Promise<void> {
    try {
      for await (const _ of this) {
        // listeners run inside the iterator
      }
    } catch {
      // done() reports the error
    }
  }

  #finalResponse(): ModelResponse {
    if (this.#error) throw this.#error;
    if (!this.#final) {
      throw new AbortError("Stream closed before the response completed", {
        requestId: this.#requestId,
        clientRequestId: this.http.clientRequestId,
      });
    }
    return new ModelResponse(this.#final, this.http);
  }

  async *#events(): AsyncGenerator<ResponseStreamEvent> {
    if (!this.#body) return;
    try {
      while (this.#body) {
        const retry = this.#retry?.budget.canRetry ? this.#retry : undefined;
        const failure = yield* this.#attempt(this.#body, retry !== undefined);
        if (!failure || !retry) break;
        await sleep(retryDelayMs(retry.budget.spend(), null, failure.status), this.#signal);
        if (this.#closed) break;
        const next = await retry.resend();
        this.#body = next.body;
        this.#http = next.http;
        this.#requestId = next.http.requestId;
        if (!next.body) this.#final = this.#terminalResponse(next.payload);
      }
      if (!this.#closed && !this.#final && !this.#error) {
        throw new APIProtocolError("Stream ended without a terminal response event", {
          requestId: this.#requestId,
        });
      }
    } catch (err) {
      const mapped = withClientRequestId(
        this.#signal?.aborted
          ? errorFromUnknown(this.#signal.reason ?? err, this.#requestId)
          : errorFromUnknown(err, this.#requestId),
        this.http.clientRequestId,
      );
      if (mapped instanceof TimeoutError) {
        const event: ResponseStreamEvent = {
          type: "error",
          message: mapped.message,
          error: mapped,
        };
        yield event;
      }
      throw mapped;
    } finally {
      await this.close();
    }
  }

  /**
   * Yields the events of one response body. With `canRetry`, events before the first output are held back,
   * and a retryable failure before any output is returned instead of thrown, so the retry doesn't show.
   */
  async *#attempt(
    body: ReadableStream<Uint8Array>,
    canRetry: boolean,
  ): AsyncGenerator<ResponseStreamEvent, APIError | undefined> {
    const held: Array<ResponseStreamEvent> = [];
    let holding = canRetry;
    try {
      const sse = parseSse(body, {
        closeSignal: this.#closeController.signal,
        maxEventChars: this.#maxEventChars,
      });
      for await (const raw of sse) {
        const event = this.#normalize(raw);
        if (holding) {
          if (isLifecycleEvent(event)) {
            held.push(event);
            continue;
          }
          if (event.type === "error" && event.error && isRetryableBeforeOutput(event.error)) return event.error;
          holding = false;
          for (const early of held) {
            this.#apply(early);
            yield early;
          }
        }
        this.#apply(event);
        yield event;
      }
    } catch (err) {
      const error = errorFromUnknown(err, this.#requestId);
      if (holding && !this.#closed && !this.#signal?.aborted && isRetryableBeforeOutput(error)) return error;
      throw err;
    }
    if (holding && !this.#closed) {
      return new APIConnectionError("Stream ended before any output", { requestId: this.#requestId });
    }
    return undefined;
  }

  #normalize(raw: unknown): ResponseStreamEvent {
    if (!isRecord(raw)) return { type: "unknown", raw };
    const type = raw.type;
    if (type === "error") {
      const { event, error } = streamErrorEvent(raw, this.#requestId);
      withClientRequestId(error, this.http.clientRequestId);
      return event as ResponseStreamEvent;
    }
    if (typeof type === "string" && isKnownStreamEventType(type)) {
      return raw as ResponseStreamEvent;
    }
    return { type: "unknown", raw };
  }

  #apply(event: ResponseStreamEvent): void {
    switch (event.type) {
      case "response.completed":
      case "response.failed":
      case "response.incomplete":
        this.#final = this.#terminalResponse((event as { response?: unknown }).response);
        break;
      case "error":
        this.#error = event.error ?? this.#error;
        break;
      default:
        break;
    }
  }

  #terminalResponse(response: unknown): Record<string, unknown> {
    if (!isRecord(response)) {
      throw new APIProtocolError("Terminal stream event is missing a response object", {
        requestId: this.#requestId,
        body: response,
      });
    }
    if (
      typeof response.id !== "string" ||
      response.id.length === 0 ||
      typeof response.status !== "string" ||
      !Array.isArray(response.output)
    ) {
      throw new APIProtocolError("Terminal stream response is missing id, status, or output", {
        requestId: this.#requestId,
        body: response,
      });
    }
    return response;
  }
}
