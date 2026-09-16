import { describe, expect, it } from "vitest";
import { MAX_SSE_EVENT_CHARS, parseSse } from "../src/sse.js";
import { MAX_STREAM_INDEX } from "../src/constants.js";
import { xAI } from "../src/index.js";
import { createBody, mockFetch, sseResponse } from "./helpers.js";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of parseSse(body)) out.push(item);
  return out;
}

describe("parseSse", () => {
  it("parses CRLF, comments, ping, and multiline data", async () => {
    const events = await collect(
      streamFrom([
        ": keep-alive\r\n\r\n",
        "event: ping\r\n\r\n",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hel\"}\r\n\r\n",
        "data: {\"type\":\"response.completed\"",
        ",\"response\":{\"id\":\"r1\"}}\n\n",
      ]),
    );
    expect(events).toEqual([
      { type: "ping" },
      { type: "response.output_text.delta", delta: "hel" },
      { type: "response.completed", response: { id: "r1" } },
    ]);
  });

  it("emits a final event without a trailing blank line", async () => {
    const events = await collect(
      streamFrom(['data: {"type":"response.completed","response":{"id":"eof"}}\n']),
    );
    expect(events).toEqual([{ type: "response.completed", response: { id: "eof" } }]);
  });

  it("supports bare CR line and event delimiters", async () => {
    const events = await collect(
      streamFrom([
        'data: {"type":"ping"}\r\rdata: {"type":"response.completed","response":{"id":"cr"}}\r\r',
      ]),
    );
    expect(events).toEqual([
      { type: "ping" },
      { type: "response.completed", response: { id: "cr" } },
    ]);
  });

  it("stops on [DONE]", async () => {
    const events = await collect(
      streamFrom(["data: {\"type\":\"ping\"}\n\ndata: [DONE]\n\ndata: {\"type\":\"ignored\"}\n\n"]),
    );
    expect(events).toEqual([{ type: "ping" }]);
  });

  it("wraps non-JSON data as unknown", async () => {
    const events = await collect(streamFrom(["data: not-json\n\n"]));
    expect(events).toEqual([{ type: "unknown", raw: "not-json" }]);
  });

  it("rejects an unterminated oversized event", async () => {
    await expect(
      collect(streamFrom([`data: ${"x".repeat(MAX_SSE_EVENT_CHARS + 1)}`])),
    ).rejects.toThrow(/SSE event exceeds/);
  });
});

describe("stream index cap", () => {
  it("rejects hostile output_index values", async () => {
    const { fetch } = mockFetch(() =>
      sseResponse([
        {
          type: "response.output_item.added",
          output_index: MAX_STREAM_INDEX + 1,
          item: { type: "message", role: "assistant", content: [] },
        },
      ]),
    );
    const stream = await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create({
      ...createBody,
      stream: true,
    });
    await expect(async () => {
      for await (const _ of stream) {
        // drain
      }
    }).rejects.toThrow(/Invalid stream index/);
  });
});
