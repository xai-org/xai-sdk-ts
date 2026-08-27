import { describe, expect, it } from "vitest";
import type { operations } from "../src/generated/types.js";
import { xAI } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

type ListQuery = NonNullable<operations["handle_list_input_items"]["parameters"]["query"]>;

describe("OpenAPI query contract", () => {
  it("inputItems.list query matches handle_list_input_items", async () => {
    const query: ListQuery = { after: "msg_1", limit: 10, order: "asc" };
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ object: "list", data: [], has_more: false }),
    );
    await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.inputItems.list("resp_1", query);
    const url = new URL(captured.requests[0]!.url);
    expect(url.searchParams.get("after")).toBe("msg_1");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("order")).toBe("asc");
    expect(url.searchParams.has("before")).toBe(false);
  });
});
