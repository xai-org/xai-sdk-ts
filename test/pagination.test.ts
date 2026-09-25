import { describe, expect, it, vi } from "vitest";
import { APIStatusError, PermissionDeniedError, xAI } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

function client(fetch: typeof globalThis.fetch): xAI {
  return new xAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

function pages(...bodies: unknown[]) {
  return mockFetch((_req, n) => jsonResponse(bodies[n - 1]));
}

function query(req: Request | undefined): Record<string, string> {
  return Object.fromEntries(new URL(req?.url ?? "").searchParams);
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

describe("pagination", () => {
  it("follows pagination_token across pages and keeps the other query parameters", async () => {
    const { fetch, captured } = pages(
      { data: [{ id: "file_1" }, { id: "file_2" }], pagination_token: "page_2" },
      { data: [{ id: "file_3" }], pagination_token: null },
    );
    const files = await collect(client(fetch).files.list({ limit: 2 }));

    expect(files.map((file) => file.id)).toEqual(["file_1", "file_2", "file_3"]);
    expect(captured.requests.map(query)).toEqual([
      { limit: "2", sort_by: "created_at" },
      { limit: "2", pagination_token: "page_2", sort_by: "created_at" },
    ]);
  });

  it.each<[string, (c: xAI) => AsyncIterable<unknown>, string]>([
    ["batches.list", (c) => c.batches.list(), "batches"],
    ["batches.results", (c) => c.batches.results("batch_1"), "results"],
    ["batches.requests.list", (c) => c.batches.requests.list("batch_1"), "batch_request_metadata"],
    ["voice.custom.list", (c) => c.voice.custom.list(), "voices"],
  ])("iterates every page of %s", async (_label, list, key) => {
    const { fetch, captured } = pages(
      { [key]: [{ id: 1 }, { id: 2 }], pagination_token: "next" },
      { [key]: [{ id: 3 }] },
    );

    expect(await collect(list(client(fetch)))).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(query(captured.requests[1]).pagination_token).toBe("next");
  });

  it("follows has_more and last_id for response input items", async () => {
    const { fetch, captured } = pages(
      { object: "list", data: [{ id: "item_1" }], has_more: true, last_id: "item_1" },
      { object: "list", data: [{ id: "item_2" }], has_more: false, last_id: "item_2" },
    );
    const items = await collect(client(fetch).responses.inputItems.list("resp_1", { limit: 1 }));

    expect(items).toEqual([{ id: "item_1" }, { id: "item_2" }]);
    expect(captured.requests.map(query)).toEqual([{ limit: "1" }, { limit: "1", after: "item_1" }]);
  });

  it("returns one page when awaited and reuses it when iterated afterwards", async () => {
    const { fetch, captured } = pages(
      { batches: [{ batch_id: "batch_1" }], pagination_token: "next" },
      { batches: [{ batch_id: "batch_2" }] },
    );
    const batches = client(fetch).batches.list();
    const page = await batches;

    expect(page.pagination_token).toBe("next");
    expect(page.http.requestId).toBe("req_test");
    expect(captured.requests).toHaveLength(1);
    expect(await collect(batches)).toHaveLength(2);
    expect(captured.requests).toHaveLength(2);
  });

  it("stops fetching when the loop breaks", async () => {
    const { fetch, captured } = pages({
      data: [{ id: "file_1" }, { id: "file_2" }],
      pagination_token: "page_2",
    });
    for await (const file of client(fetch).files.list()) {
      expect(file.id).toBe("file_1");
      break;
    }

    expect(captured.requests).toHaveLength(1);
  });

  it("rejects the loop when a later page fails", async () => {
    const { fetch } = mockFetch((_req, n) =>
      n === 1
        ? jsonResponse({ data: [{ id: "file_1" }], pagination_token: "page_2" })
        : jsonResponse({ error: { message: "boom" } }, { status: 500 }),
    );

    await expect(collect(client(fetch).files.list())).rejects.toBeInstanceOf(APIStatusError);
  });

  it("supports catch and finally like a promise", async () => {
    const { fetch } = mockFetch(() => jsonResponse({ error: { message: "nope" } }, { status: 403 }));
    const { files } = client(fetch);
    const onFinally = vi.fn();

    await expect(files.list().catch((err: unknown) => err)).resolves.toBeInstanceOf(PermissionDeniedError);
    await expect(files.list().finally(onFinally)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(onFinally).toHaveBeenCalledOnce();
  });
});
