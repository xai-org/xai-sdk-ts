import { send, type SendResult } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import { inlineImageInputs } from "../porcelain.js";
import { mapMediaUsage } from "../usage.js";
import { pollUntil, requireRecord } from "./shared.js";
import type {
  DeferredImageEditParams,
  DeferredImageGenerateParams,
  DeferredImageResponse,
  HttpMeta,
  ImageEditParams,
  ImageGenerateParams,
  ImageResponse,
  ImageStartResponse,
  ImageWaitOptions,
  RequestOpts,
} from "../types.js";
import type { SpaceXAI } from "../client.js";

const DEFAULT_WAIT_INTERVAL_MS = 1_000;
const DEFAULT_WAIT_TIMEOUT_MS = 300_000;

type NotDeferred = { deferred?: false | null };
type MaybeDeferred = { deferred?: boolean | null };
type ImageStart = ImageStartResponse & { http: HttpMeta };

function toImageResponse(result: SendResult): ImageResponse {
  const body = requireRecord(result.payload, result.http, "Image response");
  if (!Array.isArray(body.data)) {
    throw new APIProtocolError("Image response is missing data", {
      ...requestIds(result.http),
      body,
    });
  }
  return {
    ...(body as Omit<ImageResponse, "usage" | "http">),
    usage: mapMediaUsage(body.usage),
    http: result.http,
  };
}

function toStartResponse(result: SendResult): ImageStart {
  const body = requireRecord(result.payload, result.http, "Image start response");
  if (typeof body.request_id !== "string" || body.request_id.length === 0) {
    throw new APIProtocolError("Image start response is missing request_id", {
      ...requestIds(result.http),
      body,
    });
  }
  return { ...(body as ImageStartResponse), http: result.http };
}

function toResult(result: SendResult, deferred: boolean | null | undefined): ImageResponse | ImageStart {
  return deferred === true ? toStartResponse(result) : toImageResponse(result);
}

export class Images {
  constructor(private readonly client: SpaceXAI) {}

  generate(body: ImageGenerateParams & NotDeferred, opts?: RequestOpts): Promise<ImageResponse>;
  /** Resolves to a `request_id` right away. Poll it with `wait()` or `get()`. */
  generate(body: DeferredImageGenerateParams, opts?: RequestOpts): Promise<ImageStart>;
  generate(body: ImageGenerateParams & MaybeDeferred, opts?: RequestOpts): Promise<ImageResponse | ImageStart>;
  async generate(
    body: ImageGenerateParams & MaybeDeferred,
    opts?: RequestOpts,
  ): Promise<ImageResponse | ImageStart> {
    const result = await send(this.client, {
      method: "POST",
      path: "/images/generations",
      body,
      opts,
    });
    return toResult(result, body.deferred);
  }

  edit(body: ImageEditParams & NotDeferred, opts?: RequestOpts): Promise<ImageResponse>;
  /** Resolves to a `request_id` right away. Poll it with `wait()` or `get()`. */
  edit(body: DeferredImageEditParams, opts?: RequestOpts): Promise<ImageStart>;
  edit(body: ImageEditParams & MaybeDeferred, opts?: RequestOpts): Promise<ImageResponse | ImageStart>;
  async edit(body: ImageEditParams & MaybeDeferred, opts?: RequestOpts): Promise<ImageResponse | ImageStart> {
    const payload = await inlineImageInputs(body, opts?.signal);
    const result = await send(this.client, {
      method: "POST",
      path: "/images/edits",
      body: payload,
      opts,
    });
    return toResult(result, body.deferred);
  }

  /** Check a deferred request once. The status stays `pending` until the images are ready. */
  async get(requestId: string, opts?: RequestOpts): Promise<DeferredImageResponse> {
    const result = await send(this.client, {
      method: "GET",
      path: `/images/${encodeURIComponent(requestId)}`,
      opts,
    });
    // Pending requests answer 202, with or without a JSON body.
    const body: Record<string, unknown> =
      result.http.status === 202 && result.payload === null
        ? { status: "pending" }
        : requireRecord(result.payload, result.http, "Deferred image response");
    if (typeof body.status !== "string") {
      throw new APIProtocolError("Deferred image response is missing status", {
        ...requestIds(result.http),
        body,
      });
    }
    return {
      ...(body as Omit<DeferredImageResponse, "usage" | "http">),
      request_id: typeof body.request_id === "string" ? body.request_id : requestId,
      usage: mapMediaUsage(body.usage),
      http: result.http,
    };
  }

  /**
   * Poll `get()` until the status is no longer `pending`. After `timeout`, rejects with
   * `TimeoutError` while the request keeps running on the server.
   */
  async wait(requestId: string, opts: ImageWaitOptions = {}): Promise<DeferredImageResponse> {
    const { interval = DEFAULT_WAIT_INTERVAL_MS, timeout = DEFAULT_WAIT_TIMEOUT_MS, signal } = opts;
    return pollUntil(
      (pollSignal) => this.get(requestId, { signal: pollSignal }),
      (result) => result.status !== "pending",
      { interval, timeout, signal, label: `Image request ${requestId}` },
    );
  }
}
