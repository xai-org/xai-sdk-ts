import { send, type SendResult } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import { inlineImageInputs } from "../porcelain.js";
import { mapMediaUsage } from "../usage.js";
import { requireRecord } from "./shared.js";
import type { ImageEditParams, ImageGenerateParams, ImageResponse, RequestOpts } from "../types.js";
import type { xAI } from "../client.js";

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

export class Images {
  constructor(private readonly client: xAI) {}

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