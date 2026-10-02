import { describe, expect, it, vi } from "vitest";
import { SpaceXAI, SDK_VERSION } from "../src/index.js";
import { completedResponse, createBody, jsonResponse, mockFetch, usageFixture } from "./helpers.js";

function client(fetch: typeof globalThis.fetch): SpaceXAI {
  return new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

describe("responses.create", () => {
  it("blocks browser credentials unless explicitly opted in", () => {
    const { fetch } = mockFetch(() => jsonResponse(completedResponse));
    vi.stubGlobal("window", { document: {} });
    try {
      expect(() => new SpaceXAI({ apiKey: "test-key", fetch })).toThrow(/use is disabled/);
      expect(
        () => new SpaceXAI({ apiKey: "test-key", fetch, dangerouslyAllowBrowser: true }),
      ).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("blocks worker credentials unless explicitly opted in", () => {
    const { fetch } = mockFetch(() => jsonResponse(completedResponse));
    vi.stubGlobal("WorkerGlobalScope", class WorkerGlobalScope {});
    try {
      expect(() => new SpaceXAI({ apiKey: "test-key", fetch })).toThrow(/worker use is disabled/);
      expect(
        () => new SpaceXAI({ apiKey: "test-key", fetch, dangerouslyAllowBrowser: true }),
      ).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates a text response with usage, http, toText, and toInput", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    const res = await client(fetch).responses.create(createBody);

    expect(captured.requests).toHaveLength(1);
    expect(captured.requests[0]?.url).toBe("https://api.x.ai/v1/responses");
    expect(captured.requests[0]?.method).toBe("POST");
    expect(captured.requests[0]?.redirect).toBe("error");
    expect(captured.requests[0]?.headers.get("authorization")).toBe("Bearer test-key");
    expect(captured.requests[0]?.headers.get("user-agent")).toBe(`xai-sdk/${SDK_VERSION} (typescript)`);
    expect(captured.requests[0]?.headers.get("xai-sdk-version")).toBe(`typescript/${SDK_VERSION}`);
    expect(captured.requests[0]?.headers.get("xai-sdk-language")).toMatch(/^node\/\d+\.\d+$/);

    expect(res.id).toBe("resp_123");
    expect(res.status).toBe("completed");
    expect(res.toText()).toBe("Hello world");
    expect(res.toInput()).toEqual(completedResponse.output);
    expect(res.toInput().some((item) => item && (item as { type?: string }).type === "reasoning")).toBe(true);
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
    expect(res.usage.input_tokens).toBe(usageFixture.input_tokens);
    expect(res.usage.cost_in_nano_usd).toBe(1_500_000_000);
    expect(res.usage.cost_usd).toBe(1.5);
    expect(res.usage.cost_in_usd_ticks).toBe(15_000_000_000);
  });

  it("surfaces usage when the wire omits it on a completed result", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ ...completedResponse, usage: undefined }),
    );
    const res = await client(fetch).responses.create(createBody);
    expect(res.usage.input_tokens).toBe(0);
    expect(res.usage.cost_usd).toBeNull();
    expect(res.usage.cost_in_nano_usd).toBeNull();
    expect(res.usage.cost_in_usd_ticks).toBeNull();
  });

  it("derives cost_usd from cost_in_usd_ticks and keeps unmapped usage fields", async () => {
    const contextDetails = { input_tokens: 32, output_tokens: 119 };
    const toolDetails = { web_search_calls: 1, x_search_calls: 0 };
    const { fetch } = mockFetch(() =>
      jsonResponse({
        ...completedResponse,
        usage: {
          ...usageFixture,
          cost_in_nano_usd: undefined,
          context_details: contextDetails,
          server_side_tool_usage_details: toolDetails,
        },
      }),
    );
    const res = await client(fetch).responses.create(createBody);
    expect(res.usage.cost_in_nano_usd).toBeNull();
    expect(res.usage.cost_in_usd_ticks).toBe(15_000_000_000);
    expect(res.usage.cost_usd).toBe(1.5);
    expect(res.usage.context_details).toEqual(contextDetails);
    expect(res.usage.server_side_tool_usage_details).toEqual(toolDetails);
  });

  it("falls back to cost_in_nano_usd when the API omits cost_in_usd_ticks", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ ...completedResponse, usage: { ...usageFixture, cost_in_usd_ticks: undefined } }),
    );
    const res = await client(fetch).responses.create(createBody);
    expect(res.usage.cost_in_usd_ticks).toBeNull();
    expect(res.usage.cost_in_nano_usd).toBe(1_500_000_000);
    expect(res.usage.cost_usd).toBe(1.5);
  });

  it("prefers cost_in_usd_ticks over cost_in_nano_usd", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({
        ...completedResponse,
        usage: { ...usageFixture, cost_in_nano_usd: 1_000_000_000, cost_in_usd_ticks: 12_345_678_901 },
      }),
    );
    const res = await client(fetch).responses.create(createBody);
    expect(res.usage.cost_usd).toBe(1.2345678901);
  });

  it("returns raw body when http.body is true", async () => {
    const { fetch } = mockFetch(() => jsonResponse(completedResponse));
    const res = await client(fetch).responses.create(createBody, { http: { body: true } });
    expect(res.http.body).toMatchObject({ id: "resp_123" });
  });

  it("keeps SDK attribution headers when the caller sets them", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    await new SpaceXAI({
      apiKey: "test-key",
      fetch,
      maxRetries: 0,
      defaultHeaders: { "user-agent": "curl/8", "xai-sdk-version": "python/9.9.9" },
    }).responses.create(createBody, {
      headers: { "xai-sdk-language": "python/3.12" },
    });
    const headers = captured.requests[0]?.headers;
    expect(headers?.get("user-agent")).toBe("curl/8");
    expect(headers?.get("xai-sdk-version")).toBe(`typescript/${SDK_VERSION}`);
    expect(headers?.get("xai-sdk-language")).toMatch(/^node\/\d+\.\d+$/);
  });

  it("calls onRequest and onResponse hooks", async () => {
    const { fetch } = mockFetch(() => jsonResponse(completedResponse));
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    const c = new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 0, onRequest, onResponse });
    await c.responses.create(createBody);
    expect(onRequest).toHaveBeenCalledOnce();
    expect(onResponse).toHaveBeenCalledOnce();
    expect(onRequest.mock.calls[0]?.[0]).toBeInstanceOf(Request);
    expect(onResponse.mock.calls[0]?.[0]).toBeInstanceOf(Response);
  });

  it("XAI_DEBUG=1 prints a redacted curl", async () => {
    const prev = process.env.XAI_DEBUG;
    process.env.XAI_DEBUG = "1";
    const lines: Array<string> = [];
    const spy = vi.spyOn(console, "error").mockImplementation((msg: unknown) => {
      lines.push(String(msg));
    });
    try {
      const { fetch } = mockFetch(() => jsonResponse(completedResponse));
      await client(fetch).responses.create(createBody);
      const curl = lines.join("\n");
      expect(curl).toContain("curl -sS -X POST");
      expect(curl).toContain("Bearer [REDACTED]");
      expect(curl).not.toContain("test-key");
    } finally {
      spy.mockRestore();
      if (prev === undefined) delete process.env.XAI_DEBUG;
      else process.env.XAI_DEBUG = prev;
    }
  });

  it("inlines Blob image parts to data URLs", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    const blob = new Blob(["png-bytes"], { type: "image/png" });
    await client(fetch).responses.create({
      model: "grok-4.6",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "what is this?" },
            { type: "input_image", image: blob },
          ],
        },
      ],
    });
    const body = (await captured.requests[0]?.json()) as {
      input: Array<{ content: Array<{ type: string; image_url?: string }> }>;
    };
    const image = body.input[0]?.content[1];
    expect(image?.type).toBe("input_image");
    expect(image?.image_url).toMatch(/^data:image\/png;base64,/);
    expect(image).not.toHaveProperty("image");
  });

  it("detects the image type of an untyped Blob image part", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(completedResponse));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await client(fetch).responses.create({
      model: "grok-4.6",
      input: [{ role: "user", content: [{ type: "input_image", image: new Blob([png]) }] }],
    });
    const body = (await captured.requests[0]?.json()) as {
      input: Array<{ content: Array<{ image_url?: string }> }>;
    };
    expect(body.input[0]?.content[0]?.image_url).toMatch(/^data:image\/png;base64,/);
  });

  it("get/delete/inputItems.list/models hit the documented paths", async () => {
    const { fetch, captured } = mockFetch(async (req) => {
      if (req.url.endsWith("/models")) {
        return jsonResponse({
          object: "list",
          data: [{ id: "grok-4.6", object: "model", created: 1, owned_by: "xai" }],
        });
      }
      if (req.url.endsWith("/models/grok-4.6")) {
        return jsonResponse({ id: "grok-4.6", object: "model", created: 1, owned_by: "xai" });
      }
      if (req.url.includes("/input_items")) {
        return jsonResponse({ object: "list", data: [{ role: "user", content: "hi" }], has_more: false });
      }
      if (req.method === "DELETE") {
        return jsonResponse({ id: "resp_123", object: "response", deleted: true });
      }
      return jsonResponse(completedResponse);
    });
    const c = client(fetch);
    await c.responses.get("resp_123");
    await c.responses.delete("resp_123");
    await c.responses.inputItems.list("resp_123", { after: "item_1", limit: 5, order: "desc" });
    await c.models.list();
    await c.models.get("grok-4.6");
    const urls = captured.requests.map((r) => `${r.method} ${r.url}`);
    expect(urls).toEqual([
      "GET https://api.x.ai/v1/responses/resp_123",
      "DELETE https://api.x.ai/v1/responses/resp_123",
      "GET https://api.x.ai/v1/responses/resp_123/input_items?after=item_1&limit=5&order=desc",
      "GET https://api.x.ai/v1/models",
      "GET https://api.x.ai/v1/models/grok-4.6",
    ]);
  });
});
