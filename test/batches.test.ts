import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AbortError,
  APIProtocolError,
  type BatchRequest,
  type InputItem,
  NotFoundError,
  TimeoutError,
  xAI,
} from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

const batch = {
  batch_id: "batch_1934e8b5-f3dc-45f1-8329-9841b0aee9d8",
  name: "My New Batch",
  create_time: "2025-11-11",
  expire_time: "2025-11-12",
  create_api_key_id: "key_123",
  cancel_time: null,
  cancel_by_xai_message: null,
  state: { num_requests: 0, num_pending: 0, num_success: 0, num_error: 0, num_cancelled: 0 },
};

const chatCompletion = {
  id: "e7c2162b-ca73-c181-2364-1feabef778fe_us-east-1",
  object: "chat.completion",
  created: 1_762_801_725,
  model: "grok-4",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "101 multiplied by 3 is 303.", refusal: null },
      finish_reason: "stop",
    },
  ],
  system_fingerprint: "fp_1944a19e1f",
};

function client(fetch: typeof globalThis.fetch): xAI {
  return new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

async function jsonBody(request: Request | undefined): Promise<Record<string, unknown>> {
  return (await request?.json()) as Record<string, unknown>;
}

function withPending(num_pending: number) {
  return { ...batch, state: { ...batch.state, num_requests: 2, num_pending } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("batches", () => {
  it("creates a batch by name or from an uploaded file", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(batch));
    const c = client(fetch);
    const res = await c.batches.create({ name: "My New Batch" });
    await c.batches.create({ name: "sentiment_analysis", input_file_id: "file-abc123" });

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://api.x.ai/v1/batches",
      "POST https://api.x.ai/v1/batches",
    ]);
    expect(await jsonBody(captured.requests[0])).toEqual({ name: "My New Batch" });
    expect(await jsonBody(captured.requests[1])).toEqual({
      name: "sentiment_analysis",
      input_file_id: "file-abc123",
    });
    expect(res).toEqual({ ...batch, http: res.http });
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
  });

  it("gets a batch and cancels it with the :cancel suffix after the encoded ID", async () => {
    const cancelled = {
      ...batch,
      cancel_time: "2025-11-11",
      state: { ...batch.state, num_requests: 1, num_success: 1 },
    };
    const { fetch, captured } = mockFetch((req) =>
      jsonResponse(req.method === "POST" ? cancelled : batch),
    );
    const c = client(fetch);
    const got = await c.batches.get(batch.batch_id);
    const res = await c.batches.cancel(batch.batch_id);
    await c.batches.cancel("team/batch:1");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET https://api.x.ai/v1/batches/${batch.batch_id}`,
      `POST https://api.x.ai/v1/batches/${batch.batch_id}:cancel`,
      "POST https://api.x.ai/v1/batches/team%2Fbatch%3A1:cancel",
    ]);
    expect(captured.requests[1]?.body).toBeNull();
    expect(got.state).toEqual(batch.state);
    expect(res.cancel_time).toBe("2025-11-11");
    expect(res.state.num_success).toBe(1);
  });

  it("lists batches with pagination", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ batches: [batch], pagination_token: "page_2" }),
    );
    const c = client(fetch);
    const page = await c.batches.list({ limit: 20, pagination_token: "page_1" });
    await c.batches.list();

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/batches?limit=20&pagination_token=page_1",
      "GET https://api.x.ai/v1/batches",
    ]);
    expect(page.batches).toEqual([batch]);
    expect(page.pagination_token).toBe("page_2");
    expect(page.http.requestId).toBe("req_test");
  });

  it("lists results with pagination", async () => {
    const results = [
      {
        batch_request_id: "test_request_0",
        batch_result: { response: { chat_get_completion: chatCompletion } },
      },
      {
        batch_request_id: "test_request_1",
        batch_result: { error: "Model is not supported for batch processing" },
      },
    ];
    const { fetch, captured } = mockFetch(() => jsonResponse({ results, pagination_token: null }));
    const c = client(fetch);
    const page = await c.batches.results("team/batch", { limit: 100, pagination_token: "page_2" });
    await c.batches.results(batch.batch_id);

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/batches/team%2Fbatch/results?limit=100&pagination_token=page_2",
      `GET https://api.x.ai/v1/batches/${batch.batch_id}/results`,
    ]);
    expect(page.results).toEqual(results);
    expect(page.pagination_token).toBeNull();
    expect(page.http.status).toBe(200);
  });
});

describe("batches.wait", () => {
  it("polls every 5 seconds until no requests are pending", async () => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch((_req, n) => jsonResponse(withPending(n < 3 ? 1 : 0)));
    const pending = client(fetch).batches.wait(batch.batch_id);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(captured.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(captured.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await pending;

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual(
      Array(3).fill(`GET https://api.x.ai/v1/batches/${batch.batch_id}`),
    );
    expect(res.state).toEqual(withPending(0).state);
    expect(res.http.requestId).toBe("req_test");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with TimeoutError after 24 hours by default and stops polling", async () => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => jsonResponse(withPending(1)));
    const pending = client(fetch).batches.wait(batch.batch_id, { interval: 3_600_000 });
    const rejection = expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TimeoutError &&
        error.message === `Batch ${batch.batch_id} did not finish within 86400000ms`,
    );

    await vi.advanceTimersByTimeAsync(86_399_999);
    expect(captured.requests).toHaveLength(24);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(captured.requests).toHaveLength(24);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with AbortError when the signal aborts between polls", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const { fetch, captured } = mockFetch(() => jsonResponse(withPending(1)));
    const pending = client(fetch).batches.wait(batch.batch_id, {
      interval: 1_000,
      signal: ac.signal,
    });
    const rejection = expect(pending).rejects.toBeInstanceOf(AbortError);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(captured.requests).toHaveLength(3);
    ac.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(captured.requests).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling when a poll fails", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ code: "not-found", error: "Batch not found" }, { status: 404 }),
    );
    await expect(client(fetch).batches.wait("batch_missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(captured.requests).toHaveLength(1);
  });
});

describe("batches.requests", () => {
  it("adds image and video requests unchanged", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse({}));
    const batchRequests = [
      {
        batch_request_id: "img_edit_001",
        batch_request: {
          image_edit: {
            model: "grok-imagine-image-2.0",
            prompt: "Add a rainbow in the background",
            image: { url: "https://picsum.photos/800" },
          },
        },
      },
      {
        batch_request: {
          video_extension: {
            model: "grok-imagine-video",
            prompt: "The camera slowly pans to reveal a sunset behind the mountains",
            video: { url: "https://lorem.video/cat_360p_3s" },
            duration: 6,
          },
        },
      },
    ] satisfies BatchRequest[];
    const res = await client(fetch).batches.requests.add(batch.batch_id, {
      batch_requests: batchRequests,
    });

    const request = captured.requests[0];
    expect(captured.requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(`https://api.x.ai/v1/batches/${batch.batch_id}/requests`);
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(await jsonBody(request)).toEqual({ batch_requests: batchRequests });
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
  });

  it("prepares responses requests like responses.create", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse({}));
    const image = new Blob(["png-bytes"], { type: "image/png" });
    const message = {
      role: "user",
      content: [
        { type: "input_text", text: "Classify the sentiment of this review." },
        { type: "input_image", image },
      ],
    } satisfies InputItem;
    await client(fetch).batches.requests.add(batch.batch_id, {
      batch_requests: [
        {
          batch_request_id: "feedback_001",
          batch_request: { responses: { model: "grok-4.3", input: [message] } },
        },
        {
          batch_request: {
            responses: { model: "grok-4.3", input: "Shipping took way too long.", store: true },
          },
        },
      ],
    });

    expect(await jsonBody(captured.requests[0])).toEqual({
      batch_requests: [
        {
          batch_request_id: "feedback_001",
          batch_request: {
            responses: {
              model: "grok-4.3",
              input: [
                {
                  role: "user",
                  content: [
                    { type: "input_text", text: "Classify the sentiment of this review." },
                    { type: "input_image", image_url: `data:image/png;base64,${btoa("png-bytes")}` },
                  ],
                },
              ],
              store: false,
              include: ["reasoning.encrypted_content"],
              stream: false,
            },
          },
        },
        {
          batch_request: {
            responses: {
              model: "grok-4.3",
              input: "Shipping took way too long.",
              store: true,
              stream: false,
            },
          },
        },
      ],
    });
    expect(message.content[1]).toEqual({ type: "input_image", image });
  });

  it("lists request metadata with pagination", async () => {
    const metadata = {
      batch_request_id: "test_request_0",
      endpoint: "xai_api.Chat/GetCompletion",
      model: "grok-4",
      state: "succeeded",
      create_time: "2025-11-11",
      finish_time: "2025-11-12",
    };
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ batch_request_metadata: [metadata], pagination_token: "page_2" }),
    );
    const c = client(fetch);
    const page = await c.batches.requests.list("team/batch", { limit: 50, pagination_token: "page_1" });
    await c.batches.requests.list(batch.batch_id);

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/batches/team%2Fbatch/requests?limit=50&pagination_token=page_1",
      `GET https://api.x.ai/v1/batches/${batch.batch_id}/requests`,
    ]);
    expect(page.batch_request_metadata).toEqual([metadata]);
    expect(page.pagination_token).toBe("page_2");
    expect(page.http.requestId).toBe("req_test");
  });
});

describe("batch response validation", () => {
  it.each<[string, (c: xAI) => Promise<unknown>, unknown, string]>([
    [
      "a non-object batch",
      (c) => c.batches.create({ name: "My New Batch" }),
      "not json",
      "Batch must be a JSON object",
    ],
    [
      "a batch without batch_id",
      (c) => c.batches.get(batch.batch_id),
      { ...batch, batch_id: undefined },
      "Batch response is missing batch_id",
    ],
    [
      "a cancelled batch with an empty batch_id",
      (c) => c.batches.cancel(batch.batch_id),
      { ...batch, batch_id: "" },
      "Batch response is missing batch_id",
    ],
    [
      "a batch list without batches",
      (c) => c.batches.list(),
      { pagination_token: null },
      "Batch list is missing batches",
    ],
    [
      "a result list without results",
      (c) => c.batches.results(batch.batch_id),
      { results: {} },
      "Batch result list is missing results",
    ],
    [
      "a request list without batch_request_metadata",
      (c) => c.batches.requests.list(batch.batch_id),
      { batch_request_metadata: null, pagination_token: null },
      "Batch request list is missing batch_request_metadata",
    ],
  ])("rejects %s", async (_label, call, payload, message) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    const pending = call(client(fetch));
    await expect(pending).rejects.toBeInstanceOf(APIProtocolError);
    await expect(pending).rejects.toMatchObject({ message, requestId: "req_test" });
  });
});
