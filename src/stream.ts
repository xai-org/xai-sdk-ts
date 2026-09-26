import { isKnownStreamEventType, isServerToolCallType, MAX_STREAM_INDEX } from "./constants.js";
import {
  AbortError,
  APIError,
  APIProtocolError,
  TimeoutError,
  errorFromUnknown,
  streamErrorEvent,
  withClientRequestId,
} from "./errors.js";
import { parseSse } from "./sse.js";
import {
  isFunctionCall,
  isImageGenerationCall,
  isMessage,
  parseJsonOutput,
  toInput,
  toText,
} from "./porcelain.js";
import { xAIResponse } from "./response.js";
import { emptyUsage, mapUsage, type Usage } from "./usage.js";
import type {
  FunctionToolCall,
  HttpMeta,
  ImageGenerationCall,
  IncompleteDetails,
  InputItem,
  OutputItem,
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

function urlCitations(message: OutputMessage): UrlCitation[] {
  const citations: UrlCitation[] = [];
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
  id = "";
  status: string = "in_progress";
  output: OutputItem[] = [];
  incomplete_details: IncompleteDetails | null = null;
  usage: Usage = emptyUsage();
  http: HttpMeta;
  error: unknown = null;
  model?: string;

  #body: ReadableStream<Uint8Array> | null;
  #closed = false;
  #consumed = false;
  #closeController = new AbortController();
  #requestId: string | null;
  #signal: AbortSignal | undefined;
  #listeners = new Map<string, ((value: never) => void)[]>();
  #final: Record<string, unknown> | undefined;
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

  get parsed(): unknown | null {
    return parseJsonOutput(this.output, this.status, false);
  }

  toText(): string {
    return toText(this.output);
  }

  toInput(): InputItem[] {
    return toInput(this.output);
  }

  toJson(): unknown {
    return parseJsonOutput(this.output, this.status, true);
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
    if (APIError.is(this.error)) throw this.error;
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
      if (
        !this.#closed &&
        this.status !== "completed" &&
        this.status !== "failed" &&
        this.status !== "incomplete"
      ) {
        throw new APIProtocolError("Stream ended without a terminal response event", {
          requestId: this.#requestId,
        });
      }
      if (this.status === "completed") this.usage = mapUsage(this.usage);
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
        this.error = mapped;
        this.status = "failed";
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
      this.error = (event as { error?: APIError }).error ?? this.error;
      return event as xAIStreamEvent;
    }
    if (typeof type === "string" && isKnownStreamEventType(type)) {
      return raw as xAIStreamEvent;
    }
    return { type: "unknown", raw };
  }

  #apply(event: xAIStreamEvent): void {
    switch (event.type) {
      case "response.created":
      case "response.in_progress":
        this.#assignResponse((event as { response?: unknown }).response, false);
        break;
      case "response.completed":
      case "response.failed":
      case "response.incomplete":
        this.#assignResponse((event as { response?: unknown }).response, true);
        break;
      case "response.output_item.added":
      case "response.output_item.done": {
        const e = event as { output_index: number; item: OutputItem };
        this.#setItem(e.output_index, e.item);
        break;
      }
      case "response.content_part.added":
      case "response.content_part.done": {
        const e = event as { output_index: number; content_index: number; part: unknown };
        this.#setPart(e.output_index, e.content_index, e.part);
        break;
      }
      case "response.output_text.delta": {
        const e = event as { output_index?: number; content_index?: number; delta: string };
        this.#appendText(e.output_index ?? 0, e.content_index ?? 0, e.delta);
        break;
      }
      case "response.output_text.done": {
        const e = event as { output_index?: number; content_index?: number; text: string };
        this.#setText(e.output_index ?? 0, e.content_index ?? 0, e.text);
        break;
      }
      case "response.function_call_arguments.delta": {
        const e = event as { output_index?: number; delta: string };
        this.#appendArgs(e.output_index ?? 0, e.delta);
        break;
      }
      case "response.function_call_arguments.done": {
        const e = event as { output_index?: number; arguments: string };
        this.#setArgs(e.output_index ?? 0, e.arguments);
        break;
      }
      case "error": {
        const err = (event as { error?: APIError }).error;
        this.error = err ?? event;
        this.status = "failed";
        break;
      }
      default:
        break;
    }
  }

  #assignResponse(response: unknown, terminal: boolean): void {
    if (!isRecord(response)) {
      if (terminal) {
        throw new APIProtocolError("Terminal stream event is missing a response object", {
          requestId: this.#requestId,
          body: response,
        });
      }
      return;
    }
    if (
      terminal &&
      (typeof response.id !== "string" ||
        response.id.length === 0 ||
        typeof response.status !== "string" ||
        !Array.isArray(response.output))
    ) {
      throw new APIProtocolError("Terminal stream response is missing id, status, or output", {
        requestId: this.#requestId,
        body: response,
      });
    }
    if (terminal) this.#final = response;
    if (typeof response.id === "string") this.id = response.id;
    if (typeof response.status === "string") this.status = response.status;
    if (typeof response.model === "string") this.model = response.model;
    if (Array.isArray(response.output)) this.output = response.output as OutputItem[];
    if ("incomplete_details" in response) {
      this.incomplete_details = (response.incomplete_details as IncompleteDetails | null) ?? null;
    }
    if (response.error !== undefined) this.error = response.error;
    if (response.usage !== undefined || response.status === "completed") {
      this.usage = mapUsage(response.usage);
    }
  }

  #assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index > MAX_STREAM_INDEX) {
      throw new RangeError(`Invalid stream index ${String(index)}`);
    }
  }

  #padMessage(upTo: number): void {
    this.#assertIndex(upTo);
    while (this.output.length <= upTo) {
      this.output.push({ type: "message", role: "assistant", content: [] } as OutputItem);
    }
  }

  #ensureItem(index: number): Record<string, unknown> {
    this.#padMessage(index);
    const item = this.output[index];
    if (!isRecord(item)) {
      const next = { type: "message", role: "assistant", content: [] };
      this.output[index] = next as OutputItem;
      return next;
    }
    return item;
  }

  #setItem(index: number, item: OutputItem): void {
    this.#assertIndex(index);
    while (this.output.length < index) {
      this.output.push({ type: "message", role: "assistant", content: [] } as OutputItem);
    }
    this.output[index] = item;
  }

  #setPart(index: number, contentIndex: number, part: unknown): void {
    this.#assertIndex(contentIndex);
    const item = this.#ensureItem(index);
    const content = Array.isArray(item.content) ? [...item.content] : [];
    while (content.length < contentIndex) content.push({ type: "output_text", text: "" });
    content[contentIndex] = part;
    item.content = content;
  }

  #appendText(index: number, contentIndex: number, delta: string): void {
    this.#assertIndex(contentIndex);
    const item = this.#ensureItem(index);
    if (item.type !== "message") {
      item.type = "message";
      item.role = item.role ?? "assistant";
    }
    const content = Array.isArray(item.content) ? [...item.content] : [];
    while (content.length <= contentIndex) content.push({ type: "output_text", text: "" });
    const part = content[contentIndex];
    if (isRecord(part) && part.type === "output_text") {
      content[contentIndex] = {
        ...part,
        text: `${typeof part.text === "string" ? part.text : ""}${delta}`,
      };
    } else {
      content[contentIndex] = { type: "output_text", text: delta };
    }
    item.content = content;
  }

  #setText(index: number, contentIndex: number, text: string): void {
    this.#assertIndex(contentIndex);
    const item = this.#ensureItem(index);
    const content = Array.isArray(item.content) ? [...item.content] : [];
    while (content.length <= contentIndex) content.push({ type: "output_text", text: "" });
    content[contentIndex] = { type: "output_text", text };
    item.content = content;
  }

  #functionCallAt(index: number): Record<string, unknown> {
    this.#assertIndex(index);
    while (this.output.length <= index) {
      this.output.push({ type: "function_call", arguments: "" } as OutputItem);
    }
    const item = this.output[index];
    const rec = isRecord(item) ? (item as Record<string, unknown>) : null;
    if (rec && rec.type === "function_call") return rec;
    const next: Record<string, unknown> = { type: "function_call", arguments: "" };
    if (typeof rec?.id === "string") next.id = rec.id;
    if (typeof rec?.name === "string") next.name = rec.name;
    this.output[index] = next as OutputItem;
    return next;
  }

  #appendArgs(index: number, delta: string): void {
    const item = this.#functionCallAt(index);
    item.arguments = `${typeof item.arguments === "string" ? item.arguments : ""}${delta}`;
  }

  #setArgs(index: number, args: string): void {
    const item = this.#functionCallAt(index);
    item.arguments = args;
  }
}
