import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceXSI } from "../src/index.js";
import { mockFetch } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("per-attempt timeout timer does not keep the process alive", () => {
  it("clears the timer when the request fails before it is sent", async () => {
    vi.useFakeTimers();
    // A baseURL without a scheme makes `new Request(url, ...)` throw after the attempt timer is armed.
    const client = new SpaceXSI({ apiKey: "test-key", baseURL: "api.x.ai/v1", maxRetries: 0, timeout: 3_600_000 });
    await expect(client.models.list()).rejects.toBeInstanceOf(TypeError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unrefs the timer while a binary body is left unread", async () => {
    const timeout = 3_600_000;
    // Node's Timeout, which has hasRef().
    const handles: Array<{ hasRef(): boolean }> = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...args: Array<unknown>) => {
      const handle = realSetTimeout(fn, ms, ...args);
      if (ms === timeout) handles.push(handle as unknown as { hasRef(): boolean });
      return handle;
    }) as typeof setTimeout);

    const { fetch } = mockFetch(
      () =>
        new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: { "content-type": "application/pdf", "x-request-id": "req_test" },
        }),
    );
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0, timeout });
    const content = await client.files.content("file_1");
    expect(content.contentType).toBe("application/pdf");

    expect(handles.length).toBeGreaterThan(0);
    for (const handle of handles) {
      expect(handle.hasRef()).toBe(false);
      clearTimeout(handle as never);
    }
  });
});
