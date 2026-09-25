import { describe, expect, it } from "vitest";
import { APIProtocolError, type EmbeddingCreateParams, xAI } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

const model = "grok-embedding-small";

const embeddingResponse = {
  object: "list",
  model,
  data: [
    { index: 0, embedding: [0.01567895, 0.063257694, 0.045925662], object: "embedding" },
    { index: 1, embedding: [0.02145523, -0.01820834, 0.07731201], object: "embedding" },
  ],
  usage: { prompt_tokens: 18, total_tokens: 18 },
};

const embeddingModel = {
  id: model,
  fingerprint: "fp_df37966059",
  created: 1_725_148_800,
  object: "model",
  owned_by: "xai",
  version: "0.1.0",
  input_modalities: ["text"],
  output_modalities: ["embedding"],
  prompt_text_token_price: 100,
  prompt_image_token_price: 0,
  aliases: [],
};

function client(fetch: typeof globalThis.fetch): xAI {
  return new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

describe("embeddings.create", () => {
  it("posts the params unchanged and maps data, usage, and http", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(embeddingResponse));
    const params = {
      model,
      input: [
        "query: How do I rotate an API key?",
        "passage: Create a new key, then delete the old one.",
      ],
      encoding_format: "float",
      dimensions: 3,
      user: "user_123",
    } satisfies EmbeddingCreateParams;
    const res = await client(fetch).embeddings.create(params);

    const request = captured.requests[0];
    expect(captured.requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.x.ai/v1/embeddings");
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(await request?.json()).toEqual(params);

    expect(res.object).toBe("list");
    expect(res.model).toBe(model);
    expect(res.data).toEqual(embeddingResponse.data);
    expect(res.usage).toEqual(embeddingResponse.usage);
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
  });

  it("sends token IDs and returns base64 embeddings as given", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({
        ...embeddingResponse,
        data: [{ index: 0, embedding: "AACAPwAAAEA=", object: "embedding" }],
      }),
    );
    const params = {
      model,
      input: [[13902, 1749], [161]],
      encoding_format: "base64",
    } satisfies EmbeddingCreateParams;
    const res = await client(fetch).embeddings.create(params);

    expect(await captured.requests[0]?.json()).toEqual(params);
    expect(res.data[0]?.embedding).toBe("AACAPwAAAEA=");
  });
});

describe("embedding response validation", () => {
  it.each([
    ["a non-object body", "not json"],
    ["a missing data array", { object: "list", model }],
    ["a non-array data field", { object: "list", model, data: {} }],
  ])("rejects %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(
      client(fetch).embeddings.create({ model, input: "query: What is Grok?" }),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });
});

describe("embeddings.models", () => {
  it("lists and gets embedding models", async () => {
    const { fetch, captured } = mockFetch((req) =>
      req.url.endsWith("/embedding-models")
        ? jsonResponse({ models: [embeddingModel] })
        : jsonResponse(embeddingModel),
    );
    const c = client(fetch);
    const list = await c.embeddings.models.list();
    const got = await c.embeddings.models.get(model);
    await c.embeddings.models.get("custom/alias");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/embedding-models",
      "GET https://api.x.ai/v1/embedding-models/grok-embedding-small",
      "GET https://api.x.ai/v1/embedding-models/custom%2Falias",
    ]);
    expect(list.models).toEqual([embeddingModel]);
    expect(list.http.requestId).toBe("req_test");
    expect(got.prompt_text_token_price).toBe(100);
    expect(got.http.status).toBe(200);
  });

  it("rejects malformed model bodies", async () => {
    const wrongShape = mockFetch(() => jsonResponse({ object: "list", data: [embeddingModel] }));
    await expect(client(wrongShape.fetch).embeddings.models.list()).rejects.toBeInstanceOf(
      APIProtocolError,
    );

    const missingIds = mockFetch(() => jsonResponse({ models: [{ object: "model" }] }));
    await expect(client(missingIds.fetch).embeddings.models.list()).rejects.toBeInstanceOf(
      APIProtocolError,
    );

    const missingId = mockFetch(() => jsonResponse({ object: "model" }));
    await expect(client(missingId.fetch).embeddings.models.get(model)).rejects.toBeInstanceOf(
      APIProtocolError,
    );
  });
});
