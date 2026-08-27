const BRAND = Symbol.for("@xai-official/sdk:APIError");

type ErrorInit = {
  request_id?: string | null;
  status?: number;
  code?: string | null;
  body?: unknown;
  cause?: unknown;
};

export class APIError extends Error {
  readonly request_id: string | null;
  readonly status: number | undefined;
  readonly code: string | null;
  readonly body: unknown;
  readonly [BRAND] = true as const;

  constructor(message: string, init: ErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.request_id = init.request_id ?? null;
    this.status = init.status;
    this.code = init.code ?? null;
    this.body = init.body;
    Object.defineProperty(this, "body", {
      value: init.body,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }

  static is(err: unknown): err is APIError {
    return typeof err === "object" && err !== null && BRAND in err;
  }

  isRateLimit(): boolean {
    return this instanceof RateLimitError || this.status === 429;
  }

  isOverloaded(): boolean {
    return this instanceof OverloadedError || this.status === 529;
  }

  isAbort(): boolean {
    return this.name === "AbortError";
  }
}

export class APIConnectionError extends APIError {
  constructor(message = "Connection error", init: ErrorInit = {}) {
    super(message, init);
  }
}

export class APIProtocolError extends APIError {
  constructor(message = "Invalid API response", init: ErrorInit = {}) {
    super(message, init);
  }
}

export class TimeoutError extends APIError {
  constructor(message = "Request timed out", init: ErrorInit = {}) {
    super(message, init);
  }
}

export class AbortError extends APIError {
  constructor(message = "Request aborted", init: ErrorInit = {}) {
    super(message, init);
  }
}

export class APIStatusError extends APIError {
  declare readonly status: number;
  constructor(message: string, init: ErrorInit & { status: number }) {
    super(message, init);
  }
}

export class AuthenticationError extends APIStatusError {
  constructor(message = "Authentication failed", init: ErrorInit = {}) {
    super(message, { ...init, status: 401 });
  }
}

export class PermissionDeniedError extends APIStatusError {
  constructor(message = "Permission denied", init: ErrorInit = {}) {
    super(message, { ...init, status: 403 });
  }
}

export class NotFoundError extends APIStatusError {
  constructor(message = "Not found", init: ErrorInit = {}) {
    super(message, { ...init, status: 404 });
  }
}

export class RateLimitError extends APIStatusError {
  constructor(message = "Rate limited", init: ErrorInit = {}) {
    super(message, { ...init, status: 429 });
  }
}

export class OverloadedError extends APIStatusError {
  constructor(message = "Service overloaded", init: ErrorInit = {}) {
    super(message, { ...init, status: 529 });
  }
}

const DROPPED_REASONING_MESSAGE =
  "pass response.toInput() (or include encrypted reasoning)";

export function rewriteStatusMessage(status: number, message: string): string {
  if (status === 400 && /reason(ing)?|encrypted_content|encrypted reasoning/i.test(message)) {
    return DROPPED_REASONING_MESSAGE;
  }
  return message;
}

export function requestIdFromHeaders(headers: Headers): string | null {
  return headers.get("x-request-id");
}

export function errorFromStatus(
  status: number,
  message: string,
  init: ErrorInit = {},
): APIStatusError {
  const rewritten = rewriteStatusMessage(status, message);
  const base = { ...init, status };
  switch (status) {
    case 401:
      return new AuthenticationError(rewritten, base);
    case 403:
      return new PermissionDeniedError(rewritten, base);
    case 404:
      return new NotFoundError(rewritten, base);
    case 429:
      return new RateLimitError(rewritten, base);
    case 529:
      return new OverloadedError(rewritten, base);
    default:
      return new APIStatusError(rewritten, { ...base, status });
  }
}

export async function errorFromResponse(res: Response, body?: unknown): Promise<APIStatusError> {
  const request_id = requestIdFromHeaders(res.headers);
  let parsed = body;
  if (parsed === undefined) {
    const text = await res.text().catch(() => "");
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
  }
  let message = res.statusText || `HTTP ${res.status}`;
  let code: string | null = null;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const err = (obj.error && typeof obj.error === "object" ? obj.error : obj) as Record<
      string,
      unknown
    >;
    if (typeof err.message === "string") message = err.message;
    if (typeof err.code === "string") code = err.code;
    else if (typeof err.code === "number") code = String(err.code);
  } else if (typeof parsed === "string" && parsed.length > 0) {
    message = parsed;
  }
  return errorFromStatus(statusOf(res), message, { request_id, code, body: parsed });
}

function statusOf(res: Response): number {
  return res.status;
}

export function errorFromAbort(signal: AbortSignal, request_id: string | null): APIError {
  const reason = signal.reason;
  if (APIError.is(reason)) {
    if (reason.name === "TimeoutError" && reason.request_id === null && request_id !== null) {
      return new TimeoutError(reason.message, { request_id, cause: reason });
    }
    return reason;
  }
  if (isTimeoutLike(reason)) {
    return new TimeoutError("Request timed out", { request_id, cause: reason });
  }
  const message =
    typeof reason === "string" && reason.length > 0
      ? reason
      : reason instanceof Error
        ? reason.message
        : "Request aborted";
  return new AbortError(message, { request_id, cause: reason });
}

export function errorFromUnknown(err: unknown, request_id: string | null): APIError {
  if (APIError.is(err)) return err;
  if (isTimeoutLike(err)) {
    return new TimeoutError(err instanceof Error ? err.message : "Request timed out", {
      request_id,
      cause: err,
    });
  }
  if (isAbortLike(err)) {
    return new AbortError(err instanceof Error ? err.message : "Request aborted", {
      request_id,
      cause: err,
    });
  }
  const message = err instanceof Error ? err.message : "Connection error";
  return new APIConnectionError(message, { request_id, cause: err });
}

export function isTimeoutLike(err: unknown): boolean {
  if (APIError.is(err) && err.name === "TimeoutError") return true;
  if (typeof err !== "object" || err === null) return false;
  return (err as { name?: string }).name === "TimeoutError";
}

export function isAbortLike(err: unknown): boolean {
  if (APIError.is(err) && err.isAbort()) return true;
  if (typeof err !== "object" || err === null) return false;
  return (err as { name?: string }).name === "AbortError";
}

export function streamErrorEvent(
  raw: Record<string, unknown>,
  request_id: string | null,
): { event: Record<string, unknown>; error: APIError } {
  const codeRaw = raw.code;
  const codeNum = typeof codeRaw === "number" ? codeRaw : Number.parseInt(String(codeRaw ?? ""), 10);
  const message = typeof raw.message === "string" ? raw.message : "Stream error";
  let error: APIError;
  if (codeNum === 529 || /overloaded/i.test(message)) {
    error = new OverloadedError(message, { request_id, code: codeRaw != null ? String(codeRaw) : "529" });
  } else if (codeNum >= 400 && codeNum < 600) {
    error = errorFromStatus(codeNum, message, {
      request_id,
      code: codeRaw != null ? String(codeRaw) : null,
      body: raw,
    });
  } else {
    error = new APIError(message, {
      request_id,
      code: codeRaw != null ? String(codeRaw) : null,
      body: raw,
    });
  }
  return { event: { ...raw, type: "error", error }, error };
}
