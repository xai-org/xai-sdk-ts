import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_TIMEOUT_MS } from "../src/constants.js";
import { SpaceXSI, TimeoutError } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

// Node and browsers keep a timer delay in a signed 32-bit integer, so 2^31 ms, about 24.8 days, overflows and
// fires at once unless the SDK caps it.
const OVER_RANGE_MS = 2_147_483_648;

// Every option caps these at 24 hours.
const OVER_CAP: Array<[string, number]> = [
  ["Infinity", Number.POSITIVE_INFINITY],
  ["2^31", OVER_RANGE_MS],
  ["one past the cap", MAX_TIMEOUT_MS + 1],
];

// These count as 0, which is the cap for a request or idle timeout, and no wait for a wait() timeout or interval.
const NOT_POSITIVE: Array<[string, number]> = [
  ["0", 0],
  ["NaN", Number.NaN],
  ["-Infinity", Number.NEGATIVE_INFINITY],
];

const doneVideo = {
  status: "done",
  video: { url: "https://vidgen.x.ai/xai-vidgen-bucket/xai-video-req_1.mp4", duration: 8, respect_moderation: true },
};

function pendingVideo(): Response {
  return new Response(null, { status: 202, headers: { "x-request-id": "req_test" } });
}

function waitForVideo(fetch: typeof globalThis.fetch, opts: { interval?: number; timeout?: number }) {
  return new SpaceXSI({ apiKey: "k", fetch, maxRetries: 0 }).videos.wait("req_1", opts);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("request timeout", () => {
  it.each([...OVER_CAP, ...NOT_POSITIVE])("%s times out after 24 hours", async (_label, timeout) => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => new Promise<Response>(() => {}));
    const pending = new SpaceXSI({ apiKey: "k", fetch, maxRetries: 0, timeout }).responses.create({
      model: "grok-4.7",
      input: "hi",
      stream: false,
    });
    const rejection = expect(pending).rejects.toSatisfy(
      (error: unknown) => error instanceof TimeoutError && error.message === "Request timed out",
    );

    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS - 1);
    expect(captured.requests[0]?.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(captured.requests[0]?.signal.aborted).toBe(true);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("idleTimeout", () => {
  it.each([...OVER_CAP, ...NOT_POSITIVE])("%s waits up to 24 hours for the next chunk", async (_label, idleTimeout) => {
    vi.useFakeTimers();
    let deliver!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        deliver = () => {
          controller.enqueue(new TextEncoder().encode("abc"));
          controller.close();
        };
      },
    });
    const { fetch } = mockFetch(
      () => new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } }),
    );
    const client = new SpaceXSI({ apiKey: "k", fetch, maxRetries: 0, timeout: MAX_TIMEOUT_MS, idleTimeout });
    const pending = client.files.content("file_1");

    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS - 1);
    // The request timeout and the idle timeout are both armed. The request timeout started first and has the
    // same 24-hour cap, so an idle timer at the cap never fires before it.
    expect(vi.getTimerCount()).toBe(2);
    deliver();
    const file = await pending;
    expect(await file.text()).toBe("abc");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("wait() timeout", () => {
  it.each(OVER_CAP)("%s times out after 24 hours", async (_label, timeout) => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => pendingVideo());
    const pending = waitForVideo(fetch, { interval: 3_600_000, timeout });
    const rejection = expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TimeoutError &&
        error.message === `Video request req_1 did not finish within ${MAX_TIMEOUT_MS}ms`,
    );

    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS - 1);
    expect(captured.requests).toHaveLength(24);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(captured.requests).toHaveLength(24);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(NOT_POSITIVE)("%s expires at once", async (_label, timeout) => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => pendingVideo());
    const pending = waitForVideo(fetch, { timeout });
    const rejection = expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TimeoutError && error.message === "Video request req_1 did not finish within 0ms",
    );

    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(captured.requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("wait() interval", () => {
  it.each(OVER_CAP)("%s polls once and then waits for a 24-hour timeout", async (_label, interval) => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => pendingVideo());
    const pending = waitForVideo(fetch, { interval, timeout: MAX_TIMEOUT_MS });
    const rejection = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    // The wait() timeout started first and has the same 24-hour cap, so it fires before a second poll.
    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS - 1);
    expect(captured.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(captured.requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(NOT_POSITIVE)("%s polls again without waiting", async (_label, interval) => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch((_req, n) => (n < 3 ? pendingVideo() : jsonResponse(doneVideo)));
    const pending = waitForVideo(fetch, { interval });

    await vi.advanceTimersByTimeAsync(0);
    expect(captured.requests).toHaveLength(3);
    expect((await pending).status).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });
});
