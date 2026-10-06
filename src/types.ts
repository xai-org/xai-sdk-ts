import type { ServerToolCallType } from "./constants.js";
import type { components, operations } from "./generated/types.js";
import type { RealtimeModelId, TranscriptionModelId, VoiceId } from "./generated/voice.js";
import type { ImageModelId, ModelId, VideoModelId } from "./models.js";
import type { SpeechText } from "./speech-tags.js";
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
export type ShellCall = Omit<Schema["ShellCall"], "type"> & {
  type: "shell_call";
};
export type ReasoningItem = Omit<Schema["Reasoning"], "type"> & {
  type: "reasoning";
};
export type ImageGenerationCall = Schema["ImageGenerationCall"];
type ServerCall<S, T extends ServerToolCallType> = Omit<S, "type"> & { type: T };
/**
 * A tool call that SpaceXAI runs itself, such as web search, X search, code execution, or image generation.
 * Check `type` before reading fields of a specific tool. X search calls arrive as `custom_tool_call`, with
 * `name` set to the search that ran and its arguments as a JSON string in `input`.
 */
export type ServerToolCall =
  | ServerCall<Schema["WebSearchCall"], "web_search_call">
  | ServerCall<Schema["FunctionToolCall"], "x_search_call">
  | ServerCall<Schema["CustomToolCall"], "custom_tool_call">
  | ServerCall<Schema["FileSearchCall"], "file_search_call">
  | ServerCall<Schema["CodeInterpreterCall"], "code_interpreter_call">
  | ServerCall<Schema["McpCall"], "mcp_call">
  | ServerCall<Schema["ToolSearchCall"], "tool_search_call">
  | ServerCall<Schema["ImageGenerationCall"], "image_generation_call">;
/** A tool call that your code runs: one of your function tools, or a shell command. */
export type ClientToolCall = FunctionToolCall | ShellCall;
/** Any tool call, whether your code or SpaceXAI runs it. Check `type` to tell them apart. */
export type ToolCall = ClientToolCall | ServerToolCall;
export type UrlCitation = Omit<Schema["Annotation"], "type"> & { type: "url_citation" };
export type IncompleteDetails = Schema["IncompleteDetails"];
export type DeletedResponse = Schema["DeleteStoredCompletionResponse"];
export type InputItemList = Schema["ListInputItemsResponse"];
export type Model = Schema["Model"];
export type ModelList = Schema["ListModelsResponse"];
export type LanguageModel = Schema["LanguageModel"];
export type LanguageModelList = Schema["ListLanguageModelsResponse"];
export type ApiKeyInfo = Schema["ApiKey"];
/** Autocompletes the tools this SDK knows and accepts any other `type`, such as a tool released after it. */
export type Tool =
  | Exclude<GeneratedTool, GeneratedFunctionTool>
  | (Omit<GeneratedFunctionTool, "parameters"> & {
      parameters: Record<string, unknown>;
    })
  | { type: string & {}; [key: string]: unknown };

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
  input: string | Array<InputItem>;
  tools?: Array<Tool> | null;
  /**
   * Persist the response for later `get` / `previous_response_id`.
   * SDK default is **false**. The API wire default is true (stored for 30 days).
   * When false, the client always sends `reasoning.encrypted_content` in
   * `include` (merged with any list you pass).
   */
  store?: boolean | null;
};

/** A [Standard Schema](https://standardschema.dev) validator, such as a Zod, Valibot, or ArkType schema. */
export type StandardSchema<Output = unknown> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: { readonly input: unknown; readonly output: Output } | undefined;
  };
};

export type StandardSchemaIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
};

type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaIssue> };

export type CompactParams = Omit<Schema["CompactRequest"], "input" | "model"> & {
  model: ModelId;
  input: string | Array<InputItem>;
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
  /**
   * Upload each image with HTTP PUT to the matching signed URL in `upload_urls`, one per image, instead of
   * storing it with SpaceXAI. Each image's `url` is then its upload URL. Requires `response_format: "url"`.
   * Zero Data Retention teams must set this to use `deferred`.
   */
  output?: Schema["ImageOutput"] | null;
};

/** `deferred` changes what `images.generate()` and `images.edit()` resolve to, so it has its own params types. */
type OmittedImageFields = keyof ImageRequestFields | "deferred";

export type ImageGenerateParams = Omit<Schema["GenerateImageRequest"], OmittedImageFields> &
  ImageRequestFields;

export type ImageEditParams = Omit<
  Schema["EditImageRequest"],
  OmittedImageFields | "image" | "images"
> &
  ImageRequestFields &
  (
    | { image: ImageInput; images?: never }
    | {
        /** Refer to them as `<IMAGE_0>`, `<IMAGE_1>`, and so on in the prompt. */
        images: Array<ImageInput>;
        image?: never;
      }
  );

type DeferredField = {
  /**
   * Return a `request_id` right away and generate in the background. Poll for the result with
   * `images.wait()` or `images.get()`. Deferred requests support only `response_format: "url"`.
   */
  deferred: true;
};

/** `images.generate()` params that resolve to a `request_id` instead of the images. */
export type DeferredImageGenerateParams = ImageGenerateParams & DeferredField;
/** `images.edit()` params that resolve to a `request_id` instead of the images. */
export type DeferredImageEditParams = ImageEditParams & DeferredField;

export type GeneratedImage = Schema["GeneratedImage"];
export type ImageResponse = Omit<Schema["GeneratedImageResponse"], "usage"> & {
  usage: MediaUsage | null;
  http: HttpMeta;
};

export type ImageStartResponse = Schema["StartDeferredResponse"];
/** `status` is `pending`, `done`, or `failed`. A failed result has an `error` instead of `data`. */
export type DeferredImageResponse = Omit<Schema["GetDeferredImageResponse"], "usage"> & {
  usage: MediaUsage | null;
  http: HttpMeta;
};

export type ImageWaitOptions = {
  /** Milliseconds between polls. Defaults to 1000. */
  interval?: number;
  /** Maximum total wait in milliseconds. Defaults to 300000 (5 minutes). */
  timeout?: number;
  signal?: AbortSignal;
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
  reference_images?: Array<ImageInput>;
  keyframes?: Array<VideoKeyframe>;
};

/** Blob and File values are client-only: inlined to a `url` data URL before send. */
export type VideoInput = Schema["VideoUrl"] | Blob | File;

export type VideoEditParams = Omit<Schema["EditVideoRequest"], "model" | "video"> & {
  model: VideoModelId;
  video: VideoInput;
};

export type VideoExtendParams = Omit<Schema["ExtendVideoRequest"], "model" | "video"> & {
  model: VideoModelId;
  video: VideoInput;
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
  batches: Array<Batch>;
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
  batch_request_metadata: Array<BatchRequestMetadata>;
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
  results: Array<BatchResult>;
  pagination_token?: string | null;
};

export type SpeechParams<T extends string = string> = {
  /** Up to 60,000 characters. Can include speech tags such as `[pause]`. */
  text: SpeechText<T>;
  /** BCP-47 code such as `en` or `pt-BR`, or `auto`. */
  language: string;
  /** A built-in voice such as `eve`, or a custom voice ID. Defaults to `eve`. */
  voice_id?: VoiceId;
  output_format?: {
    codec: "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
    sample_rate?: number | null;
    /** MP3 only. */
    bit_rate?: number | null;
  };
  optimize_streaming_latency?: 0 | 1 | 2;
  text_normalization?: boolean;
  /** Return JSON with base64 audio and per-character timings instead of audio bytes. */
  with_timestamps?: boolean;
  speed?: number;
  replace?: Record<string, string>;
};

export type SpeechWithTimestamps = {
  /** Base64-encoded audio in the requested codec. */
  audio: string;
  content_type: string;
  duration: number;
  audio_timestamps?: {
    graph_chars: Array<string>;
    /** Seconds, aligned by index with `graph_chars`. */
    graph_times: Array<[start: number, end: number]>;
  };
};

export type TranscriptionParams = {
  model?: TranscriptionModelId;
  /** Only needed for raw `pcm`, `mulaw`, or `alaw` audio, which also needs `sample_rate`. */
  audio_format?:
    | "pcm"
    | "mulaw"
    | "alaw"
    | "wav"
    | "mp3"
    | "ogg"
    | "opus"
    | "flac"
    | "aac"
    | "mp4"
    | "m4a"
    | "mkv";
  sample_rate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
  language?: string;
  /** Write spoken numbers, currencies, and units in written form. Requires `language`. */
  format?: boolean;
  multichannel?: boolean;
  channels?: number;
  diarize?: boolean;
  keyterm?: Array<string>;
  filler_words?: boolean;
  vad_threshold?: number;
} & ({ file: Blob | File; url?: never } | { url: string; file?: never });

type TranscriptionWord = {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
};

export type Transcription = {
  text: string;
  language: string;
  duration: number;
  words?: Array<TranscriptionWord>;
  /** Present when `multichannel` is true. */
  channels?: Array<{
    index: number;
    language?: string;
    text: string;
    words?: Array<TranscriptionWord>;
  }>;
};

export type Voice = {
  voice_id: string;
  name: string;
  language?: string | null;
};

export type VoiceList = { voices: Array<Voice> };

type CustomVoiceGender = "male" | "female" | "neutral";
type CustomVoiceAge = "young" | "middle-aged" | "old";

type CustomVoiceLabels = {
  name?: string;
  description?: string;
  gender?: CustomVoiceGender;
  accent?: string;
  age?: CustomVoiceAge;
  language?: string;
  use_case?:
    | "conversational"
    | "narration"
    | "characters"
    | "educational"
    | "advertisement"
    | "social_media"
    | "entertainment";
  tone?: "warm" | "casual" | "professional" | "friendly" | "authoritative" | "expressive" | "calm";
};

export type CustomVoice = {
  voice_id: string;
  name?: string | null;
  description?: string | null;
  gender?: CustomVoiceGender | null;
  accent?: string | null;
  age?: CustomVoiceAge | null;
  language?: string | null;
  use_case?: string | null;
  tone?: string | null;
  created_at: string;
};

export type CustomVoiceList = {
  voices: Array<CustomVoice>;
  pagination_token?: string | null;
};

export type CustomVoiceCreateParams = CustomVoiceLabels & {
  /** Reference audio of up to 120 seconds. */
  file: Blob | File;
};

/** Omitted fields are unchanged; `null` clears a field. */
export type CustomVoiceUpdateParams = {
  [K in keyof CustomVoiceLabels]?: CustomVoiceLabels[K] | null;
};

export type ClientSecretCreateParams = {
  expires_after?: {
    /** At most 3600. Defaults to 600. */
    seconds?: number;
  };
  session?: {
    model?: RealtimeModelId;
    reasoning?: { effort?: "high" | "none" };
  } | null;
};

export type ClientSecret = {
  value: string;
  /** Unix time in seconds. */
  expires_at: number;
};

export type TokenizeParams = Omit<Schema["TokenizeRequest"], "model" | "text"> & {
  model: ModelId;
  text: string;
};

export type Token = Schema["TokenizeResponseToken"];
export type TokenizeResponse = Schema["TokenizeResponse"];

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
  /** Number of retries. Creates retry only explicit 429 responses, unless `retryBeforeOutput` is set. */
  maxRetries?: number;
  /**
   * Also retry a streamed `responses.create()`, including one without `stream`, when it fails before the
   * model produces any output: a 5xx status, a dropped connection, or a stream error such as a 503 right
   * after `response.created`. All retries of the call share `maxRetries`. Each retry starts a new response,
   * and the failed attempt's input tokens may still be billed. Defaults to false.
   */
  retryBeforeOutput?: boolean;
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
  /** `retryBeforeOutput` override. */
  retryBeforeOutput?: boolean;
  headers?: RequestHeaders;
  http?: { body?: boolean };
};

export type HttpMeta = {
  status: number;
  headers: Headers;
  requestId: string | null;
  clientRequestId: string;
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

export type ResponseStreamEvent =
  | Exclude<StreamEvent, { type: "error" }>
  | (Extract<StreamEvent, { type: "error" }> & { error?: import("./errors.js").APIError })
  | { type: "unknown"; raw: unknown };
