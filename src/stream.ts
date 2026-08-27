import { isKnownStreamEventType, MAX_STREAM_INDEX } from "./constants.js";
import {
  APIError,
  APIProtocolError,
  TimeoutError,
  errorFromUnknown,
  streamErrorEvent,
} from "./errors.js";
import { parseSse } from "./sse.js";
import { parseJsonOutput, toInput, toText } from "./porcelain.js";
import { emptyUsage, mapUsage, type Usage } from "./usage.js";
import type { HttpMeta, IncompleteDetails, InputItem, OutputItem, xAIStreamEvent } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

  constructor(init: {
    body: ReadableStream<Uint8Array> | null;
    http: HttpMeta;
    signal?: AbortSignal;
  }) {
    this.http = init.http;
    this.#body = init.body;
    this.#requestId = init.http.requestId;
    this.#signal = init.signal;
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
          request_id: this.#requestId,
        });
      }
      if (this.status === "completed") this.usage = mapUsage(this.usage);
    } catch (err) {
      const mapped = this.#signal?.aborted
        ? errorFromUnknown(this.#signal.reason ?? err, this.#requestId)
        : errorFromUnknown(err, this.#requestId);
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
      const { event } = streamErrorEvent(raw, this.#requestId);
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
          request_id: this.#requestId,
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
        request_id: this.#requestId,
        body: response,
      });
    }
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
