import { describe, expect, it } from "vitest";
import { APIProtocolError, type CompactParams, type InputItem, xAI } from "../src/index.js";
import { completedResponse, jsonResponse, mockFetch } from "./helpers.js";

const model = "grok-4.6";

const conversation = [
  { role: "system", content: "You are a concise science tutor." },
  { role: "user", content: "What is the Higgs boson?" },
  { role: "assistant", content: "An elementary particle of the Standard Model." },
] satisfies InputItem[];

const compactResponse = {
  id: "cmp_123",
  object: "response.compaction",
  created_at: 1_748_895_600,
  model,
  output: [{ type: "compaction", id: "cmp_123", encrypted_content: "enc_compacted" }],
  usage: {
    input_tokens: 12_000,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 800,
    output_tokens_details: { reasoning_tokens: 240 },
    total_tokens: 12_800,
    dropped_message_count: 45,
  },
};

function client(fetch: typeof globalThis.fetch): xAI {
  return new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

async function jsonBody(request: Request | undefined): Promise<Record<string, unknown>> {
  return (await request?.json()) as Record<string, unknown>;
}

describe("responses.compact", () => {
  it("posts only model and input and returns the compaction with http metadata", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(compactResponse));
    const params = { model, input: conversation } satisfies CompactParams;
    const { http, ...compaction } = await client(fetch).responses.compact(params);

    const request = captured.requests[0];
    expect(captured.requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.x.ai/v1/responses/compact");
    expect(await jsonBody(request)).toEqual(params);
    expect(compaction).toEqual(compactResponse);
    expect(http.status).toBe(200);
    expect(http.requestId).toBe("req_test");
  });

  it("inlines Blob image parts to data URLs", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(compactResponse));
    const image = new Blob(["png-bytes"], { type: "image/png" });
    await client(fetch).responses.compact({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "What is in this image?" },
            { type: "input_image", image, detail: "high" },
          ],
        },
      ],
    });

    expect((await jsonBody(captured.requests[0])).input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "What is in this image?" },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${btoa("png-bytes")}`,
            detail: "high",
          },
        ],
      },
    ]);
  });

  it("compacts toInput() items and continues from the compacted output", async () => {
    const { fetch, captured } = mockFetch((req) =>
      jsonResponse(req.url.endsWith("/responses/compact") ? compactResponse : completedResponse),
    );
    const c = client(fetch);
    const next = { role: "user", content: "What gives particles their mass?" };

    const first = await c.responses.create({ model, input: conversation });
    const compacted = await c.responses.compact({
      model,
      input: [...conversation, ...first.toInput()],
    });
    await c.responses.create({ model, input: [...compacted.output, next] });

    expect((await jsonBody(captured.requests[1])).input).toEqual([
      ...conversation,
      ...completedResponse.output,
    ]);
    expect((await jsonBody(captured.requests[2])).input).toEqual([
      ...compactResponse.output,
      next,
    ]);
  });

  it.each([
    ["a non-object body", "not json"],
    ["a missing id", { ...compactResponse, id: undefined }],
    ["a missing output", { ...compactResponse, output: undefined }],
    ["a non-array output", { ...compactResponse, output: compactResponse.output[0] }],
  ])("rejects %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(
      client(fetch).responses.compact({ model, input: conversation }),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });
});
