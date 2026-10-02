import { describe, expect, it } from "vitest";
import { SpaceXAI, BinaryResponse } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

const fileObject = {
  id: "file_a128090d-f0c9-4873-bd84-e499777e7417",
  object: "file",
  bytes: 6,
  created_at: 1_762_345_678,
  expires_at: 1_762_432_078,
  filename: "report.pdf",
  purpose: "assistants",
};

const publicUrl = "https://files-cdn.x.ai/ZsqeMtdcSYWPPHTQdxXDKQ/file_1.png";

function client(fetch: typeof globalThis.fetch): SpaceXAI {
  return new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

describe("files.upload", () => {
  it("sends metadata fields before the file part and maps the file object", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(fileObject));
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    const res = await client(fetch).files.upload({
      file: new File([bytes], "report.pdf", { type: "application/pdf" }),
      expires_after: 86_400,
      purpose: "assistants",
    });

    const request = captured.requests[0];
    expect(captured.requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.x.ai/v1/files");
    expect(request?.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(request?.headers.get("accept")).toBe("application/json");

    const form = await request!.formData();
    expect([...form.keys()]).toEqual(["expires_after", "purpose", "file"]);
    expect(form.get("expires_after")).toBe("86400");
    expect(form.get("purpose")).toBe("assistants");
    const file = form.get("file") as File;
    expect(file.name).toBe("report.pdf");
    expect(file.type).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);

    expect(res).toEqual({ ...fileObject, http: res.http });
    expect(res.http.status).toBe(200);
    expect(res.http.requestId).toBe("req_test");
  });

  it("names the part with filename and omits unset metadata", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(fileObject));
    const c = client(fetch);
    await c.files.upload({ file: new Blob(["hello"]), filename: "notes.txt", expires_after: null, purpose: null });
    await c.files.upload({ file: new File(["hello"], "draft.txt"), filename: "final.txt" });

    const blobForm = await captured.requests[0]!.formData();
    expect([...blobForm.keys()]).toEqual(["file"]);
    const blob = blobForm.get("file") as File;
    expect(blob.name).toBe("notes.txt");
    expect(await blob.text()).toBe("hello");
    const renamed = (await captured.requests[1]!.formData()).get("file") as File;
    expect(renamed.name).toBe("final.txt");
  });
});

describe("files.list", () => {
  it("sends list options as query parameters and maps the page", async () => {
    const page = { data: [fileObject], pagination_token: fileObject.id };
    const { fetch, captured } = mockFetch(() => jsonResponse(page));
    const res = await client(fetch).files.list({
      limit: 10,
      order: "asc",
      sort_by: "size",
      pagination_token: "file_prev",
      after: "file_after",
      filter: 'content_type = "pdf"',
    });

    const request = captured.requests[0];
    const url = new URL(request!.url);
    expect(request?.method).toBe("GET");
    expect(url.pathname).toBe("/v1/files");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "10",
      order: "asc",
      sort_by: "size",
      pagination_token: "file_prev",
      after: "file_after",
      filter: 'content_type = "pdf"',
    });
    expect(res.data).toEqual([fileObject]);
    expect(res.pagination_token).toBe(fileObject.id);
    expect(res.http.requestId).toBe("req_test");
  });

  it("sorts by creation time by default", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse({ data: [] }));
    const res = await client(fetch).files.list();
    expect(captured.requests[0]?.url).toBe("https://api.x.ai/v1/files?sort_by=created_at");
    expect(res.data).toEqual([]);
  });
});

describe("files.get and files.delete", () => {
  it("gets file metadata by encoded ID", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(fileObject));
    const c = client(fetch);
    const res = await c.files.get(fileObject.id);
    await c.files.get("file/../1");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET https://api.x.ai/v1/files/${fileObject.id}`,
      "GET https://api.x.ai/v1/files/file%2F..%2F1",
    ]);
    expect(res).toEqual({ ...fileObject, http: res.http });
  });

  it("deletes a file", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse({ id: "file_1", deleted: true }));
    const res = await client(fetch).files.delete("file_1");

    expect(captured.requests[0]?.method).toBe("DELETE");
    expect(captured.requests[0]?.url).toBe("https://api.x.ai/v1/files/file_1");
    expect(res.id).toBe("file_1");
    expect(res.deleted).toBe(true);
    expect(res.http.requestId).toBe("req_test");
  });
});

describe("files.content", () => {
  it("downloads the raw bytes as a binary response", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x80]);
    const { fetch, captured } = mockFetch(
      () =>
        new Response(bytes, {
          headers: { "content-type": "application/octet-stream", "x-request-id": "req_test" },
        }),
    );
    const res = await client(fetch).files.content("file_1");

    expect(captured.requests[0]?.method).toBe("GET");
    expect(captured.requests[0]?.url).toBe("https://api.x.ai/v1/files/file_1/content");
    expect(captured.requests[0]?.headers.get("accept")).toBe("*/*");
    expect(res).toBeInstanceOf(BinaryResponse);
    expect(res.contentType).toBe("application/octet-stream");
    expect(res.http.requestId).toBe("req_test");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("sends format as a query parameter", async () => {
    const { fetch, captured } = mockFetch(() => new Response("extracted text"));
    const res = await client(fetch).files.content("file_1", { format: "text" });

    expect(captured.requests[0]?.url).toBe("https://api.x.ai/v1/files/file_1/content?format=text");
    expect(await (await res.blob()).text()).toBe("extracted text");
  });
});

describe("files public URLs", () => {
  it("creates a public URL with a JSON body", async () => {
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ public_url: publicUrl, expires_at: 1_755_600_000 }),
    );
    const c = client(fetch);
    const res = await c.files.createPublicUrl("file_1", { expires_after: 86_400 });
    await c.files.createPublicUrl("file_1");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://api.x.ai/v1/files/file_1/public-url",
      "POST https://api.x.ai/v1/files/file_1/public-url",
    ]);
    expect(captured.requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(await captured.requests[0]?.json()).toEqual({ expires_after: 86_400 });
    expect(await captured.requests[1]?.json()).toEqual({});
    expect(res.public_url).toBe(publicUrl);
    expect(res.expires_at).toBe(1_755_600_000);
    expect(res.http.requestId).toBe("req_test");
  });

  it("revokes a public URL without a request body", async () => {
    const { fetch, captured } = mockFetch((_req, n) =>
      jsonResponse(
        n === 1
          ? { id: "file_1", revoked: true, public_url: publicUrl }
          : { id: "file_1", revoked: false },
      ),
    );
    const c = client(fetch);
    const revoked = await c.files.revokePublicUrl("file_1");
    const again = await c.files.revokePublicUrl("file_1");

    const request = captured.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.x.ai/v1/files/file_1/public-url/revoke");
    expect(request?.headers.get("content-type")).toBeNull();
    expect(await request?.text()).toBe("");
    expect(revoked).toEqual({ id: "file_1", revoked: true, public_url: publicUrl, http: revoked.http });
    expect(again.revoked).toBe(false);
  });
});

describe("file response validation", () => {
  const cases: Array<[string, (files: SpaceXAI["files"]) => Promise<unknown>, unknown]> = [
    ["an upload without id", (files) => files.upload({ file: new Blob(["x"]), filename: "x.txt" }), { object: "file" }],
    ["a non-object file", (files) => files.get("file_1"), "not json"],
    ["a file with an empty id", (files) => files.get("file_1"), { ...fileObject, id: "" }],
    ["a non-object list", (files) => files.list(), [fileObject]],
    ["a list without a data array", (files) => files.list(), { data: "nope" }],
    ["a delete without deleted=true", (files) => files.delete("file_1"), { id: "file_1", deleted: false }],
    ["a public URL without public_url", (files) => files.createPublicUrl("file_1"), { expires_at: 1 }],
    ["a revoke without revoked", (files) => files.revokePublicUrl("file_1"), { id: "file_1" }],
  ];

  it.each(cases)("rejects %s", async (_label, call, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(call(client(fetch).files)).rejects.toMatchObject({
      name: "APIProtocolError",
      requestId: "req_test",
    });
  });
});
