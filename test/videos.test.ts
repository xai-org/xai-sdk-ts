import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AbortError,
  APIProtocolError,
  NotFoundError,
  TimeoutError,
  type VideoEditParams,
  type VideoExtendParams,
  type VideoGenerateParams,
  xAI,
} from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

const model = "grok-imagine-video-1.5";

const doneResponse = {
  status: "done",
  video: {
    url: "https://vidgen.x.ai/xai-vidgen-bucket/xai-video-req_1.mp4",
    duration: 8,
    respect_moderation: true,
  },
  model,
  progress: 100,
  usage: { cost_in_usd_ticks: 6_400_000_000 },
};

const failedResponse = {
  status: "failed",
  error: {
    code: "invalid_argument",
    message: "Prompt cannot be empty. Please provide a prompt.",
  },
};

const videoModel = {
  id: model,
  fingerprint: "fp_1",
  created: 1_743_724_800,
  object: "model",
  owned_by: "xai",
  version: "1.5.0",
  input_modalities: ["text", "image", "audio"],
  output_modalities: ["video"],
  aliases: ["grok-imagine-video-1.5-preview"],
};

function client(fetch: typeof globalThis.fetch): xAI {
  return new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

function pendingResponse(): Response {
  return new Response(null, { status: 202, headers: { "x-request-id": "req_test" } });
}

async function jsonBody(request: Request | undefined): Promise<Record<string, unknown>> {
  return (await request?.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("videos.generate", () => {
  it("posts the params unchanged and returns the request ID", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse({ request_id: "req_1" }));
    const params = {
      model,
      prompt: "A paper boat drifting down a rain-soaked street",
      duration: 8,
      aspect_ratio: "16:9",
      resolution: "720p",
    } satisfies VideoGenerateParams;
    const res = await client(fetch).videos.generate(params);

    const request = captured.requests[0];
    expect(captured.requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.x.ai/v1/videos/generations");
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(await jsonBody(request)).toEqual(params);

    expect(res.request_id).toBe("req_1");
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
  });

  it("inlines Blob and File images without mutating params", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse({ request_id: "req_1" }));
    const firstFrame = new File(["png-bytes"], "first.png", { type: "image/png" });
    const reference = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const keyframe = new Blob([jpeg]);
    const params = {
      model,
      prompt: "The model from <IMAGE_0> walks onto the stage wearing <IMAGE_1>",
      image: firstFrame,
      reference_images: [reference, { url: "https://example.com/shirt.png" }, { file_id: "file_1" }],
      keyframes: [
        { image: keyframe, timestamp_s: 2 },
        { image: { file_id: "file_2" }, timestamp_s: 4 },
      ],
    } satisfies VideoGenerateParams;
    await client(fetch).videos.generate(params);

    expect(await jsonBody(captured.requests[0])).toEqual({
      model,
      prompt: params.prompt,
      image: { url: `data:image/png;base64,${btoa("png-bytes")}` },
      reference_images: [
        { url: `data:image/jpeg;base64,${btoa("jpeg-bytes")}` },
        { url: "https://example.com/shirt.png" },
        { file_id: "file_1" },
      ],
      keyframes: [
        {
          image: { url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` },
          timestamp_s: 2,
        },
        { image: { file_id: "file_2" }, timestamp_s: 4 },
      ],
    });
    expect(params.image).toBe(firstFrame);
    expect(params.reference_images[0]).toBe(reference);
    expect(params.keyframes[0]?.image).toBe(keyframe);
  });

  it("aborts while reading a Blob image", async () => {
    const ac = new AbortController();
    class HangingBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        queueMicrotask(() => ac.abort());
        return new Promise(() => {});
      }
    }
    const { fetch, captured } = mockFetch(() => jsonResponse({ request_id: "req_1" }));
    await expect(
      client(fetch).videos.generate(
        { model, image: new HangingBlob(["image"]) },
        { signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(AbortError);
    expect(captured.requests).toHaveLength(0);
  });

  it.each([
    ["a non-object body", "not json"],
    ["a missing request_id", {}],
    ["an empty request_id", { request_id: "" }],
  ])("rejects %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(
      client(fetch).videos.generate({ model, prompt: "A lighthouse" }),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });
});

describe("videos.edit and videos.extend", () => {
  it("post the params unchanged to their endpoints", async () => {
    const { fetch, captured } = mockFetch((_req, n) => jsonResponse({ request_id: `req_${n}` }));
    const c = client(fetch);
    const edit = {
      model: "grok-imagine-video",
      prompt: "Give the woman a silver necklace",
      video: { url: "https://example.com/portrait.mp4" },
    } satisfies VideoEditParams;
    const extension = {
      model: "grok-imagine-video",
      prompt: "The camera slowly zooms out to reveal the city skyline",
      video: { file_id: "file_1" },
      duration: 6,
    } satisfies VideoExtendParams;
    const edited = await c.videos.edit(edit);
    const extended = await c.videos.extend(extension);

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://api.x.ai/v1/videos/edits",
      "POST https://api.x.ai/v1/videos/extensions",
    ]);
    expect(await jsonBody(captured.requests[0])).toEqual(edit);
    expect(await jsonBody(captured.requests[1])).toEqual(extension);
    expect(edited.request_id).toBe("req_1");
    expect(extended.request_id).toBe("req_2");
    expect(extended.http.requestId).toBe("req_test");
  });

  it("inline Blob and File videos as MP4 data URLs without mutating params", async () => {
    const { fetch, captured } = mockFetch((_req, n) => jsonResponse({ request_id: `req_${n}` }));
    const c = client(fetch);
    const untyped = new Blob(["mp4-bytes"]);
    const file = new File(["clip-bytes"], "clip.mp4", { type: "video/mp4" });
    const edit = {
      model: "grok-imagine-video",
      prompt: "Add snow to the scene",
      video: untyped,
    } satisfies VideoEditParams;
    const extension = {
      model: "grok-imagine-video",
      prompt: "The camera pulls back",
      video: file,
      duration: 6,
    } satisfies VideoExtendParams;
    await c.videos.edit(edit);
    await c.videos.extend(extension);

    expect(await jsonBody(captured.requests[0])).toEqual({
      ...edit,
      video: { url: `data:video/mp4;base64,${btoa("mp4-bytes")}` },
    });
    expect(await jsonBody(captured.requests[1])).toEqual({
      ...extension,
      video: { url: `data:video/mp4;base64,${btoa("clip-bytes")}` },
    });
    expect(edit.video).toBe(untyped);
    expect(extension.video).toBe(file);
  });
});

describe("videos.get", () => {
  it("maps a done result with usage and http", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(doneResponse));
    const c = client(fetch);
    const res = await c.videos.get("req_1");
    await c.videos.get("req/1");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/videos/req_1",
      "GET https://api.x.ai/v1/videos/req%2F1",
    ]);
    expect(res.status).toBe("done");
    expect(res.video).toEqual(doneResponse.video);
    expect(res.model).toBe(model);
    expect(res.progress).toBe(100);
    expect(res.usage).toEqual({ cost_in_usd_ticks: 6_400_000_000, cost_usd: 0.64 });
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
  });

  it("returns failed and expired results with null usage", async () => {
    const { fetch } = mockFetch((_req, n) =>
      jsonResponse(n === 1 ? failedResponse : { status: "expired" }),
    );
    const c = client(fetch);
    expect(await c.videos.get("req_1")).toMatchObject({ ...failedResponse, usage: null });
    expect(await c.videos.get("req_2")).toMatchObject({ status: "expired", usage: null });
  });

  it("reports a 202 response as pending, with or without a body", async () => {
    const { fetch } = mockFetch((_req, n) =>
      n === 1 ? pendingResponse() : jsonResponse({ status: "pending", progress: 40 }, { status: 202 }),
    );
    const c = client(fetch);
    const { http, ...empty } = await c.videos.get("req_1");
    const withProgress = await c.videos.get("req_1");

    expect(empty).toEqual({ status: "pending", usage: null });
    expect(http.status).toBe(202);
    expect(withProgress).toMatchObject({ status: "pending", progress: 40, usage: null });
    expect(withProgress.http.status).toBe(202);
  });

  it.each([
    ["a non-object body", "not json"],
    ["a null body", null],
    ["an array body", [doneResponse]],
    ["a missing status", { video: doneResponse.video }],
  ])("rejects %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(client(fetch).videos.get("req_1")).rejects.toBeInstanceOf(APIProtocolError);
  });
});

describe("videos.wait", () => {
  it("polls every 5 seconds across 202 responses until the video is done", async () => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch((_req, n) => {
      if (n === 1) return pendingResponse();
      if (n === 2) return jsonResponse({ status: "pending", progress: 60 }, { status: 202 });
      return jsonResponse(doneResponse);
    });
    const pending = client(fetch).videos.wait("req_1");

    await vi.advanceTimersByTimeAsync(4_999);
    expect(captured.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(captured.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await pending;

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual(
      Array(3).fill("GET https://api.x.ai/v1/videos/req_1"),
    );
    expect(res.status).toBe("done");
    expect(res.video?.url).toBe(doneResponse.video.url);
    expect(res.usage?.cost_usd).toBe(0.64);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["failed", failedResponse],
    ["expired", { status: "expired" }],
  ])("returns a %s result without polling again", async (_label, payload) => {
    const { fetch, captured } = mockFetch(() => jsonResponse(payload));
    const res = await client(fetch).videos.wait("req_1");
    expect(res).toMatchObject(payload);
    expect(captured.requests).toHaveLength(1);
  });

  it("rejects with TimeoutError after 10 minutes by default and stops polling", async () => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => pendingResponse());
    const pending = client(fetch).videos.wait("req_1");
    const rejection = expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TimeoutError &&
        error.message === "Video request req_1 did not finish within 600000ms",
    );

    await vi.advanceTimersByTimeAsync(599_999);
    expect(captured.requests).toHaveLength(120);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(captured.requests).toHaveLength(120);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a poll that is still in flight", async () => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => new Promise<Response>(() => {}));
    const pending = client(fetch).videos.wait("req_1", { timeout: 30_000 });
    const rejection = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(captured.requests).toHaveLength(1);
    expect(captured.requests[0]?.signal.aborted).toBe(true);
  });

  it("rejects with AbortError when the signal aborts between polls", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const { fetch, captured } = mockFetch(() => pendingResponse());
    const pending = client(fetch).videos.wait("req_1", { interval: 1_000, signal: ac.signal });
    const rejection = expect(pending).rejects.toBeInstanceOf(AbortError);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(captured.requests).toHaveLength(3);
    ac.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(captured.requests).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with AbortError when the signal aborts during a poll", async () => {
    const ac = new AbortController();
    const { fetch, captured } = mockFetch(() => {
      queueMicrotask(() => ac.abort());
      return new Promise<Response>(() => {});
    });
    await expect(
      client(fetch).videos.wait("req_1", { signal: ac.signal }),
    ).rejects.toBeInstanceOf(AbortError);
    expect(captured.requests).toHaveLength(1);
  });

  it("stops polling when a poll fails", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ error: { message: "No deferred video" } }, { status: 404 }),
    );
    await expect(client(fetch).videos.wait("req_1")).rejects.toBeInstanceOf(NotFoundError);
    expect(captured.requests).toHaveLength(1);
  });
});

describe("models.video", () => {
  it("lists and gets video generation models", async () => {
    const { fetch, captured } = mockFetch((req) =>
      req.url.endsWith("/video-generation-models")
        ? jsonResponse({ models: [videoModel] })
        : jsonResponse(videoModel),
    );
    const c = client(fetch);
    const list = await c.models.video.list();
    const got = await c.models.video.get(model);
    await c.models.video.get("custom/alias");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/video-generation-models",
      "GET https://api.x.ai/v1/video-generation-models/grok-imagine-video-1.5",
      "GET https://api.x.ai/v1/video-generation-models/custom%2Falias",
    ]);
    expect(list.models).toEqual([videoModel]);
    expect(list.http.requestId).toBe("req_test");
    expect(got.output_modalities).toEqual(["video"]);
    expect(got.http.status).toBe(200);
  });

  it("rejects malformed model bodies", async () => {
    const wrongShape = mockFetch(() => jsonResponse({ object: "list", data: [videoModel] }));
    await expect(client(wrongShape.fetch).models.video.list()).rejects.toBeInstanceOf(
      APIProtocolError,
    );

    const missingIds = mockFetch(() => jsonResponse({ models: [{ object: "model" }] }));
    await expect(client(missingIds.fetch).models.video.list()).rejects.toBeInstanceOf(
      APIProtocolError,
    );

    const missingId = mockFetch(() => jsonResponse({ object: "model" }));
    await expect(client(missingId.fetch).models.video.get(model)).rejects.toBeInstanceOf(
      APIProtocolError,
    );
  });
});
