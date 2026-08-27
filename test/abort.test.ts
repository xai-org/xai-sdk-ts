import { describe, expect, it } from "vitest";
import { AbortError, APIError, xAI } from "../src/index.js";
import { createBody, mockFetch, sseResponse } from "./helpers.js";

describe("abort", () => {
  it("aborts while preprocessing a Blob input", async () => {
    class SlowBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return new Promise(() => {});
      }
    }
    const ac = new AbortController();
    const { fetch, captured } = mockFetch(() => sseResponse([]));
    const pending = new xAI({ apiKey: "test-key", fetch, maxRetries: 0 }).responses.create(
      {
        model: "grok-4.6",
        input: [
          {
            role: "user",
            content: [{ type: "input_image", image: new SlowBlob(["image"]) }],
          },
        ],
      },
      { signal: ac.signal },
    );
    ac.abort();
    await expect(pending).rejects.toSatisfy(
      (error: unknown) => APIError.is(error) && error.isAbort(),
    );
    expect(captured.requests).toHaveLength(0);
  });

  it("throws AbortError when the signal aborts mid-stream", async () => {
    const ac = new AbortController();
    const { fetch } = mockFetch(() =>
      sseResponse(
        [{ type: "response.created", response: { id: "resp_s", status: "in_progress", output: [] } }],
        { hang: true },
      ),
    );
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true }, { signal: ac.signal });
    const iter = stream[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.value).toMatchObject({ type: "response.created" });
    ac.abort();
    await expect(iter.next()).rejects.toSatisfy(
      (err: unknown) => APIError.is(err) && err.isAbort() && err instanceof AbortError,
    );
  });

  it("closes the socket explicitly", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const { fetch } = mockFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "ping" })}\n\n`,
                ),
              );
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req_test" } },
        ),
    );
    const client = new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const stream = await client.responses.create({ ...createBody, stream: true });
    await stream.close();
    expect(cancelled).toBe(true);
  });

  it("close cancels an active pending iteration", async () => {
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
    const stream = await new xAI({ apiKey: "test-key", fetch, maxRetries: 0 }).responses.create({
      ...createBody,
      stream: true,
    });
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "ping" } });
    const pending = iterator.next();
    await stream.close();
    await expect(pending).resolves.toMatchObject({ done: true });
    expect(cancelled).toBe(true);
  });
});
