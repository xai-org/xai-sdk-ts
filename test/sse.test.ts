import { describe, expect, it } from "vitest";
import { parseSse } from "../src/sse.js";

function streamFrom(chunks: Array<string>): ReadableStream<Uint8Array> {
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

function chunked(text: string, size: number): Array<string> {
  const chunks: Array<string> = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

async function collect(
  body: ReadableStream<Uint8Array>,
  opts?: Parameters<typeof parseSse>[1],
): Promise<Array<unknown>> {
  const out: Array<unknown> = [];
  for await (const item of parseSse(body, opts)) out.push(item);
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

  it("parses an event larger than 1 MiB that arrives in small chunks", async () => {
    const event = {
      type: "response.output_item.done",
      item: { type: "reasoning", encrypted_content: "e".repeat(1_500_000) },
    };
    const events = await collect(streamFrom(chunked(`data: ${JSON.stringify(event)}\n\n`, 16_384)));
    expect(events).toEqual([event]);
  });

  it("reads a long event without rescanning it for every chunk", async () => {
    // Splitting the whole buffer per 4 KiB chunk takes longer than the test timeout here.
    const event = { type: "ping", padding: "x".repeat(16 * 1024 * 1024) };
    const events = await collect(streamFrom(chunked(`data: ${JSON.stringify(event)}\n\n`, 4096)));
    expect(events).toEqual([event]);
  });

  it("finds a blank line split across chunks", async () => {
    const events = await collect(
      streamFrom(['data: {"type":"ping"}\r', "\n\r", '\ndata: {"type":"response.completed"}\n', "\n"]),
    );
    expect(events).toEqual([{ type: "ping" }, { type: "response.completed" }]);
  });

  it("rejects an event longer than maxEventChars, terminated or not", async () => {
    const limit = { maxEventChars: 32 };
    await expect(collect(streamFrom([`data: ${"x".repeat(32)}`]), limit)).rejects.toThrow(
      "SSE event exceeds 32 characters",
    );
    await expect(collect(streamFrom(["data: ", "x".repeat(32)]), limit)).rejects.toThrow(
      "SSE event exceeds 32 characters",
    );
    await expect(collect(streamFrom([`data: "${"x".repeat(32)}"\n\n`]), limit)).rejects.toThrow(
      "SSE event exceeds 32 characters",
    );
  });

  it("parses events of any length when maxEventChars is 0", async () => {
    const event = { type: "ping", padding: "x".repeat(64) };
    expect(await collect(streamFrom([`data: ${JSON.stringify(event)}\n\n`]), { maxEventChars: 0 })).toEqual([event]);
  });
});