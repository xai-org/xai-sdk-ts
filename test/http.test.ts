import { describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import {
  APIConnectionError,
  APIError,
  APIProtocolError,
  AbortError,
  TimeoutError,
  SpaceXAI,
} from "../src/index.js";
import { formatCurl, retryDelayMs, send, shouldRetryStatus } from "../src/http.js";
import {
  completedResponse,
  createBody,
  erroringSse,
  jsonResponse,
  mockFetch,
  sseResponse,
} from "./helpers.js";

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
    expect(shouldRetryStatus("POST", 503, true)).toBe(true);
    expect(shouldRetryStatus("POST", 400, true)).toBe(false);
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
    const multipartCurl = formatCurl("POST", "https://api.x.ai/v1/files", headers, new FormData());
    expect(multipartCurl).toContain("Request body omitted");
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
    const res = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 2 }).models.list();
    expect(res.data[0]?.id).toBe("grok-4.6");
    expect(captured.requests).toHaveLength(2);
  });

  it("does not retry an ambiguous create connection failure", async () => {
    const { fetch, captured } = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    try {
      await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 1 }).responses.create(createBody);
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
      new SpaceXAI({ apiKey: "k", fetch, maxRetries: 2 }).responses.create(createBody),
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
      new SpaceXAI({ apiKey: "k", fetch, maxRetries: 2 }).responses.create(createBody),
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
      new SpaceXAI({
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
      new SpaceXAI({
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
      new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0, timeout: 20 }).responses.create(createBody),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("applies the timeout while an onRequest hook is running", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    const client = new SpaceXAI({
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
    const client = new SpaceXAI({
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
    const client = new SpaceXAI({
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
    const res = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.delete("resp_123");
    expect(res.deleted).toBe(true);
    expect(res.id).toBe("resp_123");
    expect(res.http.status).toBe(204);
  });

  it("does not expose apiKey on the client or inspect output", () => {
    const { fetch } = mockFetch(() => jsonResponse(completedResponse));
    const client = new SpaceXAI({ apiKey: "super-secret", fetch });
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
    const res = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    expect(typeof res.toText).toBe("function");
    expect(res.toText()).toBe("Hello world");
  });
});

describe("client request IDs", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const sentId = (captured: { requests: Array<Request> }, index = 0) =>
    captured.requests[index]?.headers.get("x-client-request-id");

  it("sends a UUID and exposes it on the response", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    const res = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    expect(sentId(captured)).toMatch(UUID);
    expect(res.http.clientRequestId).toBe(sentId(captured));
  });

  it("reuses one ID across retries and generates a new one per call", async () => {
    const { fetch, captured } = mockFetch((_req, n) =>
      n === 1
        ? jsonResponse({ error: { message: "slow down" } }, { status: 429, headers: { "retry-after": "0" } })
        : jsonResponse(completedResponse),
    );
    const client = new SpaceXAI({ apiKey: "k", fetch, maxRetries: 1 });
    await client.responses.create(createBody);
    await client.responses.create(createBody);
    expect(captured.requests).toHaveLength(3);
    expect(sentId(captured, 1)).toBe(sentId(captured, 0));
    expect(sentId(captured, 2)).not.toBe(sentId(captured, 0));
  });

  it("uses an ID from the caller's headers", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    const client = new SpaceXAI({
      apiKey: "k",
      fetch,
      maxRetries: 0,
      defaultHeaders: { "x-client-request-id": "from-defaults" },
    });
    const fromDefaults = await client.responses.create(createBody);
    const fromRequest = await client.responses.create(createBody, {
      headers: { "X-Client-Request-Id": "from-request" },
    });
    expect([sentId(captured, 0), sentId(captured, 1)]).toEqual(["from-defaults", "from-request"]);
    expect(fromDefaults.http.clientRequestId).toBe("from-defaults");
    expect(fromRequest.http.clientRequestId).toBe("from-request");
  });

  it("attaches the ID to errors, including when no response arrives", async () => {
    const offline = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const connectionError = await new SpaceXAI({ apiKey: "k", fetch: offline.fetch, maxRetries: 0 })
      .responses.create(createBody)
      .catch((err: unknown) => err);
    expect(connectionError).toBeInstanceOf(APIConnectionError);
    expect(connectionError).toMatchObject({ requestId: null, clientRequestId: sentId(offline.captured) });

    const slow = mockFetch(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(jsonResponse(completedResponse)), 5_000);
        }),
    );
    const timeoutError = await new SpaceXAI({ apiKey: "k", fetch: slow.fetch, maxRetries: 0, timeout: 20 })
      .responses.create(createBody)
      .catch((err: unknown) => err);
    expect(timeoutError).toBeInstanceOf(TimeoutError);
    expect(timeoutError).toMatchObject({ clientRequestId: sentId(slow.captured) });

    const rejected = mockFetch(() => jsonResponse({ error: { message: "bad input" } }, { status: 400 }));
    const statusError = await new SpaceXAI({ apiKey: "k", fetch: rejected.fetch, maxRetries: 0 })
      .responses.create(createBody)
      .catch((err: unknown) => err);
    expect(statusError).toMatchObject({
      status: 400,
      requestId: "req_test",
      clientRequestId: sentId(rejected.captured),
    });

    const malformed = mockFetch(() => jsonResponse({ object: "response" }));
    const protocolError = await new SpaceXAI({ apiKey: "k", fetch: malformed.fetch, maxRetries: 0 })
      .responses.create(createBody)
      .catch((err: unknown) => err);
    expect(protocolError).toBeInstanceOf(APIProtocolError);
    expect(protocolError).toMatchObject({ requestId: "req_test", clientRequestId: sentId(malformed.captured) });
  });

  it("attaches the ID to stream errors and error events", async () => {
    const dropped = mockFetch(() => erroringSse(false));
    const stream = await new SpaceXAI({ apiKey: "k", fetch: dropped.fetch, maxRetries: 0 }).responses.create({
      ...createBody,
      stream: true,
    });
    expect(stream.http.clientRequestId).toBe(sentId(dropped.captured));
    const streamError = await (async () => {
      for await (const _ of stream) {
        // Drain until the connection drops.
      }
    })().catch((err: unknown) => err);
    expect(streamError).toMatchObject({ requestId: "req_test", clientRequestId: sentId(dropped.captured) });

    const failed = mockFetch(() => sseResponse([{ type: "error", code: 500, message: "boom" }]));
    const failing = await new SpaceXAI({ apiKey: "k", fetch: failed.fetch, maxRetries: 0 }).responses.create({
      ...createBody,
      stream: true,
    });
    await expect(failing.done()).rejects.toMatchObject({ clientRequestId: sentId(failed.captured) });
  });
});

describe("multipart requests and binary responses", () => {
  const download = { method: "GET", path: "/files/file_1/content", binary: true };

  function octetStream(body: BodyInit): Response {
    return new Response(body, {
      headers: { "content-type": "application/octet-stream", "x-request-id": "req_test" },
    });
  }

  function hangingBody(onCancel?: () => void): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel: onCancel,
    });
  }

  it("sends FormData as multipart on every attempt", async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x10, 0x80]);
    const form = new FormData();
    form.append("file", new Blob([bytes]), "data.bin");
    const { fetch, captured } = mockFetch((_req, n) => {
      if (n === 1) {
        return jsonResponse(
          { error: { message: "rate limited" } },
          { status: 429, headers: { "retry-after": "0" } },
        );
      }
      return jsonResponse({ id: "file_1" });
    });
    const result = await send(new SpaceXAI({ apiKey: "k", fetch, maxRetries: 1 }), {
      method: "POST",
      path: "/files",
      body: form,
    });
    expect(result.payload).toEqual({ id: "file_1" });
    expect(captured.requests).toHaveLength(2);
    for (const request of captured.requests) {
      expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
      const file = (await request.formData()).get("file");
      expect(file).toBeInstanceOf(File);
      expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(bytes);
    }
  });

  it("returns binary bodies byte-for-byte without the JSON size cap", async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x80]);
    const { fetch, captured } = mockFetch(() => octetStream(bytes));
    const result = await send(
      new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0, maxResponseBodyBytes: 2 }),
      download,
    );
    expect(captured.requests[0]?.headers.get("accept")).toBe("*/*");
    expect(result.http.requestId).toBe("req_test");
    expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(bytes);
  });

  it("keeps a caller accept header on binary requests", async () => {
    const { fetch, captured } = mockFetch(() => octetStream("ID3"));
    await send(new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }), {
      ...download,
      opts: { headers: { accept: "audio/mpeg" } },
    });
    expect(captured.requests[0]?.headers.get("accept")).toBe("audio/mpeg");
  });

  it("returns a null body for a binary 204 response", async () => {
    const { fetch } = mockFetch(() => new Response(null, { status: 204, headers: { "x-request-id": "req_test" } }));
    const result = await send(new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }), download);
    expect(result.http.status).toBe(204);
    expect(result.body).toBeNull();
  });

  it("times out an idle binary body and cancels it", async () => {
    let cancelled = false;
    const body = hangingBody(() => {
      cancelled = true;
    });
    const { fetch } = mockFetch(() => octetStream(body));
    const result = await send(
      new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0, idleTimeout: 20 }),
      download,
    );
    await expect(new Response(result.body).arrayBuffer()).rejects.toBeInstanceOf(TimeoutError);
    expect(cancelled).toBe(true);
  });

  it("attaches the client request ID when a binary body fails mid-read", async () => {
    const { fetch, captured } = mockFetch(() => octetStream(hangingBody()));
    const file = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0, idleTimeout: 20 }).files.content("file_1");
    await expect(file.arrayBuffer()).rejects.toMatchObject({
      name: "TimeoutError",
      clientRequestId: captured.requests[0]?.headers.get("x-client-request-id"),
    });
  });

  it("aborts a binary body mid-read", async () => {
    const ac = new AbortController();
    const { fetch } = mockFetch(() => octetStream(hangingBody()));
    const result = await send(new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }), {
      ...download,
      opts: { signal: ac.signal },
    });
    const reader = result.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
    const next = reader.read();
    ac.abort();
    await expect(next).rejects.toBeInstanceOf(AbortError);
  });

  it("maps error statuses on binary requests to the usual error classes", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ error: { message: "File not found" } }, { status: 404 }),
    );
    await expect(send(new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }), download)).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
      message: "File not found",
      requestId: "req_test",
    });
  });
});

describe("retryDelayMs jitter", () => {
  it("uses Math.random for exponential backoff when Retry-After is absent", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(retryDelayMs(0, null)).toBe(187.5);
    vi.restoreAllMocks();
  });

  it("waits longer before retrying a 429 without Retry-After", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(retryDelayMs(0, null, 429)).toBe(750);
    expect(retryDelayMs(10, null, 429)).toBe(22_500);
    expect(retryDelayMs(0, "2", 429)).toBe(2_000);
    vi.restoreAllMocks();
  });
});
