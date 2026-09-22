import type { components, operations } from "./generated/types.js";
import type { ImageModelId, ModelId, VideoModelId } from "./models.js";
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

export type CompactParams = Omit<Schema["CompactRequest"], "input" | "model"> & {
  model: ModelId;
  input: string | InputItem[];
};
export type CompactResponse = Schema["CompactResponse"];

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

type VideoKeyframe = Omit<Schema["VideoKeyframe"], "image"> & { image: ImageInput };

export type VideoGenerateParams = Omit<
  Schema["GenerateVideoRequest"],
  "model" | "image" | "reference_images" | "keyframes"
> & {
  model: VideoModelId;
  image?: ImageInput | null;
  reference_images?: ImageInput[];
  keyframes?: VideoKeyframe[];
};

export type VideoEditParams = Omit<Schema["EditVideoRequest"], "model"> & {
  model: VideoModelId;
};

export type VideoExtendParams = Omit<Schema["ExtendVideoRequest"], "model"> & {
  model: VideoModelId;
};

export type VideoStartResponse = Schema["StartDeferredResponse"];
export type GeneratedVideo = Schema["GeneratedVideo"];
/** `status` is `pending`, `done`, `failed`, or `expired`. */
export type VideoResponse = Omit<Schema["VideoResponse"], "usage"> & {
  usage: MediaUsage | null;
  http: HttpMeta;
};

export type VideoWaitOptions = {
  /** Milliseconds between polls. Defaults to 5000. */
  interval?: number;
  /** Maximum total wait in milliseconds. Defaults to 600000 (10 minutes). */
  timeout?: number;
  signal?: AbortSignal;
};

export type VideoGenerationModel = Schema["VideoGenerationModel"];
export type VideoGenerationModelList = Schema["ListVideoGenerationModelsResponse"];

/**
 * The API records the multipart filename as the file's `filename`. It defaults to the
 * `File` name; FormData would send a plain `Blob` as `blob`.
 */
export type FileUploadParams = Omit<Schema["UploadFileMultipartRequest"], "file"> &
  ({ file: File; filename?: string } | { file: Blob; filename: string });
export type FileListParams = Omit<
  NonNullable<operations["handle_list_files_request"]["parameters"]["query"]>,
  "order" | "sort_by"
> & {
  /** Defaults to `desc`. */
  order?: "asc" | "desc";
  /** SDK default is `created_at`. Without it, the API returns files in no guaranteed order. */
  sort_by?: "created_at" | "filename" | "size";
};
export type FileContentParams = NonNullable<
  operations["handle_download_file_content_request"]["parameters"]["query"]
>;
export type FilePublicUrlParams = Schema["CreatePublicUrlRequest"];
export type FileObject = Schema["File"];
export type FileObjectList = Schema["ListFilesResponse"];
export type DeletedFile = Schema["DeleteFileResponse"];
export type FilePublicUrl = Schema["CreatePublicUrlResponse"];
export type FilePublicUrlRevocation = Schema["RevokePublicUrlResponse"];

export type BatchCreateParams = {
  name: string;
  /** An uploaded JSONL file of requests. File-based batches don't accept more requests. */
  input_file_id?: string;
};

export type Batch = {
  batch_id: string;
  name: string;
  create_time: string;
  expire_time?: string | null;
  create_api_key_id: string;
  cancel_time?: string | null;
  cancel_by_xai_message?: string | null;
  state: {
    num_requests: number;
    num_pending: number;
    num_success: number;
    num_error: number;
    num_cancelled: number;
  };
};

export type BatchList = {
  batches: Batch[];
  pagination_token?: string | null;
};

export type BatchWaitOptions = {
  /** Milliseconds between polls. Defaults to 5000. */
  interval?: number;
  /** Maximum total wait in milliseconds. Defaults to 86400000 (24 hours). */
  timeout?: number;
  signal?: AbortSignal;
};

export type BatchRequest = {
  /** Must be unique within the batch; generated when omitted. Results arrive in any order. */
  batch_request_id?: string | null;
  batch_request:
    | { responses: CreateParams }
    | { chat_get_completion: Schema["ChatRequest"] }
    | { image_generation: Schema["GenerateImageRequest"] }
    | { image_edit: Schema["EditImageRequest"] }
    | { video_generation: Schema["GenerateVideoRequest"] | Schema["EditVideoRequest"] }
    | { video_extension: Schema["ExtendVideoRequest"] };
};

export type BatchRequestMetadata = {
  batch_request_id: string;
  endpoint: string;
  model: string;
  state: "unknown" | "pending" | "succeeded" | "cancelled" | "failed";
  create_time: string;
  finish_time?: string | null;
};

export type BatchRequestMetadataList = {
  batch_request_metadata: BatchRequestMetadata[];
  pagination_token?: string | null;
};

export type BatchResult = {
  batch_request_id: string;
  batch_result:
    | { error: string }
    | {
        response:
          | "unknown"
          | { chat_get_completion: Schema["ChatResponse"] }
          | { image_generation: Schema["GeneratedImageResponse"] }
          | { video_generation: Schema["VideoResponse"] };
      };
};

export type BatchResultList = {
  results: BatchResult[];
  pagination_token?: string | null;
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
