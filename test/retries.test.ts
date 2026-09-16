import { describe, expect, it } from "vitest";
import { xAI } from "../src/index.js";
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
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 2 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const types: Array<string> = [];
    for await (const event of stream) types.push(event.type);
    expect(captured.requests).toHaveLength(2);
    expect(types).toContain("response.completed");
  });

  it("does not retry POST after HTTP 200 when the stream errors before the first SSE byte", async () => {
    const { fetch, captured } = mockFetch(() => erroringSse(true));
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 2 });
    await expect(client.responses.create({ ...createBody, stream: true })).rejects.toThrow();
    expect(captured.requests).toHaveLength(1);
  });

  it("does not retry after the first SSE byte", async () => {
    const { fetch, captured } = mockFetch(() => erroringSse(false));
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 2 });
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
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 2 });
    await expect(client.responses.create(createBody)).rejects.toMatchObject({ status: 529 });
    expect(captured.requests).toHaveLength(1);
  });
});
