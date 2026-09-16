import { describe, expect, it } from "vitest";
import { xAIBinaryResponse } from "../src/index.js";

function binaryResponse(body: BodyInit | null, headers: Record<string, string> = {}): xAIBinaryResponse {
  return new xAIBinaryResponse(new Response(body).body, {
    status: 200,
    headers: new Headers(headers),
    requestId: "req_test",
    clientRequestId: "client_req_test",
  });
}

describe("xAIBinaryResponse", () => {
  it("reads the body as bytes or as a Blob typed with the content type", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    const headers = { "content-type": "application/zip" };
    const res = binaryResponse(bytes, headers);
    expect(res.contentType).toBe("application/zip");
    expect(res.http.requestId).toBe("req_test");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

    const blob = await binaryResponse(bytes, headers).blob();
    expect(blob.type).toBe("application/zip");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);

    expect(await binaryResponse(bytes, headers).bytes()).toEqual(bytes);
  });

  it("reads the body as UTF-8 text", async () => {
    expect(await binaryResponse("héllo").text()).toBe("héllo");
  });

  it("reads a missing body as empty", async () => {
    const res = binaryResponse(null);
    expect(res.body).toBeNull();
    expect(res.contentType).toBeNull();
    expect((await res.arrayBuffer()).byteLength).toBe(0);
    expect((await res.blob()).size).toBe(0);
    expect((await binaryResponse(null).bytes()).length).toBe(0);
    expect(await binaryResponse(null).text()).toBe("");
  });
});
