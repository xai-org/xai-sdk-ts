import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceXSI } from "../src/index.js";
import { completedResponse, createBody, erroringSse, jsonResponse, mockFetch, sseResponse } from "./helpers.js";

const completed = [{ type: "response.completed", response: completedResponse }];

function client(fetch: typeof globalThis.fetch): SpaceXSI {
  return new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

function watermark(on: boolean): Record<string, string> {
  return on ? { "x-watermark": "true" } : {};
}

describe("watermarked", () => {
  describe.each<[boolean, string, Record<string, string>]>([
    [true, "x-watermark: true", { "x-watermark": "true" }],
    [true, "x-watermark: TRUE padded with spaces", { "x-watermark": " TRUE " }],
    [false, "x-watermark: false", { "x-watermark": "false" }],
    [false, "x-watermark: 1", { "x-watermark": "1" }],
    [false, "no x-watermark header", {}],
  ])("is %s with %s", (watermarked, _label, headers) => {
    it("on a stream: false response", async () => {
      const { fetch } = mockFetch(() => jsonResponse(completedResponse, { headers }));
      const response = await client(fetch).responses.create({ ...createBody, stream: false });
      expect(response.watermarked).toBe(watermarked);
    });

    it("on a stream as soon as create() returns, and on the response from done()", async () => {
      const { fetch } = mockFetch(() => sseResponse(completed, { headers }));
      const stream = await client(fetch).responses.create({ ...createBody, stream: true });
      expect(stream.watermarked).toBe(watermarked);
      expect((await stream.done()).watermarked).toBe(watermarked);
    });

    it("on create() without stream, whether the API streams the response or sends JSON", async () => {
      const streamed = mockFetch(() => sseResponse(completed, { headers }));
      expect((await client(streamed.fetch).responses.create(createBody)).watermarked).toBe(watermarked);
      const json = mockFetch(() => jsonResponse(completedResponse, { headers }));
      expect((await client(json.fetch).responses.create(createBody)).watermarked).toBe(watermarked);
    });
  });

  describe("with retryBeforeOutput", () => {
    const created = { type: "response.created", response: { id: "resp_failed", status: "in_progress", output: [] } };
    const unavailable = { type: "error", code: 503, message: "Service temporarily unavailable" };

    function retrying(handler: (req: Request, n: number) => Response) {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { fetch, captured } = mockFetch(handler);
      return { captured, client: new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 2, retryBeforeOutput: true }) };
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      [true, false],
      [false, true],
    ])("follows the attempt that produced a stream's response: %s, then %s", async (first, last) => {
      const { client } = retrying((_req, n) =>
        n === 1
          ? sseResponse([created, unavailable], { headers: watermark(first) })
          : sseResponse(completed, { headers: watermark(last) }),
      );
      const stream = await client.responses.create({ ...createBody, stream: true });
      expect(stream.watermarked).toBe(first);
      const response = await stream.done();
      expect(stream.watermarked).toBe(last);
      expect(response.watermarked).toBe(last);
    });

    it.each([
      [true, false],
      [false, true],
    ])("follows the attempt that produced the response of create() without stream: %s, then %s", async (first, last) => {
      const { client, captured } = retrying((_req, n) => {
        if (n === 1) return erroringSse(true, watermark(first));
        if (n === 2) return sseResponse([created, unavailable], { headers: watermark(first) });
        return sseResponse(completed, { headers: watermark(last) });
      });
      const response = await client.responses.create(createBody);
      expect(captured.requests).toHaveLength(3);
      expect(response.watermarked).toBe(last);
    });

    it("follows a retry that the API answers with JSON", async () => {
      const { client } = retrying((_req, n) =>
        n === 1 ? sseResponse([created]) : jsonResponse(completedResponse, { headers: watermark(true) }),
      );
      expect((await client.responses.create(createBody)).watermarked).toBe(true);
    });
  });

  it("stays out of raw, toInput(), copies of the response, and requests", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse, { headers: watermark(true) }));
    const c = client(fetch);
    const response = await c.responses.create({ ...createBody, stream: false });
    expect(response.watermarked).toBe(true);
    expect(response.raw).toEqual(completedResponse);
    expect(response.toInput()).toEqual(completedResponse.output);
    expect({ ...response }).not.toHaveProperty("watermarked");
    expect(JSON.stringify(response)).not.toContain("watermark");

    await c.responses.create({ ...createBody, input: [...response.toInput(), { role: "user", content: "Another" }] });
    expect(captured.requests).toHaveLength(2);
    for (const request of captured.requests) {
      expect(await request.text()).not.toContain("watermark");
    }
  });

  it("comes from the header, not a field in the response body", async () => {
    const { fetch } = mockFetch(() => jsonResponse({ ...completedResponse, watermarked: true }));
    const response = await client(fetch).responses.create({ ...createBody, stream: false });
    expect(response.watermarked).toBe(false);
    expect(response.raw.watermarked).toBe(true);
  });
});
