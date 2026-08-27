import type { components } from "./generated/types.js";

type Schema = components["schemas"];

export type OutputItem = Schema["ModelOutput"];
export type IncompleteDetails = Schema["IncompleteDetails"];
export type DeletedResponse = Schema["DeleteStoredCompletionResponse"];
export type InputItemList = Schema["ListInputItemsResponse"];
export type Model = Schema["Model"];
export type ModelList = Schema["ListModelsResponse"];

/** Client-only: inlined to `image_url` before send. */
type ImageBlobPart = {
  type: "input_image";
  image: Blob | File;
  detail?: "auto" | "low" | "high";
};

export type InputItem =
  | Schema["ModelInputPart"]
  | {
      role: string;
      content: string | Array<Schema["ModelInputContentItem"] | ImageBlobPart>;
    };

export type CreateParams = Partial<Omit<Schema["ModelRequest"], "input" | "model" | "stream" | "store">> & {
  model: string;
  input: string | InputItem[];
  stream?: boolean;
  /**
   * Persist the response for later `get` / `previous_response_id`.
   * SDK default is **false**. The API wire default is true (stored for 30 days).
   * When false, the client always sends `reasoning.encrypted_content` in
   * `include` (merged with any list you pass).
   */
  store?: boolean | null;
};

export type RequestHook = (request: Request) => void | Promise<void>;
/** Receives `response.clone()`, which is cancelled after the hook returns. */
export type ResponseHook = (response: Response) => void | Promise<void>;

export type ClientOptions = {
  /**
   * Secret API key. Prefer `XAI_API_KEY` in Node. Do not construct this client
   * in a browser with a real key — put a backend in front.
   */
  apiKey?: string;
  /**
   * Allow construction in a browser or Worker despite the risk of exposing
   * the API key. Defaults to false.
   */
  dangerouslyAllowBrowser?: boolean;
  /** Must accept a `Request` as the first argument. */
  fetch?: typeof fetch;
  baseURL?: string;
  /** Per-attempt timeout in milliseconds. Retry backoff is additional time. */
  timeout?: number;
  /** Maximum time in milliseconds between response-body chunks. */
  idleTimeout?: number;
  /** Maximum buffered JSON response size. Defaults to 32 MiB. */
  maxResponseBodyBytes?: number;
  /** Number of retries. Creates retry only explicit 429 responses. */
  maxRetries?: number;
  defaultHeaders?: Record<string, string>;
  onRequest?: RequestHook;
  onResponse?: ResponseHook;
};

export type RequestHeaders = Headers | Record<string, string> | Array<[string, string]>;

export type RequestOpts = {
  signal?: AbortSignal;
  /** Per-attempt override in milliseconds. */
  timeout?: number;
  /** Per-chunk idle timeout override in milliseconds. */
  idleTimeout?: number;
  /** JSON response-size override in bytes. */
  maxResponseBodyBytes?: number;
  /** Retry-count override. */
  maxRetries?: number;
  headers?: RequestHeaders;
  http?: { body?: boolean };
};

export type HttpMeta = {
  status: number;
  headers: Headers;
  requestId: string | null;
  body?: unknown;
};

type OutputContentPart = Schema["OutputMessageContent"];
type ResponseObject = Schema["ModelResponse"];

/** SSE payloads. The public docs OpenAPI spec does not define these event objects. */
type StreamEvent =
  | { type: "ping" }
  | { type: "error"; code?: string | number | null; message?: string; param?: string | null; sequence_number?: number }
  | { type: "response.created"; response: ResponseObject; sequence_number?: number }
  | { type: "response.in_progress"; response: ResponseObject; sequence_number?: number }
  | { type: "response.completed"; response: ResponseObject; sequence_number?: number }
  | { type: "response.failed"; response: ResponseObject; sequence_number?: number }
  | { type: "response.incomplete"; response: ResponseObject; sequence_number?: number }
  | { type: "response.output_item.added"; item: OutputItem; output_index: number; sequence_number?: number }
  | { type: "response.output_item.done"; item: OutputItem; output_index: number; sequence_number?: number }
  | {
      type: "response.content_part.added";
      item_id?: string;
      output_index: number;
      content_index: number;
      part: OutputContentPart;
      sequence_number?: number;
    }
  | {
      type: "response.content_part.done";
      item_id?: string;
      output_index: number;
      content_index: number;
      part: OutputContentPart;
      sequence_number?: number;
    }
  | {
      type: "response.output_text.delta";
      item_id?: string;
      output_index?: number;
      content_index?: number;
      delta: string;
      sequence_number?: number;
    }
  | {
      type: "response.output_text.done";
      item_id?: string;
      output_index?: number;
      content_index?: number;
      text: string;
      sequence_number?: number;
    }
  | {
      type: "response.reasoning_text.delta";
      item_id?: string;
      output_index?: number;
      delta: string;
      sequence_number?: number;
    }
  | {
      type: "response.reasoning_text.done";
      item_id?: string;
      output_index?: number;
      text?: string;
      sequence_number?: number;
    }
  | {
      type: "response.reasoning_summary_text.delta";
      item_id?: string;
      output_index?: number;
      delta: string;
      sequence_number?: number;
    }
  | {
      type: "response.reasoning_summary_text.done";
      item_id?: string;
      output_index?: number;
      text?: string;
      sequence_number?: number;
    }
  | {
      type: "response.function_call_arguments.delta";
      item_id?: string;
      output_index?: number;
      delta: string;
      sequence_number?: number;
    }
  | {
      type: "response.function_call_arguments.done";
      item_id?: string;
      output_index?: number;
      name?: string;
      arguments: string;
      sequence_number?: number;
    };

export type xAIStreamEvent =
  | Exclude<StreamEvent, { type: "error" }>
  | (Extract<StreamEvent, { type: "error" }> & { error?: import("./errors.js").APIError })
  | { type: "unknown"; raw: unknown };
