import { SDK_VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_TIMEOUT_MS = 3_600_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_RESPONSE_BODY_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_ERROR_BODY_BYTES = 1024 * 1024;

/** Same product token as the Python SDK. */
export const SDK_USER_AGENT = `XaiSdk/${SDK_VERSION}`;

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
] as const;

export type KnownStreamEventType = (typeof KNOWN_STREAM_EVENT_TYPES)[number];

const KNOWN_SET = new Set<string>(KNOWN_STREAM_EVENT_TYPES);

export function isKnownStreamEventType(type: string): type is KnownStreamEventType {
  return KNOWN_SET.has(type);
}

/** Safe to retry even for create requests: the server rejected work before generation. */
export const RETRYABLE_STATUS = new Set([429]);

/** Extra statuses retried only for read-only methods. */
export const IDEMPOTENT_RETRY_STATUS = new Set([408, 409, 500, 502, 503, 504, 529]);

/** Cap streamed output/content indexes so a hostile endpoint cannot OOM the client. */
export const MAX_STREAM_INDEX = 1024;
