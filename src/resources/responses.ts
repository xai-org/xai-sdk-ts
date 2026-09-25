import { applyCreateDefaults, inlineBlobs } from "../porcelain.js";
import { send } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import { xAIResponse } from "../response.js";
import { xAIStream } from "../stream.js";
import { PagePromise } from "../pagination.js";
import { requireRecord } from "./shared.js";
import type { CompactParams, CreateParams, RequestOpts } from "../types.js";
import type { CompactResponse, DeletedResponse, InputItemList } from "../types.js";
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

  async compact(
    body: CompactParams,
    opts?: RequestOpts,
  ): Promise<CompactResponse & { http: import("../types.js").HttpMeta }> {
    const input = await inlineBlobs(body.input, opts?.signal);
    const result = await send(this.client, {
      method: "POST",
      path: "/responses/compact",
      body: { ...body, input },
      opts,
    });
    const compacted = requireRecord(result.payload, result.http, "Compact response");
    if (typeof compacted.id !== "string" || !Array.isArray(compacted.output)) {
      throw new APIProtocolError("Compact response is missing id or output", {
        ...requestIds(result.http),
        body: compacted,
      });
    }
    return { ...(compacted as CompactResponse), http: result.http };
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
      : requireRecord(result.payload, result.http, "Delete response");
    if (typeof body.id !== "string" || body.deleted !== true) {
      throw new APIProtocolError("Delete response is missing id or deleted=true", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as DeletedResponse), http: result.http };
  }
}

export class InputItems {
  constructor(private readonly client: xAI) {}

  list(
    id: string,
    query: { after?: string; limit?: number; order?: "asc" | "desc" } = {},
    opts?: RequestOpts,
  ): PagePromise<InputItemList & { http: import("../types.js").HttpMeta }, InputItemList["data"][number]> {
    const fetchPage = async (pageQuery: typeof query) => {
      const result = await send(this.client, {
        method: "GET",
        path: `/responses/${encodeURIComponent(id)}/input_items`,
        query: pageQuery,
        opts,
      });
      const body = requireRecord(result.payload, result.http, "Input item list");
      if (body.object !== "list" || !Array.isArray(body.data)) {
        throw new APIProtocolError("Input item list is missing object=list or data", {
          ...requestIds(result.http),
          body,
        });
      }
      return { ...(body as InputItemList), http: result.http };
    };
    return new PagePromise({
      first: () => fetchPage(query),
      next: (page) => (page.has_more && page.last_id ? fetchPage({ ...query, after: page.last_id }) : undefined),
      items: (page) => page.data,
    });
  }
}
