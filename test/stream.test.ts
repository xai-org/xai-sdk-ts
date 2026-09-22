import { describe, expect, it } from "vitest";
import { APIError, TimeoutError, xAI } from "../src/index.js";
import { completedResponse, createBody, mockFetch, sseResponse, usageFixture } from "./helpers.js";

describe("responses.create stream", () => {
  it("yields SSE events then exposes the final result on the stream object", async () => {
    const events = [
      { type: "response.created", response: { id: "resp_s", status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { type: "message", role: "assistant", content: [] } },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hel" },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "lo" },
      { type: "response.output_item.done", output_index: 0, item: completedResponse.output[1] },
      {
        type: "response.completed",
        response: completedResponse,
      },
    ];
    const { fetch } = mockFetch(() => sseResponse(events));
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const types: string[] = [];
    try {
      for await (const event of stream) {
        types.push(event.type);
      }
    } finally {
      await stream.close();
    }
    expect(types).toContain("response.output_text.delta");
    expect(types).toContain("response.completed");
    expect(stream.status).toBe("completed");
    expect(stream.id).toBe("resp_123");
    expect(stream.toText()).toBe("Hello world");
    expect(stream.usage.input_tokens).toBe(usageFixture.input_tokens);
    expect(stream.usage.cost_usd).toBe(1.5);
    expect(stream.http.requestId).toBe("req_test");
  });

  it("derives cost_usd from ticks-only usage and keeps unmapped usage fields", async () => {
    const contextDetails = { input_tokens: 32, output_tokens: 119 };
    const usage = { ...usageFixture, cost_in_nano_usd: undefined, context_details: contextDetails };
    const { fetch } = mockFetch(() =>
      sseResponse([{ type: "response.completed", response: { ...completedResponse, usage } }]),
    );
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    for await (const _ of stream) {
      // drain
    }
    expect(stream.usage.cost_usd).toBe(1.5);
    expect(stream.usage.cost_in_nano_usd).toBeNull();
    expect(stream.usage.context_details).toEqual(contextDetails);
  });

  it("keeps function-call argument deltas as fragments until output_item.done", async () => {
    const events = [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "function_call", name: "get_temp", call_id: "call_1", arguments: "" },
      },
      { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"loc"' },
      { type: "response.function_call_arguments.delta", output_index: 0, delta: ':"SF"}' },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          name: "get_temp",
          call_id: "call_1",
          arguments: '{"loc":"SF"}',
        },
      },
      {
        type: "response.completed",
        response: {
          id: "resp_fc",
          status: "completed",
          output: [
            {
              type: "function_call",
              name: "get_temp",
              call_id: "call_1",
              arguments: '{"loc":"SF"}',
            },
          ],
          usage: usageFixture,
        },
      },
    ];
    const { fetch } = mockFetch(() => sseResponse(events));
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const deltas: string[] = [];
    for await (const event of stream) {
      if (event.type === "response.function_call_arguments.delta") deltas.push(event.delta);
    }
    expect(deltas).toEqual(['{"loc"', ':"SF"}']);
    const item = stream.output[0] as { arguments: string };
    expect(JSON.parse(item.arguments)).toEqual({ loc: "SF" });
  });

  it("surfaces unknown wire events as type unknown", async () => {
    const { fetch } = mockFetch(() =>
      sseResponse([
        { type: "response.weird_new_event", foo: 1 },
        { type: "response.completed", response: completedResponse },
      ]),
    );
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const types: string[] = [];
    for await (const event of stream) types.push(event.type);
    expect(types[0]).toBe("unknown");
  });

  it("yields mid-stream 529 as an OverloadedError error event", async () => {
    const { fetch } = mockFetch(() =>
      sseResponse([
        { type: "response.created", response: { id: "resp_s", status: "in_progress", output: [] } },
        { type: "error", code: 529, message: "overloaded" },
      ]),
    );
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const events = [];
    for await (const event of stream) events.push(event);
    const errEvent = events.find((e) => e.type === "error") as {
      type: "error";
      error?: { isOverloaded: () => boolean };
    };
    expect(errEvent?.error?.isOverloaded()).toBe(true);
    expect(stream.status).toBe("failed");
  });

  it("normalizes nested stream error details", async () => {
    const { fetch } = mockFetch(() =>
      sseResponse([
        {
          type: "error",
          status: 400,
          error: {
            type: "invalid_request_error",
            code: "previous_response_not_found",
            param: "previous_response_id",
            message: "Previous response not found",
          },
        },
      ]),
    );
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    let error: APIError | undefined;
    for await (const event of stream) {
      if (event.type === "error") error = event.error;
    }
    expect(error?.status).toBe(400);
    expect(error?.type).toBe("invalid_request_error");
    expect(error?.code).toBe("previous_response_not_found");
    expect(error?.param).toBe("previous_response_id");
    expect(stream.status).toBe("failed");
  });

  it("keeps the overall timeout active after the first SSE byte", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const { fetch } = mockFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"type":"ping"}\n\n'));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "text/event-stream", "x-request-id": "req_test" } },
        ),
    );
    const client = new xAI({
      apiKey: "test-key",
      fetch,
      maxRetries: 0,
      timeout: 20,
      idleTimeout: 5_000,
    });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const types: string[] = [];
    let caught: unknown;
    try {
      for await (const event of stream) types.push(event.type);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TimeoutError);
    expect((caught as TimeoutError).requestId).toBe("req_test");
    expect(types).toContain("ping");
    expect(cancelled).toBe(true);
  });
});
