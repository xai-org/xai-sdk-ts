import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceXAI, TimeoutError } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

// Node and browsers keep timer delays in a signed 32-bit integer. A larger delay, such as
// `Infinity` passed to mean "no limit", overflows, so the deadline fires at once.
const OVER_RANGE_MS = 2_147_483_648;

const completedResponse = {
  id: "resp_1",
  status: "completed",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }],
};

const doneVideo = {
  status: "done",
  video: { url: "https://vidgen.x.ai/xai-vidgen-bucket/xai-video-req_1.mp4", duration: 8, respect_moderation: true },
};

function pendingVideo(): Response {
  return new Response(null, { status: 202, headers: { "x-request-id": "req_test" } });
}

function slowJson(body: unknown, ms: number): Promise<Response> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(jsonResponse(body)), ms);
  });
}

function slowCreate(timeout: number) {
  const { fetch } = mockFetch(() => slowJson(completedResponse, 30));
  return new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0, timeout }).responses.create({
    model: "grok-4.7",
    input: "hi",
    stream: false,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("timer delays outside the 32-bit range", () => {
  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["2^31", OVER_RANGE_MS],
  ])("a request timeout of %s does not time out at once", async (_label, timeout) => {
    const res = await slowCreate(timeout);
    expect(res.id).toBe("resp_1");
  });

  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["2^31", OVER_RANGE_MS],
  ])("an idle timeout of %s does not cut a slow body", async (_label, idleTimeout) => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          // An idle timer that overflowed has already cancelled the stream by now.
          if (cancelled) return;
          controller.enqueue(new TextEncoder().encode("abc"));
          controller.close();
        }, 30);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fetch } = mockFetch(
      () => new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } }),
    );
    const file = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0, idleTimeout }).files.content("file_1");
    expect(await file.text()).toBe("abc");
  });

  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["2^31", OVER_RANGE_MS],
  ])("wait() with timeout %s keeps polling until the job is done", async (_label, timeout) => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch((_req, n) => (n < 3 ? pendingVideo() : jsonResponse(doneVideo)));
    const pending = new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).videos.wait("req_1", { timeout });
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await pending;
    expect(res.status).toBe("done");
    expect(captured.requests).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wait() with interval Infinity polls once and then waits for the timeout", async () => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => pendingVideo());
    const pending = new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).videos.wait("req_1", {
      interval: Number.POSITIVE_INFINITY,
      timeout: 30_000,
    });
    const rejection = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(captured.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(captured.requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("timer values that aren't positive", () => {
  it.each([
    ["0", 0],
    ["NaN", Number.NaN],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("a request timeout of %s means no limit", async (_label, timeout) => {
    const res = await slowCreate(timeout);
    expect(res.id).toBe("resp_1");
  });

  it.each([
    ["0", 0],
    ["NaN", Number.NaN],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("a wait() timeout of %s expires at once", async (_label, timeout) => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => pendingVideo());
    const pending = new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).videos.wait("req_1", { timeout });
    const rejection = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(captured.requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
