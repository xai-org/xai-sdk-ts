import { send } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import { requireRecord } from "./shared.js";
import type {
  EmbeddingCreateParams,
  EmbeddingModel,
  EmbeddingModelList,
  EmbeddingResponse,
  HttpMeta,
  RequestOpts,
} from "../types.js";
import type { xAI } from "../client.js";

export class Embeddings {
  readonly models: EmbeddingModels;

  constructor(private readonly client: xAI) {
    this.models = new EmbeddingModels(client);
  }

  async create(
    params: EmbeddingCreateParams,
    opts?: RequestOpts,
  ): Promise<EmbeddingResponse & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: "/embeddings",
      body: params,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Embedding response");
    if (!Array.isArray(body.data)) {
      throw new APIProtocolError("Embedding response is missing data", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as EmbeddingResponse), http: result.http };
  }
}

export class EmbeddingModels {
  constructor(private readonly client: xAI) {}

  async list(opts?: RequestOpts): Promise<EmbeddingModelList & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/embedding-models",
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Embedding model list");
    if (
      !Array.isArray(body.models) ||
      !body.models.every(
        (model) =>
          typeof model === "object" &&
          model !== null &&
          typeof (model as { id?: unknown }).id === "string",
      )
    ) {
      throw new APIProtocolError("Embedding model list is missing models", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as EmbeddingModelList), http: result.http };
  }

  async get(id: string, opts?: RequestOpts): Promise<EmbeddingModel & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/embedding-models/${encodeURIComponent(id)}`,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Embedding model");
    if (typeof body.id !== "string" || body.id.length === 0) {
      throw new APIProtocolError("Embedding model response is missing id", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as EmbeddingModel), http: result.http };
  }
}
