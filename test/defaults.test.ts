import { describe, expect, it } from "vitest";
import { xAI } from "../src/index.js";
import { completedResponse, jsonResponse, mockFetch } from "./helpers.js";

describe("store/include defaults", () => {
  it("defaults store to false and include to encrypted reasoning", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create({
      model: "grok-4.6",
      input: "hi",
    });
    const body = (await captured.requests[0]?.json()) as {
      store: boolean;
      include: string[];
      stream: boolean;
    };
    expect(body.store).toBe(false);
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
    expect(body.stream).toBe(false);
  });

  it("does not auto-include when store is true", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create({
      model: "grok-4.6",
      input: "hi",
      store: true,
    });
    const body = (await captured.requests[0]?.json()) as { store: boolean; include?: string[] };
    expect(body.store).toBe(true);
    expect(body.include).toBeUndefined();
  });

  it("merges encrypted reasoning into a caller include list when store is false", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create({
      model: "grok-4.6",
      input: "hi",
      store: false,
      include: ["file_search_call.results"],
    });
    const body = (await captured.requests[0]?.json()) as { include: string[] };
    expect(body.include).toEqual(["file_search_call.results", "reasoning.encrypted_content"]);
  });
});
