import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceXSI } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("request timeout and idle timers do not keep the process alive", () => {
  it("clears the timer when the request fails before it is sent", async () => {
    vi.useFakeTimers();
    // The call has to fail before `fetch`. The stub keeps it off the network if it ever gets that far.
    const { fetch, captured } = mockFetch(() => jsonResponse({ object: "list", data: [] }));
    // A baseURL without a scheme makes `new Request(url, ...)` throw after the attempt timer is armed.
    const client = new SpaceXSI({
      apiKey: "test-key",
      baseURL: "api.x.ai/v1",
      fetch,
      maxRetries: 0,
      timeout: 3_600_000,
    });
    await expect(client.models.list()).rejects.toBeInstanceOf(TypeError);
    expect(captured.requests).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer when the signal is not an AbortSignal", async () => {
    vi.useFakeTimers();
    const { fetch, captured } = mockFetch(() => jsonResponse({ object: "list", data: [] }));
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0, timeout: 3_600_000 });
    // An AbortController in place of its `.signal` makes `AbortSignal.any()` throw after the attempt timer is armed.
    const signal = new AbortController() as unknown as AbortSignal;
    await expect(client.models.list({ signal })).rejects.toBeInstanceOf(TypeError);
    expect(captured.requests).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unrefs the request and idle timers while a binary body is pending or left unread", async () => {
    const timeout = 3_600_000;
    const idleTimeout = 1_800_000;
    const requestTimers: Array<NodeJS.Timeout> = [];
    const idleTimers: Array<NodeJS.Timeout> = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...args: Array<unknown>) => {
      // Node's Timeout, which has hasRef().
      const handle = realSetTimeout(fn, ms, ...args) as unknown as NodeJS.Timeout;
      if (ms === timeout) requestTimers.push(handle);
      if (ms === idleTimeout) idleTimers.push(handle);
      return handle;
    }) as typeof setTimeout);

    try {
      let deliver!: () => void;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          deliver = () => controller.enqueue(new Uint8Array([37, 80, 68, 70]));
        },
      });
      const { fetch } = mockFetch(
        () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/pdf", "x-request-id": "req_test" },
          }),
      );
      const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0, timeout, idleTimeout });
      const pending = client.files.content("file_1");

      // Both timers are armed while the SDK waits for the first chunk.
      await vi.waitFor(() => expect(idleTimers).toHaveLength(1));
      expect(requestTimers).toHaveLength(1);
      expect(requestTimers[0]?.hasRef()).toBe(false);
      expect(idleTimers[0]?.hasRef()).toBe(false);

      // The request timer stays armed after the call resolves, until the body is read or cancelled.
      deliver();
      const content = await pending;
      expect(content.contentType).toBe("application/pdf");
      expect(requestTimers[0]?.hasRef()).toBe(false);
    } finally {
      for (const handle of [...requestTimers, ...idleTimers]) clearTimeout(handle);
    }
  });
});
