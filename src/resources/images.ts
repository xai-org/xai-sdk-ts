import { send, type SendResult } from "../http.js";
import { APIProtocolError } from "../errors.js";
import { inlineImageInputs } from "../porcelain.js";
import { mapMediaUsage } from "../usage.js";
import { requireRecord } from "./shared.js";
import type {
  HttpMeta,
  ImageEditParams,
  ImageGenerateParams,
  ImageGenerationModel,
  ImageGenerationModelList,
  ImageResponse,
  RequestOpts,
} from "../types.js";
import type { ImageModelId } from "../models.js";
import type { xAI } from "../client.js";

function toImageResponse(result: SendResult): ImageResponse {
  const body = requireRecord(result.payload, result.http.requestId, "Image response");
  if (!Array.isArray(body.data)) {
    throw new APIProtocolError("Image response is missing data", {
      requestId: result.http.requestId,
      body,
    });
  }
  return {
    ...(body as Omit<ImageResponse, "usage" | "http">),
    usage: mapMediaUsage(body.usage),
    http: result.http,
  };
}

export class Images {
  readonly models: ImageModels;

  constructor(private readonly client: xAI) {
    this.models = new ImageModels(client);
  }

  async generate(body: ImageGenerateParams, opts?: RequestOpts): Promise<ImageResponse> {
    const result = await send(this.client, {
      method: "POST",
      path: "/images/generations",
      body,
      opts,
    });
    return toImageResponse(result);
  }

  async edit(body: ImageEditParams, opts?: RequestOpts): Promise<ImageResponse> {
    const payload = await inlineImageInputs(body, opts?.signal);
    const result = await send(this.client, {
      method: "POST",
      path: "/images/edits",
      body: payload,
      opts,
    });
    return toImageResponse(result);
  }
}

export class ImageModels {
  constructor(private readonly client: xAI) {}

  async list(opts?: RequestOpts): Promise<ImageGenerationModelList & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/image-generation-models",
      opts,
    });
    const body = requireRecord(result.payload, result.http.requestId, "Image model list");
    if (
      !Array.isArray(body.models) ||
      !body.models.every(
        (model) =>
          typeof model === "object" &&
          model !== null &&
          typeof (model as { id?: unknown }).id === "string",
      )
    ) {
      throw new APIProtocolError("Image model list is missing models", {
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as ImageGenerationModelList), http: result.http };
  }

  async get(
    id: ImageModelId,
    opts?: RequestOpts,
  ): Promise<ImageGenerationModel & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/image-generation-models/${encodeURIComponent(id)}`,
      opts,
    });
    const body = requireRecord(result.payload, result.http.requestId, "Image model");
    if (typeof body.id !== "string" || body.id.length === 0) {
      throw new APIProtocolError("Image model response is missing id", {
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as ImageGenerationModel), http: result.http };
  }
}
