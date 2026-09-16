import { describe, expect, it } from "vitest";
import { APIProtocolError, type TokenizeParams, xAI } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

const tokenizeResponse = {
  token_ids: [
    { token_id: 13902, string_token: "Hello", token_bytes: [72, 101, 108, 108, 111] },
    { token_id: 1749, string_token: " world", token_bytes: [32, 119, 111, 114, 108, 100] },
    { token_id: 161, string_token: "!", token_bytes: [33] },
  ],
};

function client(fetch: typeof globalThis.fetch): xAI {
  return new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

describe("tokenizer.encode", () => {
  it("posts the params to /tokenize-text and maps token_ids and http", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(tokenizeResponse));
    const params = {
      model: "grok-4.6",
      text: "Hello world!",
      user: "user_123",
    } satisfies TokenizeParams;
    const res = await client(fetch).tokenizer.encode(params);

    const request = captured.requests[0];
    expect(captured.requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.x.ai/v1/tokenize-text");
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(await request?.json()).toEqual(params);

    expect(res.token_ids).toEqual(tokenizeResponse.token_ids);
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
  });

  it.each([
    ["a non-object body", "not json"],
    ["a missing token_ids array", {}],
    ["a non-array token_ids field", { token_ids: "13902" }],
  ])("rejects %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(
      client(fetch).tokenizer.encode({ model: "grok-4.6", text: "Hello world!" }),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });
});
