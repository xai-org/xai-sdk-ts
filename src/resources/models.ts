import { send } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import { requireRecord } from "./shared.js";
import type {
  HttpMeta,
  ImageGenerationModel,
  ImageGenerationModelList,
  LanguageModel,
  LanguageModelList,
  Model,
  ModelList,
  RequestOpts,
  VideoGenerationModel,
  VideoGenerationModelList,
} from "../types.js";
import type { ImageModelId, ModelId, VideoModelId } from "../models.js";
import type { xAI } from "../client.js";

export class ModelsResource {
  readonly language: LanguageModels;
  readonly image: ImageModels;
  readonly video: VideoModels;

  constructor(private readonly client: xAI) {
    this.language = new LanguageModels(client);
    this.image = new ImageModels(client);
    this.video = new VideoModels(client);
  }

  async list(opts?: RequestOpts): Promise<ModelList & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/models",
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Model list");
    if (
      body.object !== "list" ||
      !Array.isArray(body.data) ||
      !body.data.every(
        (model) =>
          typeof model === "object" &&
          model !== null &&
          typeof (model as { id?: unknown }).id === "string",
      )
    ) {
      throw new APIProtocolError("Model list is missing object=list or data", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as ModelList), http: result.http };
  }

  async get(id: string, opts?: RequestOpts): Promise<Model & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/models/${encodeURIComponent(id)}`,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Model");
    if (typeof body.id !== "string" || body.id.length === 0) {
      throw new APIProtocolError("Model response is missing id", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as Model), http: result.http };
  }
}

export class LanguageModels {
  constructor(private readonly client: xAI) {}

  async list(opts?: RequestOpts): Promise<LanguageModelList & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/language-models",
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Language model list");
    if (
      !Array.isArray(body.models) ||
      !body.models.every(
        (model) =>
          typeof model === "object" &&
          model !== null &&
          typeof (model as { id?: unknown }).id === "string",
      )
    ) {
      throw new APIProtocolError("Language model list is missing models", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as LanguageModelList), http: result.http };
  }

  async get(id: ModelId, opts?: RequestOpts): Promise<LanguageModel & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/language-models/${encodeURIComponent(id)}`,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Language model");
    if (typeof body.id !== "string" || body.id.length === 0) {
      throw new APIProtocolError("Language model response is missing id", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as LanguageModel), http: result.http };
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
    const body = requireRecord(result.payload, result.http, "Image model list");
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
        ...requestIds(result.http),
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
    const body = requireRecord(result.payload, result.http, "Image model");
    if (typeof body.id !== "string" || body.id.length === 0) {
      throw new APIProtocolError("Image model response is missing id", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as ImageGenerationModel), http: result.http };
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
