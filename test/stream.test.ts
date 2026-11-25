import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APIError,
  APIProtocolError,
  AbortError,
  TimeoutError,
  isFunctionCall,
  isImageGenerationCall,
  SpaceXSI,
  ModelResponse,
} from "../src/index.js";
import { completedResponse, createBody, mockFetch, sseResponse, usageFixture } from "./helpers.js";

describe("responses.create stream", () => {
  it("yields SSE events, then done() resolves right away with the final response", async () => {
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
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const types: Array<string> = [];
    try {
      for await (const event of stream) {
        types.push(event.type);
      }
    } finally {
      await stream.close();
    }
    expect(types).toContain("response.output_text.delta");
    expect(types).toContain("response.completed");
    const response = await stream.done();
    expect(response.status).toBe("completed");
    expect(response.id).toBe("resp_123");
    expect(response.toText()).toBe("Hello world");
    expect(response.usage.input_tokens).toBe(usageFixture.input_tokens);
    expect(response.usage.cost_usd).toBe(1.5);
    expect(stream.http.requestId).toBe("req_test");
  });

  it("derives cost_usd from ticks-only usage and keeps unmapped usage fields", async () => {
    const contextDetails = { input_tokens: 32, output_tokens: 119 };
    const usage = { ...usageFixture, cost_in_nano_usd: undefined, context_details: contextDetails };
    const { fetch } = mockFetch(() =>
      sseResponse([{ type: "response.completed", response: { ...completedResponse, usage } }]),
    );
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const { usage: mapped } = await stream.done();
    expect(mapped.cost_usd).toBe(1.5);
    expect(mapped.cost_in_nano_usd).toBeNull();
    expect(mapped.context_details).toEqual(contextDetails);
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
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const deltas: Array<string> = [];
    for await (const event of stream) {
      if (event.type === "response.function_call_arguments.delta") deltas.push(event.delta);
    }
    expect(deltas).toEqual(['{"loc"', ':"SF"}']);
    const [call] = (await stream.done()).output.filter(isFunctionCall);
    expect(JSON.parse(call?.arguments ?? "")).toEqual({ loc: "SF" });
  });

  it("types image generation progress events and keeps the finished call", async () => {
    const call = {
      type: "image_generation_call",
      id: "ig_1",
      status: "completed",
      prompt: "A corgi surfing a big wave",
      result: "aW1hZ2U=",
    };
    const progress = [
      "response.image_generation_call.in_progress",
      "response.image_generation_call.generating",
      "response.image_generation_call.completed",
    ];
    const { fetch } = mockFetch(() =>
      sseResponse([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "image_generation_call", id: "ig_1", status: "in_progress" },
        },
        ...progress.map((type) => ({ type, item_id: "ig_1", output_index: 0 })),
        { type: "response.output_item.done", output_index: 0, item: call },
        { type: "response.completed", response: { ...completedResponse, output: [call] } },
      ]),
    );
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({
      ...createBody,
      tools: [{ type: "image_generation" }],
      stream: true,
    });
    const seen: Array<string> = [];
    const doneItems: Array<unknown> = [];
    for await (const event of stream) {
      if (event.type.startsWith("response.image_generation_call.")) seen.push(event.type);
      if (event.type === "response.output_item.done" && isImageGenerationCall(event.item)) {
        doneItems.push(event.item);
      }
    }
    expect(seen).toEqual(progress);
    expect(doneItems).toEqual([call]);
    expect((await stream.done()).output.filter(isImageGenerationCall)).toEqual([call]);
  });

  it("surfaces unknown wire events as type unknown", async () => {
    const { fetch } = mockFetch(() =>
      sseResponse([
        { type: "response.weird_new_event", foo: 1 },
        { type: "response.completed", response: completedResponse },
      ]),
    );
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const types: Array<string> = [];
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
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const events = [];
    for await (const event of stream) events.push(event);
    const errEvent = events.find((e) => e.type === "error") as {
      type: "error";
      error?: { isOverloaded: () => boolean };
    };
    expect(errEvent?.error?.isOverloaded()).toBe(true);
    await expect(stream.done()).rejects.toBe(errEvent?.error);
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
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    let error: APIError | undefined;
    for await (const event of stream) {
      if (event.type === "error") error = event.error;
    }
    expect(error?.status).toBe(400);
    expect(error?.type).toBe("invalid_request_error");
    expect(error?.code).toBe("previous_response_not_found");
    expect(error?.param).toBe("previous_response_id");
    await expect(stream.done()).rejects.toBe(error);
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
    const client = new SpaceXSI({
      apiKey: "test-key",
      fetch,
      maxRetries: 0,
      timeout: 20,
      idleTimeout: 5_000,
    });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const types: Array<string> = [];
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

describe("large stream events", () => {
  const model = "grok-4.20-multi-agent";
  const reasoning = {
    type: "reasoning",
    id: "rs_agents",
    summary: [],
    encrypted_content: "e".repeat(2 * 1024 * 1024),
    status: "completed",
  };
  const response = { ...completedResponse, model, output: [reasoning, completedResponse.output[1]] };
  const events = [
    { type: "response.output_item.done", output_index: 0, item: reasoning },
    { type: "response.completed", response },
  ];

  it("reads multi-agent encrypted reasoning larger than 1 MiB in one event", async () => {
    const { fetch, captured } = mockFetch(() => sseResponse(events));
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ model, input: "Research this", stream: true });
    const streamed = await stream.done();
    const created = await client.responses.create({ model, input: "Research this" });

    for (const result of [streamed, created]) {
      expect(result.toInput()[0]).toEqual(reasoning);
      expect(result.toText()).toBe("Hello world");
    }
    for (const request of captured.requests) {
      expect(((await request.json()) as { include: Array<string> }).include).toEqual(["reasoning.encrypted_content"]);
    }
  });

  it("limits each event to maxResponseBodyBytes", async () => {
    const { fetch } = mockFetch(() => sseResponse(events));
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0, maxResponseBodyBytes: 1_048_576 });
    await expect(client.responses.create({ model, input: "Research this" })).rejects.toThrow(
      "SSE event exceeds 1048576 characters",
    );
    const stream = await client.responses.create({ model, input: "Research this", stream: true });
    await expect(stream.done()).rejects.toThrow("SSE event exceeds 1048576 characters");

    const raised = await client.responses.create(
      { model, input: "Research this" },
      { maxResponseBodyBytes: 4 * 1_048_576 },
    );
    expect(raised.output).toHaveLength(2);
  });
});

describe("stream.on and stream.done", () => {
  const events = [
    { type: "response.created", response: { id: "resp_s", status: "in_progress", output: [] } },
    { type: "response.reasoning_summary_text.delta", output_index: 0, delta: "think" },
    { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "Hello" },
    { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: " world" },
    { type: "response.completed", response: completedResponse },
  ];

  async function streamOf(sse: Array<unknown>, init: { hang?: boolean } = {}) {
    const { fetch } = mockFetch(() => sseResponse(sse, init));
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    return client.responses.create({ ...createBody, stream: true });
  }

  it("sends answer text to listeners and resolves done() to the final response", async () => {
    const stream = await streamOf(events);
    const texts: Array<string> = [];
    const response = await stream.on("text", (text) => texts.push(text)).done();
    expect(texts).toEqual(["Hello", " world"]);
    expect(response).toBeInstanceOf(ModelResponse);
    expect(response.id).toBe("resp_123");
    expect(response.toText()).toBe("Hello world");
    expect(response.usage.cost_usd).toBe(1.5);
    expect(response.http.requestId).toBe("req_test");
    expect(stream.done()).toBe(stream.done());
  });

  it("sends each event type to its listeners", async () => {
    const stream = await streamOf([
      ...events.slice(0, 3),
      { type: "response.brand_new_event", foo: 1 },
      { type: "response.completed", response: completedResponse },
    ]);
    const seen: Array<string> = [];
    await stream
      .on("text", (text) => seen.push(`text:${text}`))
      .on("response.output_text.delta", (event) => seen.push(`delta:${event.delta}`))
      .on("unknown", (event) => seen.push(`unknown:${(event.raw as { type: string }).type}`))
      .on("response.completed", (event) => seen.push(`completed:${event.response.id}`))
      .done();
    expect(seen).toEqual([
      "delta:Hello",
      "text:Hello",
      "unknown:response.brand_new_event",
      "completed:resp_123",
    ]);
  });

  it("sends reasoning, tool calls, images, and citations to helper listeners", async () => {
    const functionCall = {
      type: "function_call",
      name: "get_weather",
      call_id: "call_1",
      arguments: '{"city":"Paris"}',
      status: "completed",
    };
    const webSearch = { type: "web_search_call", id: "ws_1", action: { type: "search", query: "paris" } };
    const xSearch = {
      type: "x_search_call",
      name: "x_keyword_search",
      call_id: "xs_1",
      arguments: '{"query":"paris"}',
      status: "completed",
    };
    const customXSearch = {
      type: "custom_tool_call",
      id: "ctc_1",
      call_id: "xs_call-1",
      name: "x_semantic_search",
      input: '{"query":"paris"}',
      status: "completed",
    };
    const shell = { type: "shell_call", id: "sh_1", call_id: "call_2", action: { commands: ["ls"] }, status: "completed" };
    const image = { type: "image_generation_call", id: "ig_1", status: "completed", result: "aW1hZ2U=" };
    const message = {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: "Sunny",
          annotations: [
            { type: "url_citation", url: "https://example.com", title: "Example", start_index: 0, end_index: 5 },
            { type: "file_citation", file_id: "file_1" },
          ],
        },
        { type: "refusal", refusal: "No" },
      ],
    };
    const stream = await streamOf([
      { type: "response.reasoning_summary_text.delta", output_index: 0, delta: "Checking" },
      { type: "response.reasoning_text.delta", output_index: 0, delta: " the weather" },
      { type: "response.output_item.added", output_index: 1, item: { ...webSearch, status: "in_progress" } },
      { type: "response.output_item.done", output_index: 1, item: { ...webSearch, status: "completed" } },
      { type: "response.output_item.done", output_index: 2, item: xSearch },
      { type: "response.output_item.added", output_index: 3, item: { ...customXSearch, input: "", status: "in_progress" } },
      { type: "response.output_item.done", output_index: 3, item: customXSearch },
      { type: "response.output_item.added", output_index: 4, item: { ...functionCall, arguments: "", status: "in_progress" } },
      { type: "response.output_item.done", output_index: 4, item: functionCall },
      { type: "response.output_item.added", output_index: 5, item: { ...shell, status: "in_progress" } },
      { type: "response.output_item.done", output_index: 5, item: shell },
      { type: "response.output_item.done", output_index: 6, item: image },
      { type: "response.output_item.done", output_index: 7, item: message },
      { type: "response.output_item.done", output_index: 8, item: { type: "message", role: "assistant" } },
      { type: "response.completed", response: completedResponse },
    ]);
    const seen: Array<string> = [];
    await stream
      .on("reasoning", (text) => seen.push(`reasoning:${text}`))
      .on("tool_call", (call) => seen.push(`all:${call.type === "function_call" ? call.name : call.type}`))
      .on("server_tool_call", (call) =>
        seen.push(
          call.type === "custom_tool_call"
            ? `server:${call.name}:${String(call.input)}`
            : `server:${call.type}:${String(call.status)}`,
        ),
      )
      .on("client_tool_call", (call) =>
        seen.push(call.type === "function_call" ? `client:${call.name}:${call.arguments}` : `client:${call.type}`),
      )
      .on("image", (item) => seen.push(`image:${String(item.result)}`))
      .on("citation", (citation) => seen.push(`citation:${citation.url}`))
      .done();
    expect(seen).toEqual([
      "reasoning:Checking",
      "reasoning: the weather",
      "all:web_search_call",
      "server:web_search_call:completed",
      "all:x_search_call",
      "server:x_search_call:completed",
      "all:custom_tool_call",
      'server:x_semantic_search:{"query":"paris"}',
      "all:get_weather",
      'client:get_weather:{"city":"Paris"}',
      "all:shell_call",
      "client:shell_call",
      "all:image_generation_call",
      "server:image_generation_call:completed",
      "image:aW1hZ2U=",
      "citation:https://example.com",
    ]);
  });

  it("sends partial JSON to json listeners when the request asks for JSON output", async () => {
    const deltas = ['{"lines": [{"speaker": "A', '", "text": "Hi"}, {"spea', 'ker": "B"}]}'];
    const { fetch } = mockFetch(() =>
      sseResponse([
        ...deltas.map((delta) => ({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta })),
        { type: "response.completed", response: completedResponse },
      ]),
    );
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const format = { type: "json_schema" as const, name: "script", schema: {} };
    const seen: Array<unknown> = [];
    const stream = await client.responses.create({ ...createBody, text: { format }, stream: true });
    await stream.on("json", (value) => seen.push(value)).done();
    expect(seen).toEqual([
      { lines: [{ speaker: "A" }] },
      { lines: [{ speaker: "A", text: "Hi" }, {}] },
      { lines: [{ speaker: "A", text: "Hi" }, { speaker: "B" }] },
    ]);

    const ignored: Array<unknown> = [];
    const plain = await client.responses.create({ ...createBody, stream: true });
    await plain.on("json", (value) => ignored.push(value)).done();
    expect(ignored).toEqual([]);
  });

  it("waits for a loop that is already reading the stream", async () => {
    const stream = await streamOf(events);
    const texts: Array<string> = [];
    stream.on("text", (text) => texts.push(text));
    const types: Array<string> = [];
    let pending: Promise<ModelResponse> | undefined;
    for await (const event of stream) {
      pending ??= stream.done();
      types.push(event.type);
    }
    const response = await pending;
    expect(types).toEqual(events.map((event) => event.type));
    expect(texts).toEqual(["Hello", " world"]);
    expect(response?.toText()).toBe("Hello world");
    expect(await stream.done()).toBe(response);
  });

  it("resolves failed responses like a non-streamed request", async () => {
    const error = { code: "server_error", message: "boom" };
    const stream = await streamOf([
      { type: "response.failed", response: { ...completedResponse, status: "failed", output: [], error } },
    ]);
    const response = await stream.done();
    expect(response.status).toBe("failed");
    expect(response.error).toEqual(error);
  });

  it("rejects with a mid-stream error event", async () => {
    const stream = await streamOf([
      { type: "response.created", response: { id: "resp_s", status: "in_progress", output: [] } },
      { type: "error", code: 529, message: "overloaded" },
    ]);
    const error = await stream.done().catch((err: unknown) => err);
    expect(APIError.is(error) && error.isOverloaded()).toBe(true);
  });

  it("rejects when the stream ends without a terminal event", async () => {
    const stream = await streamOf(events.slice(0, 3));
    await expect(stream.done()).rejects.toBeInstanceOf(APIProtocolError);
  });

  it("rejects when the stream closes before the response completes", async () => {
    const stream = await streamOf(events.slice(0, 3), { hang: true });
    stream.on("text", () => void stream.close());
    const error = await stream.done().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AbortError);
    expect((error as AbortError).clientRequestId).toBe(stream.http.clientRequestId);
  });

  it("stops the stream and rejects with the error a listener throws", async () => {
    const stream = await streamOf(events);
    const boom = new Error("listener failed");
    const texts: Array<string> = [];
    const failing = stream
      .on("text", (text) => texts.push(text))
      .on("text", () => {
        throw boom;
      });
    await expect(failing.done()).rejects.toBe(boom);
    expect(texts).toEqual(["Hello"]);
  });

  it("rejects unsupported event names", async () => {
    const stream = await streamOf(events);
    expect(() => stream.on("tool_calls" as "tool_call", () => {})).toThrow(TypeError);
    await stream.close();
  });
});

describe("after the terminal event", () => {
  const completed = { type: "response.completed", response: completedResponse };
  const terminals = [
    completed,
    {
      type: "response.failed",
      response: { ...completedResponse, status: "failed", output: [], error: { code: "server_error", message: "boom" } },
    },
    {
      type: "response.incomplete",
      response: { ...completedResponse, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
    },
  ];
  const headers = { "content-type": "text/event-stream", "x-request-id": "req_test" };
  const encoder = new TextEncoder();
  const sse = (event: unknown) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Sends `terminal`, then fails like a connection that is reset before EOF or `[DONE]`. */
  function resetAfter(terminal: unknown): Response {
    let step = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (step++ === 0) {
          controller.enqueue(sse(terminal));
          return;
        }
        controller.error(new TypeError("terminated: other side closed"));
      },
    });
    return new Response(stream, { status: 200, headers });
  }

  /** Sends `terminal` and holds the body open. With `tailMs`, sends `[DONE]` and ends the body after that long. */
  function openAfter(terminal: unknown, tailMs?: number) {
    const state = { ended: false, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse(terminal));
        if (tailMs === undefined) return;
        setTimeout(() => {
          if (state.cancelled) return;
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          state.ended = true;
        }, tailMs);
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { state, response: new Response(stream, { status: 200, headers }) };
  }

  it.each(terminals)(
    "create() resolves to the $response.status response despite a reset before EOF",
    async (terminal) => {
      const { fetch } = mockFetch(() => resetAfter(terminal));
      const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
      const response = await client.responses.create({ ...createBody });
      expect(response.status).toBe(terminal.response.status);
      expect(response.id).toBe("resp_123");
    },
  );

  it.each(terminals)(
    "stream done() resolves to the $response.status response despite a reset before EOF",
    async (terminal) => {
      const { fetch } = mockFetch(() => resetAfter(terminal));
      const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
      const stream = await client.responses.create({ ...createBody, stream: true });
      const types: Array<string> = [];
      for await (const event of stream) types.push(event.type);
      expect(types).toEqual([terminal.type]);
      const response = await stream.done();
      expect(response.status).toBe(terminal.response.status);
    },
  );

  it.each(terminals)(
    "stops reading and cancels the body when the server holds it open after $type",
    async (terminal) => {
      const body = openAfter(terminal);
      const { fetch } = mockFetch(() => body.response);
      // The request timeout is far longer than the test timeout, so this only passes if the stream stops on its own.
      const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0, timeout: 600_000 });
      const response = await client.responses.create({ ...createBody });
      expect(response.status).toBe(terminal.response.status);
      expect(body.state.cancelled).toBe(true);
    },
  );

  it("does not deliver later events to the loop or to listeners", async () => {
    const delta = (text: string) => ({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text });
    const { fetch } = mockFetch(() =>
      sseResponse([delta("Hello"), completed, delta(" again"), { type: "error", code: 529, message: "overloaded" }]),
    );
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    const heard: Array<string> = [];
    stream.on("text", (text) => heard.push(text)).on("error", () => heard.push("error"));
    const types: Array<string> = [];
    for await (const event of stream) types.push(event.type);
    expect(types).toEqual(["response.output_text.delta", "response.completed"]);
    expect(heard).toEqual(["Hello"]);
    expect((await stream.done()).status).toBe("completed");
  });

  it("reads a tail that arrives a few milliseconds later to the end of the body", async () => {
    vi.useFakeTimers();
    const body = openAfter(completed, 5);
    const { fetch } = mockFetch(() => body.response);
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const resolved = expect(client.responses.create({ ...createBody })).resolves.toMatchObject({ status: "completed" });
    await vi.advanceTimersByTimeAsync(5);
    await resolved;
    expect(body.state).toEqual({ ended: true, cancelled: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits 250 ms for the end of a body that is held open, then cancels it", async () => {
    vi.useFakeTimers();
    const body = openAfter(completed);
    const { fetch } = mockFetch(() => body.response);
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    let settled = false;
    const pending = client.responses.create({ ...createBody }).finally(() => {
      settled = true;
    });
    const resolved = expect(pending).resolves.toMatchObject({ status: "completed" });
    await vi.advanceTimersByTimeAsync(249);
    expect(settled).toBe(false);
    expect(body.state.cancelled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await resolved;
    expect(body.state.cancelled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores the caller's abort while it reads the rest of the body", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const { fetch } = mockFetch(() => openAfter(completed).response);
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const resolved = expect(client.responses.create({ ...createBody }, { signal: ac.signal })).resolves.toMatchObject({
      status: "completed",
    });
    await vi.advanceTimersByTimeAsync(10);
    ac.abort();
    await resolved;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["the request timeout", { timeout: 100 }],
    ["an idle timeout", { idleTimeout: 100 }],
  ])("ignores %s while it reads the rest of the body", async (_label, opts) => {
    vi.useFakeTimers();
    const { fetch } = mockFetch(() => openAfter(completed).response);
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const resolved = expect(client.responses.create({ ...createBody }, opts)).resolves.toMatchObject({
      status: "completed",
    });
    await vi.advanceTimersByTimeAsync(100);
    await resolved;
    expect(vi.getTimerCount()).toBe(0);
  });
});
