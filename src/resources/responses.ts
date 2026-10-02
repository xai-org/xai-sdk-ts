import { applyCreateDefaults, inlineBlobs } from "../porcelain.js";
import { send } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import { ModelResponse } from "../response.js";
import { ResponseStream } from "../stream.js";
import { PagePromise } from "../pagination.js";
import { requireRecord } from "./shared.js";
import type { CompactParams, CreateParams, RequestOpts } from "../types.js";
import type { CompactResponse, DeletedResponse, InputItemList } from "../types.js";
import type { SpaceXAI } from "../client.js";

export class Responses {
  readonly inputItems: InputItems;

  constructor(private readonly client: SpaceXAI) {
    this.inputItems = new InputItems(client);
  }

  /**
   * Create a response.
   *
   * `store` SDK default is false. The API wire default is true (stored 30 days).
   * When `store` is false, `reasoning.encrypted_content` is merged into `include`.
   *
   * Without `stream`, the response is streamed under the hood and this resolves to the final
   * response. `stream: false` sends a plain JSON request instead.
   */
  create(body: CreateParams & { stream: true }, opts?: RequestOpts): Promise<ResponseStream>;
  create(body: CreateParams & { stream?: false }, opts?: RequestOpts): Promise<ModelResponse>;
  create(body: CreateParams & { stream?: boolean }, opts?: RequestOpts): Promise<ModelResponse | ResponseStream>;
  async create(
    body: CreateParams & { stream?: boolean },
    opts?: RequestOpts,
  ): Promise<ModelResponse | ResponseStream> {
    const input = await inlineBlobs(body.input, opts?.signal);
    const payload = applyCreateDefaults({ ...body, input });
    if (body.stream === undefined) return this.#streamToResponse(payload, opts);
    const stream = body.stream;
    const result = await send(this.client, {
      method: "POST",
      path: "/responses",
      body: payload,
      stream,
      opts,
    });
    if (stream) {
      return new ResponseStream({
        body: result.body,
        http: result.http,
        signal: opts?.signal,
      });
    }
    return new ModelResponse(result.payload, result.http);
  }

  /** Streaming keeps long requests alive where runtimes cap the wait for headers, such as Node at 5 minutes. */
  async #streamToResponse(payload: Record<string, unknown>, opts?: RequestOpts): Promise<ModelResponse> {
    const result = await send(this.client, {
      method: "POST",
      path: "/responses",
      body: { ...payload, stream: true },
      stream: true,
      acceptJson: true,
      // Reasoning can run silently for minutes, so only a per-request idleTimeout applies.
      opts: { ...opts, idleTimeout: opts?.idleTimeout ?? 0 },
    });
    if (!result.body) return new ModelResponse(result.payload, result.http);
    const response = await new ResponseStream({ body: result.body, http: result.http, signal: opts?.signal }).done();
    if (opts?.http?.body) response.http.body = response.raw;
    return response;
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

  async get(id: string, opts?: RequestOpts): Promise<ModelResponse> {
    const result = await send(this.client, {
      method: "GET",
      path: `/responses/${encodeURIComponent(id)}`,
      opts,
    });
    return new ModelResponse(result.payload, result.http);
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
  constructor(private readonly client: SpaceXAI) {}

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
