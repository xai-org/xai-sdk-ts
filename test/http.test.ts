import { describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import {
  APIConnectionError,
  APIError,
  APIProtocolError,
  TimeoutError,
  xAI,
} from "../src/index.js";
import { formatCurl, retryDelayMs, shouldRetryStatus } from "../src/http.js";
import { completedResponse, createBody, jsonResponse, mockFetch } from "./helpers.js";

describe("http helpers", () => {
  it("retries 429 on POST but not 500", () => {
    expect(shouldRetryStatus("POST", 429)).toBe(true);
    expect(shouldRetryStatus("POST", 408)).toBe(false);
    expect(shouldRetryStatus("POST", 500)).toBe(false);
    expect(shouldRetryStatus("POST", 529)).toBe(false);
    expect(shouldRetryStatus("GET", 408)).toBe(true);
    expect(shouldRetryStatus("GET", 500)).toBe(true);
    expect(shouldRetryStatus("GET", 529)).toBe(true);
    expect(shouldRetryStatus("DELETE", 502)).toBe(false);
    expect(shouldRetryStatus("POST", 409)).toBe(false);
  });

  it("honors Retry-After HTTP-date and integer seconds", () => {
    expect(retryDelayMs(0, "0")).toBe(0);
    expect(retryDelayMs(0, "1.5")).toBe(1500);
    const future = new Date(Date.now() + 2_000).toUTCString();
    const delay = retryDelayMs(0, future);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  it("redacts credentials and omits request bodies in XAI_DEBUG curl", () => {
    const headers = new Headers({
      authorization: "Bearer secret-key",
      cookie: "sid=abc",
      "x-demo-secret": "demo",
      "x-auth-token": "token",
      "x-api-key": "other",
      accept: "application/json",
    });
    const userinfo = ["fixture-user", "fixture-password"].join(":");
    const curl = formatCurl(
      "POST",
      `https://${userinfo}@api.x.ai/v1/responses?api_key=leak`,
      headers,
      '{"prompt":"sensitive-prompt"}',
    );
    expect(curl).toContain("Bearer [REDACTED]");
    expect(curl).toContain("cookie: [REDACTED]");
    expect(curl).toContain("x-demo-secret: [REDACTED]");
    expect(curl).toContain("x-auth-token: [REDACTED]");
    expect(curl).toContain("x-api-key: [REDACTED]");
    expect(curl).not.toContain("secret-key");
    expect(curl).not.toContain("sid=abc");
    expect(curl).toContain("[REDACTED]");
    expect(curl).toContain("accept: application/json");
    expect(curl).toContain("Request body omitted");
    expect(curl).not.toContain("sensitive-prompt");
  });
});

describe("http send", () => {
  it("retries a connection failure for an idempotent request", async () => {
    const { fetch, captured } = mockFetch((_req, n) => {
      if (n === 1) throw new TypeError("fetch failed");
      return jsonResponse({
        object: "list",
        data: [{ id: "grok-4.6", object: "model", created: 1, owned_by: "xai" }],
      });
    });
    const res = await new xAI({ apiKey: "k", fetch, maxRetries: 2 }).models.list();
    expect(res.data[0]?.id).toBe("grok-4.6");
    expect(captured.requests).toHaveLength(2);
  });

  it("does not retry an ambiguous create connection failure", async () => {
    const { fetch, captured } = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    try {
      await new xAI({ apiKey: "k", fetch, maxRetries: 1 }).responses.create(createBody);
      throw new Error("expected failure");
    } catch (err) {
      expect(err).toBeInstanceOf(APIConnectionError);
      expect(APIError.is(err)).toBe(true);
    }
    expect(captured.requests).toHaveLength(1);
  });

  it("does not retry POST 500", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ error: { message: "boom" } }, { status: 500 }),
    );
    await expect(
      new xAI({ apiKey: "k", fetch, maxRetries: 2 }).responses.create(createBody),
    ).rejects.toMatchObject({ status: 500 });
    expect(captured.requests).toHaveLength(1);
  });

  it("does not retry JSON body failure after HTTP 200", async () => {
    let reads = 0;
    const { fetch, captured } = mockFetch(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              reads += 1;
              if (reads === 1) controller.enqueue(new TextEncoder().encode(`{"id":`));
              else controller.error(new TypeError("socket hang up"));
            },
          }),
          { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_test" } },
        ),
    );
    await expect(
      new xAI({ apiKey: "k", fetch, maxRetries: 2 }).responses.create(createBody),
    ).rejects.toBeInstanceOf(APIConnectionError);
    expect(captured.requests).toHaveLength(1);
  });

  it("bounds successful and error response bodies", async () => {
    const success = mockFetch(() =>
      new Response("x".repeat(32), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req_success" },
      }),
    );
    await expect(
      new xAI({
        apiKey: "k",
        fetch: success.fetch,
        maxRetries: 0,
        maxResponseBodyBytes: 16,
      }).responses.create(createBody),
    ).rejects.toBeInstanceOf(APIProtocolError);

    const failure = mockFetch(() =>
      new Response("x".repeat(32), {
        status: 400,
        headers: { "content-type": "text/plain", "x-request-id": "req_error" },
      }),
    );
    await expect(
      new xAI({
        apiKey: "k",
        fetch: failure.fetch,
        maxRetries: 0,
        maxResponseBodyBytes: 16,
      }).responses.create(createBody),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });

  it("times out the overall request as TimeoutError", async () => {
    const { fetch } = mockFetch(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(jsonResponse(completedResponse)), 5_000);
        }),
    );
    await expect(
      new xAI({ apiKey: "k", fetch, maxRetries: 0, timeout: 20 }).responses.create(createBody),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("applies the timeout while an onRequest hook is running", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    const client = new xAI({
      apiKey: "k",
      fetch,
      maxRetries: 0,
      timeout: 20,
      onRequest: async () => new Promise(() => {}),
    });
    await expect(client.responses.create(createBody)).rejects.toBeInstanceOf(TimeoutError);
    expect(captured.requests).toHaveLength(0);
  });

  it("does not let a failing onResponse hook mask or retry an HTTP error", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ error: { message: "bad key" } }, { status: 401 }),
    );
    const client = new xAI({
      apiKey: "k",
      fetch,
      maxRetries: 2,
      onResponse: () => {
        throw new Error("hook failed");
      },
    });
    await expect(client.responses.create(createBody)).rejects.toMatchObject({
      name: "AuthenticationError",
      status: 401,
      message: "bad key",
    });
    expect(captured.requests).toHaveLength(1);
  });

  it("does not let a timed-out onResponse hook mask an HTTP error", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ error: { message: "bad key" } }, { status: 401 }),
    );
    const client = new xAI({
      apiKey: "k",
      fetch,
      maxRetries: 2,
      timeout: 20,
      onResponse: async () => new Promise(() => {}),
    });
    await expect(client.responses.create(createBody)).rejects.toMatchObject({
      name: "AuthenticationError",
      status: 401,
      message: "bad key",
    });
    expect(captured.requests).toHaveLength(1);
  });

  it("treats DELETE 204 as deleted", async () => {
    const { fetch } = mockFetch(() => new Response(null, { status: 204, headers: { "x-request-id": "req_test" } }));
    const res = await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.delete("resp_123");
    expect(res.deleted).toBe(true);
    expect(res.id).toBe("resp_123");
    expect(res.http.status).toBe(204);
  });

  it("does not expose apiKey on the client or inspect output", () => {
    const { fetch } = mockFetch(() => jsonResponse(completedResponse));
    const client = new xAI({ apiKey: "super-secret", fetch });
    expect(Object.keys(client)).not.toContain("apiKey");
    expect("apiKey" in client).toBe(false);
    expect(inspect(client)).not.toContain("super-secret");
  });

  it("does not copy __proto__ from wire JSON onto the response instance", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({
        ...completedResponse,
        toText: "shadowed",
      }),
    );
    const res = await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    expect(typeof res.toText).toBe("function");
    expect(res.toText()).toBe("Hello world");
  });
});

describe("retryDelayMs jitter", () => {
  it("uses Math.random for exponential backoff when Retry-After is absent", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(retryDelayMs(0, null)).toBe(187.5);
    vi.restoreAllMocks();
  });
});
