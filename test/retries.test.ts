import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelResponse, SpaceXAI } from "../src/index.js";
import { completedResponse, createBody, erroringSse, jsonResponse, mockFetch, sseResponse } from "./helpers.js";

describe("retries", () => {
  it("retries HTTP 429 before any SSE bytes, honoring Retry-After", async () => {
    const { fetch, captured } = mockFetch((_req, n) => {
      if (n === 1) {
        return jsonResponse(
          { error: { message: "rate limited" } },
          { status: 429, headers: { "retry-after": "0" } },
        );
      }
      return sseResponse([{ type: "response.completed", response: completedResponse }]);
    });
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const types: Array<string> = [];
    for await (const event of stream) types.push(event.type);
    expect(captured.requests).toHaveLength(2);
    expect(types).toContain("response.completed");
  });

  it("does not retry POST after HTTP 200 when the stream errors before the first SSE byte", async () => {
    const { fetch, captured } = mockFetch(() => erroringSse(true));
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2 });
    await expect(client.responses.create({ ...createBody, stream: true })).rejects.toThrow();
    expect(captured.requests).toHaveLength(1);
  });

  it("does not retry after the first SSE byte", async () => {
    const { fetch, captured } = mockFetch(() => erroringSse(false));
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    await expect(async () => {
      for await (const _ of stream) {
        // drain
      }
    }).rejects.toThrow();
    expect(captured.requests).toHaveLength(1);
  });

  it("does not retry a create rejected with 529", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse(
        { error: { message: "overloaded" } },
        { status: 529, headers: { "retry-after": "0" } },
      ),
    );
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2 });
    await expect(client.responses.create(createBody)).rejects.toMatchObject({ status: 529 });
    expect(captured.requests).toHaveLength(1);
  });
});

describe("retryBeforeOutput", () => {
  const created = { type: "response.created", response: { id: "resp_failed", status: "in_progress", output: [] } };
  const unavailable = { type: "error", code: 503, message: "Service temporarily unavailable" };
  const delta = { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hello world" };
  const succeeded = [
    { type: "response.created", response: { id: "resp_123", status: "in_progress", output: [] } },
    delta,
    { type: "response.completed", response: completedResponse },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is off by default", async () => {
    const { fetch, captured } = mockFetch(() => sseResponse([created, unavailable]));
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    await expect(stream.done()).rejects.toMatchObject({ status: 503 });
    expect(captured.requests).toHaveLength(1);
  });

  it("retries a stream that fails before any output, without showing the failed attempt", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetch, captured } = mockFetch((_req, n) =>
      n === 1
        ? sseResponse([created, unavailable], { headers: { "x-request-id": "req_1" } })
        : sseResponse(succeeded, { headers: { "x-request-id": "req_2" } }),
    );
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2, retryBeforeOutput: true });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const types: Array<string> = [];
    for await (const event of stream) types.push(event.type);
    expect(types).toEqual(succeeded.map((event) => event.type));
    expect(captured.requests).toHaveLength(2);
    expect(stream.http.requestId).toBe("req_2");
    const [first, second] = captured.requests.map((req) => req.headers.get("x-client-request-id"));
    expect(second).toBe(first);
  });

  it("doesn't retry once output has started", async () => {
    const { fetch, captured } = mockFetch(() => sseResponse([created, delta, unavailable]));
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2, retryBeforeOutput: true });
    const stream = await client.responses.create({ ...createBody, stream: true });
    await expect(stream.done()).rejects.toMatchObject({ status: 503 });
    expect(captured.requests).toHaveLength(1);
  });

  it("gives up after maxRetries and reports the last error", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetch, captured } = mockFetch(() => sseResponse([created, unavailable]));
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 1, retryBeforeOutput: true });
    const stream = await client.responses.create({ ...createBody, stream: true });
    await expect(stream.done()).rejects.toMatchObject({ status: 503 });
    expect(captured.requests).toHaveLength(2);
  });

  it("shares one budget between HTTP retries and stream retries", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetch, captured } = mockFetch((_req, n) =>
      n === 2
        ? jsonResponse({ error: { message: "rate limited" } }, { status: 429, headers: { "retry-after": "0" } })
        : sseResponse([created, unavailable]),
    );
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2, retryBeforeOutput: true });
    const stream = await client.responses.create({ ...createBody, stream: true });
    await expect(stream.done()).rejects.toMatchObject({ status: 503 });
    expect(captured.requests).toHaveLength(3);
  });

  it("doesn't retry a 5xx response to a stream: false request", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ error: { message: "unavailable" } }, { status: 503, headers: { "retry-after": "0" } }),
    );
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2, retryBeforeOutput: true });
    await expect(client.responses.create({ ...createBody, stream: false })).rejects.toMatchObject({ status: 503 });
    expect(captured.requests).toHaveLength(1);
  });

  it("retries create() without stream after a 503 status, a dropped connection, and an early stream error", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetch, captured } = mockFetch((_req, n) => {
      if (n === 1) {
        return jsonResponse({ error: { message: "unavailable" } }, { status: 503, headers: { "retry-after": "0" } });
      }
      if (n === 2) return erroringSse(false);
      if (n === 3) return sseResponse([created, unavailable]);
      return sseResponse(succeeded);
    });
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 3 });
    const response = await client.responses.create(createBody, { retryBeforeOutput: true });
    expect(response.toText()).toBe("Hello world");
    expect(captured.requests).toHaveLength(4);
  });

  it("accepts a JSON response when it retries create() without stream", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetch, captured } = mockFetch((_req, n) =>
      n === 1
        ? sseResponse([created], { headers: { "x-request-id": "req_1" } })
        : jsonResponse(completedResponse, { headers: { "x-request-id": "req_2" } }),
    );
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2, retryBeforeOutput: true });
    const response = await client.responses.create(createBody);
    expect(response).toBeInstanceOf(ModelResponse);
    expect(response.toText()).toBe("Hello world");
    expect(response.http.requestId).toBe("req_2");
    expect(captured.requests).toHaveLength(2);
  });

  it("still requires an event stream when it retries a stream: true request", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetch, captured } = mockFetch((_req, n) =>
      n === 1 ? sseResponse([created]) : jsonResponse(completedResponse),
    );
    const client = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 2, retryBeforeOutput: true });
    const stream = await client.responses.create({ ...createBody, stream: true });
    await expect(stream.done()).rejects.toMatchObject({
      name: "APIProtocolError",
      message: "Streaming response must use text/event-stream",
    });
    expect(captured.requests).toHaveLength(2);
  });
});
