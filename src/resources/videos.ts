import { combineSignals, send, sleep, type SendResult } from "../http.js";
import { APIProtocolError, TimeoutError, requestIds } from "../errors.js";
import { inlineImageInput, inlineVideoInput } from "../porcelain.js";
import { mapMediaUsage } from "../usage.js";
import { requireRecord } from "./shared.js";
import type { components } from "../generated/types.js";
import type {
  HttpMeta,
  RequestOpts,
  VideoEditParams,
  VideoExtendParams,
  VideoGenerateParams,
  VideoGenerationModel,
  VideoGenerationModelList,
  VideoResponse,
  VideoStartResponse,
  VideoWaitOptions,
} from "../types.js";
import type { VideoModelId } from "../models.js";
import type { xAI } from "../client.js";

type GenerateVideoRequest = components["schemas"]["GenerateVideoRequest"];

const DEFAULT_WAIT_INTERVAL_MS = 5_000;
const DEFAULT_WAIT_TIMEOUT_MS = 600_000;

async function inlineImages(
  body: VideoGenerateParams,
  signal?: AbortSignal,
): Promise<GenerateVideoRequest> {
  const { image, reference_images, keyframes, ...rest } = body;
  const out: GenerateVideoRequest = rest;
  if (image != null) out.image = await inlineImageInput(image, signal);
  if (reference_images != null) {
    out.reference_images = [];
    for (const item of reference_images) {
      out.reference_images.push(await inlineImageInput(item, signal));
    }
  }
  if (keyframes != null) {
    out.keyframes = [];
    for (const keyframe of keyframes) {
      out.keyframes.push({ ...keyframe, image: await inlineImageInput(keyframe.image, signal) });
    }
  }
  return out;
}

function toStartResponse(result: SendResult): VideoStartResponse & { http: HttpMeta } {
  const body = requireRecord(result.payload, result.http, "Video start response");
  if (typeof body.request_id !== "string" || body.request_id.length === 0) {
    throw new APIProtocolError("Video start response is missing request_id", {
      ...requestIds(result.http),
      body,
    });
  }
  return { ...(body as VideoStartResponse), http: result.http };
}

export class Videos {
  readonly models: VideoModels;

  constructor(private readonly client: xAI) {
    this.models = new VideoModels(client);
  }

  async generate(
    body: VideoGenerateParams,
    opts?: RequestOpts,
  ): Promise<VideoStartResponse & { http: HttpMeta }> {
    const payload = await inlineImages(body, opts?.signal);
    const result = await send(this.client, {
      method: "POST",
      path: "/videos/generations",
      body: payload,
      opts,
    });
    return toStartResponse(result);
  }

  async edit(
    body: VideoEditParams,
    opts?: RequestOpts,
  ): Promise<VideoStartResponse & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: "/videos/edits",
      body: { ...body, video: await inlineVideoInput(body.video, opts?.signal) },
      opts,
    });
    return toStartResponse(result);
  }

  async extend(
    body: VideoExtendParams,
    opts?: RequestOpts,
  ): Promise<VideoStartResponse & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: "/videos/extensions",
      body: { ...body, video: await inlineVideoInput(body.video, opts?.signal) },
      opts,
    });
    return toStartResponse(result);
  }

  async get(requestId: string, opts?: RequestOpts): Promise<VideoResponse> {
    const result = await send(this.client, {
      method: "GET",
      path: `/videos/${encodeURIComponent(requestId)}`,
      opts,
    });
    // Pending requests answer 202, with or without a JSON body.
    const body: Record<string, unknown> =
      result.http.status === 202 && result.payload === null
        ? { status: "pending" }
        : requireRecord(result.payload, result.http, "Video response");
    if (typeof body.status !== "string") {
      throw new APIProtocolError("Video response is missing status", {
        ...requestIds(result.http),
        body,
      });
    }
    return {
      ...(body as Omit<VideoResponse, "usage" | "http">),
      usage: mapMediaUsage(body.usage),
      http: result.http,
    };
  }

  /**
   * Poll `get()` until the status is no longer `pending`. After `timeout`, rejects with
   * `TimeoutError` while the request keeps running on the server.
   */
  async wait(requestId: string, opts: VideoWaitOptions = {}): Promise<VideoResponse> {
    const { interval = DEFAULT_WAIT_INTERVAL_MS, timeout = DEFAULT_WAIT_TIMEOUT_MS } = opts;
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      deadline.abort(
        new TimeoutError(`Video request ${requestId} did not finish within ${timeout}ms`),
      );
    }, timeout);
    const signal = combineSignals([opts.signal, deadline.signal]);
    try {
      while (true) {
        const result = await this.get(requestId, { signal });
        if (result.status !== "pending") return result;
        await sleep(interval, signal);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export class VideoModels {
  constructor(private readonly client: xAI) {}

  async list(opts?: RequestOpts): Promise<VideoGenerationModelList & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/video-generation-models",
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Video model list");
    if (
      !Array.isArray(body.models) ||
      !body.models.every(
        (model) =>
          typeof model === "object" &&
          model !== null &&
          typeof (model as { id?: unknown }).id === "string",
      )
    ) {
      throw new APIProtocolError("Video model list is missing models", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as VideoGenerationModelList), http: result.http };
  }

  async get(
    id: VideoModelId,
    opts?: RequestOpts,
  ): Promise<VideoGenerationModel & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/video-generation-models/${encodeURIComponent(id)}`,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Video model");
    if (typeof body.id !== "string" || body.id.length === 0) {
      throw new APIProtocolError("Video model response is missing id", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as VideoGenerationModel), http: result.http };
  }
}
