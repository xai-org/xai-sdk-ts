import { send } from "../http.js";
import { APIProtocolError } from "../errors.js";
import { requireRecord } from "./shared.js";
import type { LanguageModel, LanguageModelList, Model, ModelList, RequestOpts } from "../types.js";
import type { ModelId } from "../models.js";
import type { xAI } from "../client.js";

export class ModelsResource {
  readonly language: LanguageModels;

  constructor(private readonly client: xAI) {
    this.language = new LanguageModels(client);
  }

  async list(opts?: RequestOpts): Promise<ModelList & { http: import("../types.js").HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/models",
      opts,
    });
    const body = requireRecord(result.payload, result.http.requestId, "Model list");
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
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as ModelList), http: result.http };
  }

  async get(id: string, opts?: RequestOpts): Promise<Model & { http: import("../types.js").HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/models/${encodeURIComponent(id)}`,
      opts,
    });
    const body = requireRecord(result.payload, result.http.requestId, "Model");
    if (typeof body.id !== "string" || body.id.length === 0) {
      throw new APIProtocolError("Model response is missing id", {
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as Model), http: result.http };
  }
}

export class LanguageModels {
  constructor(private readonly client: xAI) {}

  async list(opts?: RequestOpts): Promise<LanguageModelList & { http: import("../types.js").HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/language-models",
      opts,
    });
    const body = requireRecord(result.payload, result.http.requestId, "Language model list");
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
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as LanguageModelList), http: result.http };
  }

  async get(id: ModelId, opts?: RequestOpts): Promise<LanguageModel & { http: import("../types.js").HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/language-models/${encodeURIComponent(id)}`,
      opts,
    });
    const body = requireRecord(result.payload, result.http.requestId, "Language model");
    if (typeof body.id !== "string" || body.id.length === 0) {
      throw new APIProtocolError("Language model response is missing id", {
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as LanguageModel), http: result.http };
  }
}
