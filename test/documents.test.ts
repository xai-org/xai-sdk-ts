import { describe, expect, it } from "vitest";
import { APIProtocolError, type DocumentSearchParams, xAI } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

const searchResponse = {
  matches: [
    {
      file_id: "file_1",
      chunk_id: "chunk_1",
      chunk_content: "Revenue grew 12% year over year.",
      score: 1.14,
      collection_ids: ["collection_1"],
      fields: { year: "2025", category: "finance" },
      page_number: 3,
    },
  ],
};

function client(fetch: typeof globalThis.fetch): xAI {
  return new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

describe("documents.search", () => {
  it("posts the params unchanged and maps matches and http", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(searchResponse));
    const params = {
      query: "What was the revenue in the last quarter?",
      source: { collection_ids: ["collection_1", "collection_2"] },
      filter: 'category = "finance" AND year >= 2024',
      limit: 5,
      retrieval_mode: { type: "hybrid", search_multiplier: 2, reranker: { type: "rrf", k: 60 } },
      group_by: { keys: ["category"], aggregate: { max_k: { k: 1, keys: ["#score"] } } },
    } satisfies DocumentSearchParams;
    const res = await client(fetch).documents.search(params);

    const request = captured.requests[0];
    expect(captured.requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.x.ai/v1/documents/search");
    expect(request?.headers.get("authorization")).toBe("Bearer test-key");
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(await request?.json()).toEqual(params);

    expect(res.matches).toEqual(searchResponse.matches);
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
  });

  it.each([
    ["a non-object body", "not json"],
    ["a missing matches array", {}],
    ["a non-array matches field", { matches: "nope" }],
  ])("rejects %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(
      client(fetch).documents.search({
        query: "revenue",
        source: { collection_ids: ["collection_1"] },
      }),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });
});
