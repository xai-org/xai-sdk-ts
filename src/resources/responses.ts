import { applyCreateDefaults, inlineBlobs } from "../porcelain.js";
import { send } from "../http.js";
import { APIProtocolError } from "../errors.js";
import { xAIResponse } from "../response.js";
import { xAIStream } from "../stream.js";
import { requireRecord } from "./shared.js";
import type { CreateParams, RequestOpts } from "../types.js";
import type { DeletedResponse, InputItemList } from "../types.js";
import type { xAI } from "../client.js";

export class Responses {
  readonly inputItems: InputItems;

  constructor(private readonly client: xAI) {
    this.inputItems = new InputItems(client);
  }

  /**
   * Create a response.
   *
   * `store` SDK default is false. The API wire default is true (stored 30 days).
   * When `store` is false, `reasoning.encrypted_content` is merged into `include`.
   */
  create(body: CreateParams & { stream: true }, opts?: RequestOpts): Promise<xAIStream>;
  create(body: CreateParams & { stream?: false }, opts?: RequestOpts): Promise<xAIResponse>;
  create(body: CreateParams, opts?: RequestOpts): Promise<xAIResponse | xAIStream>;
  async create(body: CreateParams, opts?: RequestOpts): Promise<xAIResponse | xAIStream> {
    const input = await inlineBlobs(body.input, opts?.signal);
    const payload = applyCreateDefaults({ ...body, input });
    const stream = payload.stream === true;
    const result = await send(this.client, {
      method: "POST",
      path: "/responses",
      body: payload,
      stream,
      opts,
    });
    if (stream) {
      return new xAIStream({
        body: result.body,
        http: result.http,
        signal: opts?.signal,
      });
    }
    return new xAIResponse(result.payload, result.http);
  }

  async get(id: string, opts?: RequestOpts): Promise<xAIResponse> {
    const result = await send(this.client, {
      method: "GET",
      path: `/responses/${encodeURIComponent(id)}`,
      opts,
    });
    return new xAIResponse(result.payload, result.http);
  }

  async delete(id: string, opts?: RequestOpts): Promise<DeletedResponse & { http: import("../types.js").HttpMeta }> {
    const result = await send(this.client, {
      method: "DELETE",
      path: `/responses/${encodeURIComponent(id)}`,
      opts,
    });
    const body = result.http.status === 204
      ? { id, object: "response", deleted: true }
      : requireRecord(result.payload, result.http.requestId, "Delete response");
    if (typeof body.id !== "string" || body.deleted !== true) {
      throw new APIProtocolError("Delete response is missing id or deleted=true", {
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as DeletedResponse), http: result.http };
  }
}

export class InputItems {
  constructor(private readonly client: xAI) {}

  async list(
    id: string,
    query: { after?: string; limit?: number; order?: "asc" | "desc" } = {},
    opts?: RequestOpts,
  ): Promise<InputItemList & { http: import("../types.js").HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/responses/${encodeURIComponent(id)}/input_items`,
      query,
      opts,
    });
    const body = requireRecord(result.payload, result.http.requestId, "Input item list");
    if (body.object !== "list" || !Array.isArray(body.data)) {
      throw new APIProtocolError("Input item list is missing object=list or data", {
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as InputItemList), http: result.http };
  }
}
