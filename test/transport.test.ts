import { describe, expect, it } from "vitest";
import { APIError, TimeoutError, SpaceXAI, ModelResponse } from "../src/index.js";
import { completedResponse, createBody, jsonResponse, mockFetch, sseResponse } from "./helpers.js";

const created = { type: "response.created", response: { id: "resp_s", status: "in_progress", output: [] } };
const completed = { type: "response.completed", response: completedResponse };

function pausingSse(pauseMs: number): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(created)}\n\n`));
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(completed)}\n\n`));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream", "x-request-id": "req_test" } },
  );
}

describe("responses.create without stream", () => {
  it("streams under the hood and resolves to the final response", async () => {
    const { fetch, captured } = mockFetch(() => sseResponse([created, completed]));
    const response = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    const body = (await captured.requests[0]?.json()) as { stream: boolean };
    expect(body.stream).toBe(true);
    expect(captured.requests[0]?.headers.get("accept")).toBe("text/event-stream");
    expect(response).toBeInstanceOf(ModelResponse);
    expect(response.toText()).toBe("Hello world");
    expect(response.usage.cost_usd).toBe(1.5);
    expect(response.http.requestId).toBe("req_test");
    expect(response.raw).toEqual(completedResponse);
  });

  it("accepts a JSON response in place of the stream", async () => {
    const { fetch } = mockFetch(() => jsonResponse(completedResponse));
    const response = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    expect(response.id).toBe("resp_123");
  });

  it("waits through silences longer than the client idle timeout", async () => {
    const { fetch } = mockFetch(() => pausingSse(60));
    const client = new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0, idleTimeout: 20 });
    await expect(client.responses.create(createBody)).resolves.toBeInstanceOf(ModelResponse);
    const stream = await client.responses.create({ ...createBody, stream: true });
    await expect(stream.done()).rejects.toBeInstanceOf(TimeoutError);
  });

  it("applies an idle timeout passed on the request", async () => {
    const { fetch } = mockFetch(() => pausingSse(60));
    const client = new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 });
    await expect(client.responses.create(createBody, { idleTimeout: 20 })).rejects.toBeInstanceOf(TimeoutError);
  });

  it("rejects with a mid-stream error event", async () => {
    const { fetch } = mockFetch(() => sseResponse([created, { type: "error", code: 529, message: "overloaded" }]));
    const client = new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 });
    const error = await client.responses.create(createBody).catch((err: unknown) => err);
    expect(APIError.is(error) && error.isOverloaded()).toBe(true);
  });

  it("captures the final response object when http.body is requested", async () => {
    const { fetch } = mockFetch(() => sseResponse([created, completed]));
    const client = new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 });
    const response = await client.responses.create(createBody, { http: { body: true } });
    expect(response.http.body).toEqual(completedResponse);
  });
});

describe("ModelResponse fields", () => {
  it("copies documented fields and keeps the full API object in raw", async () => {
    const wire = { ...completedResponse, temperature: 0.2, field_added_later: 1 };
    const { fetch } = mockFetch(() => jsonResponse(wire));
    const response = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create({
      ...createBody,
      stream: false,
    });
    expect(response.temperature).toBe(0.2);
    expect(response.raw.field_added_later).toBe(1);
    expect(response.raw).toEqual(wire);
  });
});
