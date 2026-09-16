import { send } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import type { HttpMeta, Model, ModelList, RequestOpts } from "../types.js";
import type { xAI } from "../client.js";

function requireRecord(
  payload: unknown,
  http: HttpMeta,
  label: string,
): Record<string, unknown> {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  throw new APIProtocolError(`${label} must be a JSON object`, {
    ...requestIds(http),
    body: payload,
  });
}

export class ModelsResource {
  constructor(private readonly client: xAI) {}

  async list(opts?: RequestOpts): Promise<ModelList & { http: import("../types.js").HttpMeta }> {
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

  async get(id: string, opts?: RequestOpts): Promise<Model & { http: import("../types.js").HttpMeta }> {
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
