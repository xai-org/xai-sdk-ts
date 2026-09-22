import type { components } from "./generated/types.js";
import type { ImageModelId, ModelId } from "./models.js";
import type { MediaUsage } from "./usage.js";

type Schema = components["schemas"];
type GeneratedTool = Schema["ModelTool"];
type GeneratedFunctionTool = Extract<GeneratedTool, { type: "function" }>;
type ImageDetail = "auto" | "low" | "high";

export type OutputItem = Schema["ModelOutput"];
export type OutputMessage = Omit<Schema["OutputMessage"], "role" | "type"> & {
  role: "assistant" | "tool";
  type: "message";
};
export type FunctionToolCall = Omit<Schema["FunctionToolCall"], "type"> & {
  type: "function_call";
};
export type ReasoningItem = Omit<Schema["Reasoning"], "type"> & {
  type: "reasoning";
};
export type ImageGenerationCall = Schema["ImageGenerationCall"];
export type IncompleteDetails = Schema["IncompleteDetails"];
export type DeletedResponse = Schema["DeleteStoredCompletionResponse"];
export type InputItemList = Schema["ListInputItemsResponse"];
export type Model = Schema["Model"];
export type ModelList = Schema["ListModelsResponse"];
export type Tool =
  | Exclude<GeneratedTool, GeneratedFunctionTool>
  | (Omit<GeneratedFunctionTool, "parameters"> & {
      parameters: Record<string, unknown>;
    });

/** Client-only: inlined to `image_url` before send. */
type ImageBlobPart = {
  type: "input_image";
  image: Blob | File;
  detail?: ImageDetail;
};

/** The API also accepts image detail for URL and data-URL inputs. */
type ImageUrlPart = {
  type: "input_image";
  image_url: string;
  file_id?: string | null;
  detail?: ImageDetail;
};

export type InputItem =
  | Schema["ModelInputPart"]
  | {
      role: string;
      content: string | Array<Schema["ModelInputContentItem"] | ImageBlobPart | ImageUrlPart>;
    };

export type CreateParams = Omit<
  Schema["ModelRequest"],
  "input" | "model" | "store" | "stream" | "tools"
> & {
  model: ModelId;
  input: string | InputItem[];
  stream?: boolean;
  tools?: Tool[] | null;
  /**
   * Persist the response for later `get` / `previous_response_id`.
   * SDK default is **false**. The API wire default is true (stored for 30 days).
   * When false, the client always sends `reasoning.encrypted_content` in
   * `include` (merged with any list you pass).
   */
  store?: boolean | null;
};

/** Blob and File values are client-only: inlined to a `url` data URL before send. */
export type ImageInput = Schema["ImageUrl"] | Blob | File;

type ImageRequestFields = {
  model: ImageModelId;
  prompt: string;
  response_format?: "url" | "b64_json" | null;
  /** Defaults to `auto`. Only supported by `grok-imagine-image-2.0`. */
  quality?: "low" | "medium" | "auto" | null;
};

export type ImageGenerateParams = Omit<
  Schema["GenerateImageRequest"],
  keyof ImageRequestFields
> &
  ImageRequestFields;

export type ImageEditParams = Omit<
  Schema["EditImageRequest"],
  keyof ImageRequestFields | "image" | "images"
> &
  ImageRequestFields &
  (
    | { image: ImageInput; images?: never }
    | {
        /** Refer to them as `<IMAGE_0>`, `<IMAGE_1>`, and so on in the prompt. */
        images: ImageInput[];
        image?: never;
      }
  );

export type GeneratedImage = Schema["GeneratedImage"];
export type ImageResponse = Omit<Schema["GeneratedImageResponse"], "usage"> & {
  usage: MediaUsage | null;
  http: HttpMeta;
};
export type ImageGenerationModel = Schema["ImageGenerationModel"];
export type ImageGenerationModelList = Schema["ListImageGenerationModelsResponse"];

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
    }
  | {
      type: "response.image_generation_call.in_progress";
      item_id?: string;
      output_index?: number;
      sequence_number?: number;
    }
  | {
      type: "response.image_generation_call.generating";
      item_id?: string;
      output_index?: number;
      sequence_number?: number;
    }
  | {
      type: "response.image_generation_call.completed";
      item_id?: string;
      output_index?: number;
      sequence_number?: number;
    };

export type xAIStreamEvent =
  | Exclude<StreamEvent, { type: "error" }>
  | (Extract<StreamEvent, { type: "error" }> & { error?: import("./errors.js").APIError })
  | { type: "unknown"; raw: unknown };
