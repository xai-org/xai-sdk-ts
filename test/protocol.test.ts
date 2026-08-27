import { describe, expect, it } from "vitest";
import { APIProtocolError, xAI } from "../src/index.js";
import { createBody, jsonResponse, mockFetch, sseResponse } from "./helpers.js";

describe("API protocol validation", () => {
  it("rejects a non-object Responses success body", async () => {
    const { fetch } = mockFetch(
      () =>
        new Response("<html>ok</html>", {
          status: 200,
          headers: { "content-type": "text/html", "x-request-id": "req_html" },
        }),
    );
    await expect(
      new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody),
    ).rejects.toMatchObject({
      name: "APIProtocolError",
      requestId: "req_html",
    });
  });

  it("rejects malformed model-list and delete bodies", async () => {
    const models = mockFetch(() => jsonResponse("not a model list"));
    await expect(
      new xAI({ apiKey: "k", fetch: models.fetch, maxRetries: 0 }).models.list(),
    ).rejects.toBeInstanceOf(APIProtocolError);

    const deletion = mockFetch(
      () => new Response(null, { status: 200, headers: { "x-request-id": "req_delete" } }),
    );
    await expect(
      new xAI({ apiKey: "k", fetch: deletion.fetch, maxRetries: 0 }).responses.delete("resp_1"),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });

  it("requires text/event-stream for streaming responses", async () => {
    const { fetch } = mockFetch(() => jsonResponse({ error: { message: "wrong protocol" } }));
    await expect(
      new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create({
        ...createBody,
        stream: true,
      }),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });

  it("requires a terminal response event before a stream ends", async () => {
    const { fetch } = mockFetch(() => sseResponse([{ type: "ping" }]));
    const stream = await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create({
      ...createBody,
      stream: true,
    });
    await expect(async () => {
      for await (const _ of stream) {
        // drain
      }
    }).rejects.toBeInstanceOf(APIProtocolError);
  });

  it("validates the response attached to a terminal stream event", async () => {
    const { fetch } = mockFetch(() =>
      sseResponse([{ type: "response.completed", response: { status: "completed" } }]),
    );
    const stream = await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create({
      ...createBody,
      stream: true,
    });
    await expect(async () => {
      for await (const _ of stream) {
        // drain
      }
    }).rejects.toBeInstanceOf(APIProtocolError);
  });
});
