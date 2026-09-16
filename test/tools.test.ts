import { describe, expect, it } from "vitest";
import { xAI } from "../src/index.js";
import {
  codeExecution,
  collectionsSearch,
  imageGeneration,
  mcp,
  toolSearch,
  webSearch,
  xSearch,
} from "../src/tools.js";
import { completedResponse, createBody, jsonResponse, mockFetch } from "./helpers.js";

describe("tool helpers", () => {
  it("build the request format for each tool", () => {
    expect(webSearch()).toEqual({ type: "web_search" });
    expect(webSearch({ allowed_domains: ["x.ai"] })).toEqual({
      type: "web_search",
      allowed_domains: ["x.ai"],
    });
    expect(xSearch({ allowed_x_handles: ["xai"], from_date: "2026-09-01" })).toEqual({
      type: "x_search",
      allowed_x_handles: ["xai"],
      from_date: "2026-09-01",
    });
    expect(codeExecution()).toEqual({ type: "code_interpreter" });
    expect(collectionsSearch({ vector_store_ids: ["collection_1"], max_num_results: 10 })).toEqual({
      type: "file_search",
      vector_store_ids: ["collection_1"],
      max_num_results: 10,
    });
    expect(mcp({ server_url: "https://mcp.deepwiki.com/mcp", server_label: "deepwiki" })).toEqual({
      type: "mcp",
      server_url: "https://mcp.deepwiki.com/mcp",
      server_label: "deepwiki",
    });
    expect(imageGeneration({ action: "edit" })).toEqual({ type: "image_generation", action: "edit" });
    expect(toolSearch()).toEqual({ type: "tool_search" });
  });

  it("sends helper tools as they are", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const tools = [xSearch({ excluded_x_handles: ["spam"] }), codeExecution()];
    await client.responses.create({ ...createBody, tools });
    const body = (await captured.requests[0]?.json()) as { tools: unknown };
    expect(body.tools).toEqual(tools);
  });
});
