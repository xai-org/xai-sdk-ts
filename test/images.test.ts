import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  AbortError,
  APIError,
  APIProtocolError,
  type DeferredImageResponse,
  type HttpMeta,
  type ImageEditParams,
  type ImageGenerateParams,
  type ImageResponse,
  type ImageStartResponse,
  isImageGenerationCall,
  NotFoundError,
  SpaceXAI,
  TimeoutError,
} from "../src/index.js";
import { completedResponse, createBody, jsonResponse, mockFetch } from "./helpers.js";

const model = "grok-imagine-image-2.0";

const imageResponse = {
  data: [{ url: "https://imgen.x.ai/xai-imgen/image-1.jpg", mime_type: "image/jpeg" }],
  usage: { cost_in_usd_ticks: 200_000_000 },
};

const requestId = "e5b1b4d4-7b6a-4a0e-9c0d-7f3c7d8a1b2c";

const deferredDone = { request_id: requestId, status: "done", ...imageResponse };

const deferredFailed = {
  request_id: requestId,
  status: "failed",
  error: { code: "invalid_argument", message: "Prompt cannot be empty." },
};

const uploadUrl = "https://storage.example.com/images/cat.jpg?X-Signature=abc123";

const jpegBytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
const webpBytes = [
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
];

const imageModel = {
  id: model,
  fingerprint: "fp_1",
  max_prompt_length: 1024,
  created: 1_738_961_600,
  object: "model",
  owned_by: "xai",
  version: "2.0.0",
  input_modalities: ["text", "image"],
  output_modalities: ["image"],
  image_price: 4,
  aliases: [],
};

function client(fetch: typeof globalThis.fetch): SpaceXAI {
  return new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

async function jsonBody(request: Request | undefined): Promise<Record<string, unknown>> {
  return (await request?.json()) as Record<string, unknown>;
}

function pendingResponse(): Response {
  return new Response(null, { status: 202, headers: { "x-request-id": "req_test" } });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("images.generate", () => {
  it("posts the params unchanged and maps data, usage, and http", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(imageResponse));
    const params = {
      model,
      prompt: "A cat in a tree",
      n: 2,
      aspect_ratio: "16:9",
      resolution: "2k",
      quality: "low",
      response_format: "url",
    } satisfies ImageGenerateParams;
    const res = await client(fetch).images.generate(params);

    const request = captured.requests[0];
    expect(captured.requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.x.ai/v1/images/generations");
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(request?.headers.get("accept")).toBe("application/json");
    expect(await jsonBody(request)).toEqual(params);

    expect(res.data).toEqual(imageResponse.data);
    expect(res.usage?.cost_in_usd_ticks).toBe(200_000_000);
    expect(res.usage?.cost_usd).toBe(0.02);
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
  });

  it("keeps token usage details and base64 output", async () => {
    const usage = {
      cost_in_usd_ticks: 400_000_000,
      input_tokens: 12,
      input_tokens_details: { text_tokens: 12, image_tokens: 0, cached_tokens: 0 },
      output_tokens: 4_096,
      output_tokens_details: { text_tokens: 40, reasoning_tokens: 0, image_tokens: 4_056 },
      total_tokens: 4_108,
    };
    const { fetch } = mockFetch(() =>
      jsonResponse({ data: [{ b64_json: "aW1hZ2U=", mime_type: "image/png" }], usage }),
    );
    const res = await client(fetch).images.generate({
      model,
      prompt: "A serene Japanese garden",
      response_format: "b64_json",
    });
    expect(res.data[0]?.b64_json).toBe("aW1hZ2U=");
    expect(res.usage).toEqual({ ...usage, cost_usd: 0.04 });
  });

  it("returns null usage when the wire omits it", async () => {
    const { fetch } = mockFetch(() => jsonResponse({ data: imageResponse.data }));
    const res = await client(fetch).images.generate({ model, prompt: "A lighthouse" });
    expect(res.usage).toBeNull();
  });

  it("leaves cost_usd null when usage has no cost ticks", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ data: imageResponse.data, usage: { total_tokens: 10 } }),
    );
    const res = await client(fetch).images.generate({ model, prompt: "A lighthouse" });
    expect(res.usage).toEqual({ total_tokens: 10, cost_usd: null });
  });
});

describe("images.edit", () => {
  it("sends URL and file_id sources as given", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(imageResponse));
    const c = client(fetch);
    await c.images.edit({ model, prompt: "Add a hat", image: { url: "https://example.com/cat.png" } });
    await c.images.edit({ model, prompt: "Add a hat", image: { file_id: "file_123" } });

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://api.x.ai/v1/images/edits",
      "POST https://api.x.ai/v1/images/edits",
    ]);
    expect(await jsonBody(captured.requests[0])).toEqual({
      model,
      prompt: "Add a hat",
      image: { url: "https://example.com/cat.png" },
    });
    expect(await jsonBody(captured.requests[1])).toEqual({
      model,
      prompt: "Add a hat",
      image: { file_id: "file_123" },
    });
  });

  it("inlines a File source image to a data URL", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(imageResponse));
    const file = new File(["png-bytes"], "cat.png", { type: "image/png" });
    const res = await client(fetch).images.edit({ model, prompt: "Make it a sketch", image: file });

    const body = await jsonBody(captured.requests[0]);
    expect(body.image).toEqual({ url: `data:image/png;base64,${btoa("png-bytes")}` });
    expect(body).not.toHaveProperty("images");
    expect(res.data).toEqual(imageResponse.data);
  });

  it("inlines Blob entries in a mixed multi-image edit without mutating params", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(imageResponse));
    const blob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    const params = {
      model,
      prompt: "Put the cat from <IMAGE_0> into <IMAGE_1> with the hat from <IMAGE_2>",
      images: [blob, { file_id: "file_123" }, { url: "https://example.com/hat.png" }],
      aspect_ratio: "1:1",
    } satisfies ImageEditParams;
    await client(fetch).images.edit(params);

    expect(await jsonBody(captured.requests[0])).toEqual({
      model,
      prompt: params.prompt,
      aspect_ratio: "1:1",
      images: [
        { url: `data:image/jpeg;base64,${btoa("jpeg-bytes")}` },
        { file_id: "file_123" },
        { url: "https://example.com/hat.png" },
      ],
    });
    expect(params.images[0]).toBe(blob);
  });

  it.each([
    ["JPEG", jpegBytes, "image/jpeg"],
    ["PNG", pngBytes, "image/png"],
    ["WebP", webpBytes, "image/webp"],
  ])("detects %s bytes in an untyped Blob", async (_label, signature, mimeType) => {
    const { fetch, captured } = mockFetch(() => jsonResponse(imageResponse));
    const bytes = new Uint8Array(signature);
    await client(fetch).images.edit({ model, prompt: "Edit", image: new Blob([bytes]) });

    expect((await jsonBody(captured.requests[0])).image).toEqual({
      url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
    });
  });

  it("treats application/octet-stream as untyped and keeps other declared types", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(imageResponse));
    const png = new Uint8Array(pngBytes);
    await client(fetch).images.edit({
      model,
      prompt: "Edit",
      images: [
        new File([png], "photo.png", { type: "application/octet-stream" }),
        new Blob([png], { type: "image/webp" }),
        new Blob(["not an image"]),
      ],
    });

    const images = (await jsonBody(captured.requests[0])).images as Array<{ url: string }>;
    expect(images.map((image) => image.url.split(";", 1)[0])).toEqual([
      "data:image/png",
      "data:image/webp",
      "data:application/octet-stream",
    ]);
  });

  it("aborts while reading a Blob source image", async () => {
    const ac = new AbortController();
    class HangingBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        queueMicrotask(() => ac.abort());
        return new Promise(() => {});
      }
    }
    const { fetch, captured } = mockFetch(() => jsonResponse(imageResponse));
    const pending = client(fetch).images.edit(
      { model, prompt: "Edit", images: [new HangingBlob(["image"])] },
      { signal: ac.signal },
    );
    await expect(pending).rejects.toSatisfy(
      (error: unknown) => APIError.is(error) && error.isAbort(),
    );
    expect(captured.requests).toHaveLength(0);
  });

  it("rejects an already-aborted signal before reading inputs", async () => {
    const ac = new AbortController();
    ac.abort();
    const { fetch, captured } = mockFetch(() => jsonResponse(imageResponse));
    await expect(
      client(fetch).images.edit(
        { model, prompt: "Edit", image: new Blob(["png"], { type: "image/png" }) },
        { signal: ac.signal },
      ),
    ).rejects.toSatisfy((error: unknown) => APIError.is(error) && error.isAbort());
    expect(captured.requests).toHaveLength(0);
  });
});

describe("image response validation", () => {
  it.each([
    ["a non-object body", "not json"],
    ["a missing data array", { usage: imageResponse.usage }],
    ["a non-array data field", { data: "nope" }],
  ])("rejects %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(
      client(fetch).images.generate({ model, prompt: "A lighthouse" }),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });
});

describe("deferred image requests", () => {
  it("generate posts deferred: true and returns the request ID", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse({ request_id: requestId }));
    const start = await client(fetch).images.generate({
      model,
      prompt: "A cat in a tree",
      n: 2,
      deferred: true,
    });

    expect(captured.requests[0]?.url).toBe("https://api.x.ai/v1/images/generations");
    expect(await jsonBody(captured.requests[0])).toEqual({
      model,
      prompt: "A cat in a tree",
      n: 2,
      deferred: true,
    });
    expect(start.request_id).toBe(requestId);
    expect(start.http.status).toBe(200);
    expect(start.http.requestId).toBe("req_test");
    expect(start).not.toHaveProperty("data");
    expectTypeOf(start).toEqualTypeOf<ImageStartResponse & { http: HttpMeta }>();
  });

  it("edit inlines a Blob image, posts deferred: true, and returns the request ID", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse({ request_id: requestId }));
    const start = await client(fetch).images.edit({
      model,
      prompt: "Add a hat",
      image: new Blob(["png"], { type: "image/png" }),
      deferred: true,
    });

    expect(captured.requests[0]?.url).toBe("https://api.x.ai/v1/images/edits");
    expect(await jsonBody(captured.requests[0])).toEqual({
      model,
      prompt: "Add a hat",
      image: { url: `data:image/png;base64,${btoa("png")}` },
      deferred: true,
    });
    expect(start.request_id).toBe(requestId);
    expectTypeOf(start).toEqualTypeOf<ImageStartResponse & { http: HttpMeta }>();
  });

  it("returns the images when deferred is false", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(imageResponse));
    const res = await client(fetch).images.generate({ model, prompt: "A lighthouse", deferred: false });

    expect((await jsonBody(captured.requests[0])).deferred).toBe(false);
    expect(res.data).toEqual(imageResponse.data);
    expectTypeOf(res).toEqualTypeOf<ImageResponse>();
  });

  it("sends output upload URLs unchanged", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ data: [{ url: uploadUrl, mime_type: "image/jpeg" }] }),
    );
    const res = await client(fetch).images.generate({
      model,
      prompt: "A cat in a tree",
      response_format: "url",
      output: { upload_urls: [uploadUrl] },
    });

    expect(await jsonBody(captured.requests[0])).toEqual({
      model,
      prompt: "A cat in a tree",
      response_format: "url",
      output: { upload_urls: [uploadUrl] },
    });
    expect(res.data[0]?.url).toBe(uploadUrl);
  });

  it.each([
    ["a non-object body", "not json"],
    ["a missing request_id", {}],
    ["an empty request_id", { request_id: "" }],
    ["finished images instead of a request ID", imageResponse],
  ])("rejects a deferred start with %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(
      client(fetch).images.generate({ model, prompt: "A lighthouse", deferred: true }),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });
});

describe("images.get", () => {
  it("maps a done result with data, usage, and http", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(deferredDone));
    const c = client(fetch);
    const res = await c.images.get(requestId);
    await c.images.get("req/1");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET https://api.x.ai/v1/images/${requestId}`,
      "GET https://api.x.ai/v1/images/req%2F1",
    ]);
    expect(res.request_id).toBe(requestId);
    expect(res.status).toBe("done");
    expect(res.data).toEqual(imageResponse.data);
    expect(res.usage).toEqual({ cost_in_usd_ticks: 200_000_000, cost_usd: 0.02 });
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
  });

  it("returns a failed result with its error and null usage", async () => {
    const { fetch } = mockFetch(() => jsonResponse(deferredFailed));
    const res = await client(fetch).images.get(requestId);

    expect(res).toMatchObject({ ...deferredFailed, usage: null });
    expect(res.data).toBeUndefined();
  });

  it("reports a 202 response as pending, with or without a body", async () => {
    const { fetch } = mockFetch((_req, n) =>
      n === 1
        ? pendingResponse()
        : jsonResponse({ request_id: requestId, status: "pending" }, { status: 202 }),
    );
    const c = client(fetch);
    const { http, ...empty } = await c.images.get(requestId);
    const withBody = await c.images.get(requestId);

    expect(empty).toEqual({ request_id: requestId, status: "pending", usage: null });
    expect(http.status).toBe(202);
    expect(withBody).toMatchObject({ request_id: requestId, status: "pending", usage: null });
    expect(withBody.http.status).toBe(202);
  });

  it.each([
    ["no status", jsonResponse({ request_id: requestId }, { status: 202 })],
    ["another status", jsonResponse({ request_id: requestId, status: "queued" }, { status: 202 })],
    ["a text body", new Response("queued", { status: 202, headers: { "content-type": "text/plain" } })],
  ])("treats a 202 with %s as pending", async (_label, response) => {
    const { fetch } = mockFetch(() => response);
    expect(await client(fetch).images.get(requestId)).toMatchObject({
      request_id: requestId,
      status: "pending",
      usage: null,
    });
  });

  it("fills in request_id when the body leaves it out", async () => {
    const { fetch } = mockFetch(() => jsonResponse({ status: "done", data: imageResponse.data }));
    expect((await client(fetch).images.get(requestId)).request_id).toBe(requestId);
  });

  it.each([
    ["a non-object body", "not json"],
    ["a null body", null],
    ["an array body", [deferredDone]],
    ["a missing status", { request_id: requestId, data: imageResponse.data }],
  ])("rejects %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(client(fetch).images.get(requestId)).rejects.toBeInstanceOf(APIProtocolError);
  });
});

describe("images.wait", () => {
  it("polls every second across 202 responses until the images are done", async () => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch((_req, n) => {
      if (n === 1) return pendingResponse();
      if (n === 2) return jsonResponse({ request_id: requestId, status: "pending" }, { status: 202 });
      return jsonResponse(deferredDone);
    });
    const pending = client(fetch).images.wait(requestId);

    await vi.advanceTimersByTimeAsync(999);
    expect(captured.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(captured.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    const res = await pending;

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual(
      Array(3).fill(`GET https://api.x.ai/v1/images/${requestId}`),
    );
    expect(res.status).toBe("done");
    expect(res.data?.[0]?.url).toBe(imageResponse.data[0]?.url);
    expect(res.usage?.cost_usd).toBe(0.02);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a failed result without polling again", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(deferredFailed));
    const res = await client(fetch).images.wait(requestId);

    expect(res).toMatchObject(deferredFailed);
    expect(captured.requests).toHaveLength(1);
  });

  it("rejects with TimeoutError after 5 minutes by default and stops polling", async () => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => pendingResponse());
    const pending = client(fetch).images.wait(requestId);
    const rejection = expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TimeoutError &&
        error.message === `Image request ${requestId} did not finish within 300000ms`,
    );

    await vi.advanceTimersByTimeAsync(299_999);
    expect(captured.requests).toHaveLength(300);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(captured.requests).toHaveLength(300);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the given interval and rejects with AbortError when the signal aborts", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const { fetch, captured } = mockFetch(() => pendingResponse());
    const pending = client(fetch).images.wait(requestId, { interval: 250, signal: ac.signal });
    const rejection = expect(pending).rejects.toBeInstanceOf(AbortError);

    await vi.advanceTimersByTimeAsync(600);
    expect(captured.requests).toHaveLength(3);
    ac.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(captured.requests).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling when the request is unknown or has expired", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ error: "Unknown request id or the result has expired." }, { status: 404 }),
    );
    await expect(client(fetch).images.wait(requestId)).rejects.toBeInstanceOf(NotFoundError);
    expect(captured.requests).toHaveLength(1);
  });
});

describe("deferred image flow", () => {
  it("starts a deferred generation, then polls until the images are ready", async () => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch((req, n) => {
      if (req.method === "POST") return jsonResponse({ request_id: requestId });
      return n < 4 ? pendingResponse() : jsonResponse(deferredDone);
    });
    const c = client(fetch);

    const start = await c.images.generate({ model, prompt: "A cat in a tree", deferred: true });
    const pending = c.images.wait(start.request_id, { interval: 2_000 });
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await pending;

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://api.x.ai/v1/images/generations",
      `GET https://api.x.ai/v1/images/${requestId}`,
      `GET https://api.x.ai/v1/images/${requestId}`,
      `GET https://api.x.ai/v1/images/${requestId}`,
    ]);
    expect(await jsonBody(captured.requests[0])).toEqual({
      model,
      prompt: "A cat in a tree",
      deferred: true,
    });
    expect(result).toMatchObject({
      request_id: requestId,
      status: "done",
      data: imageResponse.data,
      usage: { cost_in_usd_ticks: 200_000_000, cost_usd: 0.02 },
    });
    expectTypeOf(start).toEqualTypeOf<ImageStartResponse & { http: HttpMeta }>();
    expectTypeOf(result).toEqualTypeOf<DeferredImageResponse>();
  });

  it("starts a deferred edit that uploads to signed URLs, then reads the upload URL", async () => {
    const { fetch, captured } = mockFetch((req) =>
      req.method === "POST"
        ? jsonResponse({ request_id: requestId })
        : jsonResponse({ ...deferredDone, data: [{ url: uploadUrl, mime_type: "image/jpeg" }] }),
    );
    const c = client(fetch);

    const { request_id } = await c.images.edit({
      model,
      prompt: "Add a hat",
      image: { file_id: "file_123" },
      deferred: true,
      output: { upload_urls: [uploadUrl] },
    });
    const result = await c.images.wait(request_id);

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://api.x.ai/v1/images/edits",
      `GET https://api.x.ai/v1/images/${requestId}`,
    ]);
    expect(await jsonBody(captured.requests[0])).toEqual({
      model,
      prompt: "Add a hat",
      image: { file_id: "file_123" },
      deferred: true,
      output: { upload_urls: [uploadUrl] },
    });
    expect(result.status).toBe("done");
    expect(result.data?.[0]?.url).toBe(uploadUrl);
  });
});

describe("models.image", () => {
  it("lists and gets image generation models", async () => {
    const { fetch, captured } = mockFetch((req) =>
      req.url.endsWith("/image-generation-models")
        ? jsonResponse({ models: [imageModel] })
        : jsonResponse(imageModel),
    );
    const c = client(fetch);
    const list = await c.models.image.list();
    const got = await c.models.image.get(model);
    await c.models.image.get("custom/alias");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/image-generation-models",
      "GET https://api.x.ai/v1/image-generation-models/grok-imagine-image-2.0",
      "GET https://api.x.ai/v1/image-generation-models/custom%2Falias",
    ]);
    expect(list.models).toEqual([imageModel]);
    expect(list.http.requestId).toBe("req_test");
    expect(got.image_price).toBe(4);
    expect(got.http.status).toBe(200);
  });

  it("rejects malformed model bodies", async () => {
    const wrongShape = mockFetch(() => jsonResponse({ object: "list", data: [imageModel] }));
    await expect(client(wrongShape.fetch).models.image.list()).rejects.toBeInstanceOf(
      APIProtocolError,
    );

    const missingIds = mockFetch(() => jsonResponse({ models: [{ object: "model" }] }));
    await expect(client(missingIds.fetch).models.image.list()).rejects.toBeInstanceOf(
      APIProtocolError,
    );

    const missingId = mockFetch(() => jsonResponse({ object: "model" }));
    await expect(client(missingId.fetch).models.image.get(model)).rejects.toBeInstanceOf(
      APIProtocolError,
    );
  });
});

describe("responses image_generation tool", () => {
  it("sends the tool and narrows image_generation_call output items", async () => {
    const call = {
      type: "image_generation_call",
      id: "ig_1",
      status: "completed",
      prompt: "A corgi surfing a big wave",
      result: btoa("jpeg-bytes"),
    };
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ ...completedResponse, output: [call, completedResponse.output[1]] }),
    );
    const res = await client(fetch).responses.create({
      ...createBody,
      tools: [{ type: "image_generation", action: "generate" }],
    });

    expect((await jsonBody(captured.requests[0])).tools).toEqual([
      { type: "image_generation", action: "generate" },
    ]);
    const calls = res.output.filter(isImageGenerationCall);
    expect(calls).toEqual([call]);
    expect(calls[0]?.result).toBe(btoa("jpeg-bytes"));
    expect(isImageGenerationCall(res.output[1])).toBe(false);
    expect(isImageGenerationCall(null)).toBe(false);
  });
});
