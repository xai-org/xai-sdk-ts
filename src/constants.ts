import { SDK_VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_TIMEOUT_MS = 3_600_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_RESPONSE_BODY_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_ERROR_BODY_BYTES = 1024 * 1024;

export const SDK_USER_AGENT = `xai-sdk/${SDK_VERSION} (typescript)`;

export const CLIENT_REQUEST_ID_HEADER = "x-client-request-id";

/** Wire default is true (stored 30 days). This client defaults to false. */
export const SDK_STORE_DEFAULT = false;

export const ENCRYPTED_REASONING = "reasoning.encrypted_content" as const;

export const KNOWN_STREAM_EVENT_TYPES = [
  "ping",
  "error",
  "response.created",
  "response.in_progress",
  "response.completed",
  "response.failed",
  "response.incomplete",
  "response.output_item.added",
  "response.output_item.done",
  "response.content_part.added",
  "response.content_part.done",
  "response.output_text.delta",
  "response.output_text.done",
  "response.reasoning_text.delta",
  "response.reasoning_text.done",
  "response.reasoning_summary_text.delta",
  "response.reasoning_summary_text.done",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.image_generation_call.in_progress",
  "response.image_generation_call.generating",
  "response.image_generation_call.completed",
] as const;

export type KnownStreamEventType = (typeof KNOWN_STREAM_EVENT_TYPES)[number];

const KNOWN_SET = new Set<string>(KNOWN_STREAM_EVENT_TYPES);

export function isKnownStreamEventType(type: string): type is KnownStreamEventType {
  return KNOWN_SET.has(type);
}

/** Output item types for tools that SpaceXAI runs itself. The API sends X search calls as `custom_tool_call` items. */
export const SERVER_TOOL_CALL_TYPES = [
  "web_search_call",
  "x_search_call",
  "custom_tool_call",
  "file_search_call",
  "code_interpreter_call",
  "mcp_call",
  "tool_search_call",
  "image_generation_call",
] as const;

export type ServerToolCallType = (typeof SERVER_TOOL_CALL_TYPES)[number];

const SERVER_TOOL_CALL_SET = new Set<string>(SERVER_TOOL_CALL_TYPES);

export function isServerToolCallType(type: unknown): type is ServerToolCallType {
  return typeof type === "string" && SERVER_TOOL_CALL_SET.has(type);
}

/** Safe to retry even for create requests: the server rejected work before generation. */
export const RETRYABLE_STATUS = new Set([429]);

/** Extra statuses retried only for read-only methods. */
export const IDEMPOTENT_RETRY_STATUS = new Set([408, 409, 500, 502, 503, 504, 529]);

/** Server errors that `retryBeforeOutput` also retries for creates, as an HTTP status or a stream error before output. */
export const SERVER_ERROR_RETRY_STATUS = new Set([500, 502, 503, 504, 529]);

export const BACKOFF_MS = { initial: 250, max: 8_000 };
/** Rate limits reset over seconds, so a 429 without `Retry-After` starts with a longer wait. */
export const RATE_LIMIT_BACKOFF_MS = { initial: 1_000, max: 30_000 };
