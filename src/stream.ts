import { isKnownStreamEventType, isServerToolCallType } from "./constants.js";
import {
  AbortError,
  APIProtocolError,
  TimeoutError,
  errorFromUnknown,
  streamErrorEvent,
  withClientRequestId,
  type APIError,
} from "./errors.js";
import { parseSse } from "./sse.js";
import { isFunctionCall, isImageGenerationCall, isMessage } from "./porcelain.js";
import { xAIResponse } from "./response.js";
import type {
  FunctionToolCall,
  HttpMeta,
  ImageGenerationCall,
  OutputMessage,
  ServerToolCall,
  UrlCitation,
  xAIStreamEvent,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  tool_call: (call: FunctionToolCall) => void;
  server_tool_call: (call: ServerToolCall) => void;
  image: (image: ImageGenerationCall) => void;
  citation: (citation: UrlCitation) => void;
};

type StreamListeners = HelperListeners & {
  [T in xAIStreamEvent["type"]]: (event: Extract<xAIStreamEvent, { type: T }>) => void;
};

const HELPER_EVENTS: Record<keyof HelperListeners, true> = {
  text: true,
  reasoning: true,
  tool_call: true,
  server_tool_call: true,
  image: true,
  citation: true,
};

export class xAIStream implements AsyncIterable<xAIStreamEvent> {
  readonly http: HttpMeta;

  #body: ReadableStream<Uint8Array> | null;
  #closed = false;
  #consumed = false;
  #closeController = new AbortController();
  #requestId: string | null;
  #signal: AbortSignal | undefined;
  #listeners = new Map<string, Array<(value: never) => void>>();
  #final: Record<string, unknown> | undefined;
  #error: APIError | undefined;
  #ended = Promise.withResolvers<void>();
  #done: Promise<xAIResponse> | undefined;

  constructor(init: {
    body: ReadableStream<Uint8Array> | null;
    http: HttpMeta;
    signal?: AbortSignal;
  }) {
    this.http = init.http;
    this.#body = init.body;
    this.#requestId = init.http.requestId;
    this.#signal = init.signal;
    // Keeps an iteration error from becoming an unhandled rejection when done() is never called.
    this.#ended.promise.catch(() => {});
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
  done(): Promise<xAIResponse> {
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

  async *[Symbol.asyncIterator](): AsyncGenerator<xAIStreamEvent> {
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

  #emitHelpers(event: xAIStreamEvent): void {
    switch (event.type) {
      case "response.output_text.delta":
        this.#emit("text", event.delta);
        break;
      case "response.reasoning_text.delta":
      case "response.reasoning_summary_text.delta":
        this.#emit("reasoning", event.delta);
        break;
      case "response.output_item.added":
        if (isServerToolCall(event.item)) this.#emit("server_tool_call", event.item);
        break;
      case "response.output_item.done":
        if (isFunctionCall(event.item)) this.#emit("tool_call", event.item);
        if (isServerToolCall(event.item)) this.#emit("server_tool_call", event.item);
        if (isImageGenerationCall(event.item)) this.#emit("image", event.item);
        if (isMessage(event.item)) {
          for (const citation of urlCitations(event.item)) this.#emit("citation", citation);
        }
        break;
      default:
        break;
    }
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

  #finalResponse(): xAIResponse {
    if (this.#error) throw this.#error;
    if (!this.#final) {
      throw new AbortError("Stream closed before the response completed", {
        requestId: this.#requestId,
        clientRequestId: this.http.clientRequestId,
      });
    }
    return new xAIResponse(this.#final, this.http);
  }

  async *#events(): AsyncGenerator<xAIStreamEvent> {
    if (!this.#body) return;
    try {
      for await (const raw of parseSse(this.#body, {
        closeSignal: this.#closeController.signal,
      })) {
        const event = this.#normalize(raw);
        this.#apply(event);
        yield event;
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
        const event: xAIStreamEvent = {
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

  #normalize(raw: unknown): xAIStreamEvent {
    if (!isRecord(raw)) return { type: "unknown", raw };
    const type = raw.type;
    if (type === "error") {
      const { event, error } = streamErrorEvent(raw, this.#requestId);
      withClientRequestId(error, this.http.clientRequestId);
      return event as xAIStreamEvent;
    }
    if (typeof type === "string" && isKnownStreamEventType(type)) {
      return raw as xAIStreamEvent;
    }
    return { type: "unknown", raw };
  }

  #apply(event: xAIStreamEvent): void {
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
