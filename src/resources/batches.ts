import { combineSignals, send, sleep, type SendResult } from "../http.js";
import { APIProtocolError, TimeoutError, requestIds } from "../errors.js";
import { applyCreateDefaults, inlineBlobs } from "../porcelain.js";
import { tokenPages, type PagePromise } from "../pagination.js";
import { requireRecord } from "./shared.js";
import type {
  Batch,
  BatchCreateParams,
  BatchList,
  BatchRequest,
  BatchRequestMetadata,
  BatchRequestMetadataList,
  BatchResult,
  BatchResultList,
  BatchWaitOptions,
  HttpMeta,
  RequestOpts,
} from "../types.js";
import type { xAI } from "../client.js";

const DEFAULT_WAIT_INTERVAL_MS = 5_000;
const DEFAULT_WAIT_TIMEOUT_MS = 86_400_000;

function toBatch(result: SendResult): Batch & { http: HttpMeta } {
  const body = requireRecord(result.payload, result.http, "Batch");
  if (typeof body.batch_id !== "string" || body.batch_id.length === 0) {
    throw new APIProtocolError("Batch response is missing batch_id", {
      ...requestIds(result.http),
      body,
    });
  }
  return { ...(body as Batch), http: result.http };
}

async function toWireRequest(request: BatchRequest, signal?: AbortSignal): Promise<unknown> {
  const { batch_request } = request;
  if (!("responses" in batch_request)) return request;
  const input = await inlineBlobs(batch_request.responses.input, signal);
  return {
    ...request,
    batch_request: { responses: applyCreateDefaults({ ...batch_request.responses, input }) },
  };
}

export class Batches {
  readonly requests: BatchRequests;

  constructor(private readonly client: xAI) {
    this.requests = new BatchRequests(client);
  }

  async create(body: BatchCreateParams, opts?: RequestOpts): Promise<Batch & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: "/batches",
      body,
      opts,
    });
    return toBatch(result);
  }

  list(
    query: { limit?: number; pagination_token?: string } = {},
    opts?: RequestOpts,
  ): PagePromise<BatchList & { http: HttpMeta }, Batch> {
    return tokenPages(
      query,
      async (pageQuery) => {
        const result = await send(this.client, {
          method: "GET",
          path: "/batches",
          query: pageQuery,
          opts,
        });
        const body = requireRecord(result.payload, result.http, "Batch list");
        if (!Array.isArray(body.batches)) {
          throw new APIProtocolError("Batch list is missing batches", {
            ...requestIds(result.http),
            body,
          });
        }
        return { ...(body as BatchList), http: result.http };
      },
      (page) => page.batches,
    );
  }

  async get(batchId: string, opts?: RequestOpts): Promise<Batch & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/batches/${encodeURIComponent(batchId)}`,
      opts,
    });
    return toBatch(result);
  }

  async cancel(batchId: string, opts?: RequestOpts): Promise<Batch & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: `/batches/${encodeURIComponent(batchId)}:cancel`,
      opts,
    });
    return toBatch(result);
  }

  results(
    batchId: string,
    query: { limit?: number; pagination_token?: string } = {},
    opts?: RequestOpts,
  ): PagePromise<BatchResultList & { http: HttpMeta }, BatchResult> {
    return tokenPages(
      query,
      async (pageQuery) => {
        const result = await send(this.client, {
          method: "GET",
          path: `/batches/${encodeURIComponent(batchId)}/results`,
          query: pageQuery,
          opts,
        });
        const body = requireRecord(result.payload, result.http, "Batch result list");
        if (!Array.isArray(body.results)) {
          throw new APIProtocolError("Batch result list is missing results", {
            ...requestIds(result.http),
            body,
          });
        }
        return { ...(body as BatchResultList), http: result.http };
      },
      (page) => page.results,
    );
  }

  /**
   * Poll `get()` until no requests are pending. After `timeout`, rejects with
   * `TimeoutError` while the batch keeps processing on the server.
   */
  async wait(batchId: string, opts: BatchWaitOptions = {}): Promise<Batch & { http: HttpMeta }> {
    const { interval = DEFAULT_WAIT_INTERVAL_MS, timeout = DEFAULT_WAIT_TIMEOUT_MS } = opts;
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      deadline.abort(new TimeoutError(`Batch ${batchId} did not finish within ${timeout}ms`));
    }, timeout);
    const signal = combineSignals([opts.signal, deadline.signal]);
    try {
      while (true) {
        const batch = await this.get(batchId, { signal });
        if (batch.state.num_pending === 0) return batch;
        await sleep(interval, signal);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export class BatchRequests {
  constructor(private readonly client: xAI) {}

  /**
   * `responses` requests are sent like `responses.create()` bodies: `Blob` images are
   * inlined and `store` defaults to false.
   */
  async add(
    batchId: string,
    body: { batch_requests: Array<BatchRequest> },
    opts?: RequestOpts,
  ): Promise<{ http: HttpMeta }> {
    const batch_requests = await Promise.all(
      body.batch_requests.map((request) => toWireRequest(request, opts?.signal)),
    );
    const result = await send(this.client, {
      method: "POST",
      path: `/batches/${encodeURIComponent(batchId)}/requests`,
      body: { ...body, batch_requests },
      opts,
    });
    return { http: result.http };
  }

  list(
    batchId: string,
    query: { limit?: number; pagination_token?: string } = {},
    opts?: RequestOpts,
  ): PagePromise<BatchRequestMetadataList & { http: HttpMeta }, BatchRequestMetadata> {
    return tokenPages(
      query,
      async (pageQuery) => {
        const result = await send(this.client, {
          method: "GET",
          path: `/batches/${encodeURIComponent(batchId)}/requests`,
          query: pageQuery,
          opts,
        });
        const body = requireRecord(result.payload, result.http, "Batch request list");
        if (!Array.isArray(body.batch_request_metadata)) {
          throw new APIProtocolError("Batch request list is missing batch_request_metadata", {
            ...requestIds(result.http),
            body,
          });
        }
        return { ...(body as BatchRequestMetadataList), http: result.http };
      },
      (page) => page.batch_request_metadata,
    );
  }
}
