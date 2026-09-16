import { describe, expect, it } from "vitest";
import {
  APIError,
  APIProtocolError,
  type ImageEditParams,
  type ImageGenerateParams,
  isImageGenerationCall,
  xAI,
} from "../src/index.js";
import { completedResponse, createBody, jsonResponse, mockFetch } from "./helpers.js";

const model = "grok-imagine-image-2.0";

const imageResponse = {
  data: [{ url: "https://imgen.x.ai/xai-imgen/image-1.jpg", mime_type: "image/jpeg" }],
  usage: { cost_in_usd_ticks: 200_000_000 },
};

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

function client(fetch: typeof globalThis.fetch): xAI {
  return new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

async function jsonBody(request: Request | undefined): Promise<Record<string, unknown>> {
  return (await request?.json()) as Record<string, unknown>;
}

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
