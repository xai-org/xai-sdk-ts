import { describe, expect, it } from "vitest";
import { pathParam } from "../src/http.js";
import { SpaceXSI } from "../src/index.js";
import { mockFetch, jsonResponse } from "./helpers.js";

describe("pathParam", () => {
  it("rejects values that do not address their own segment", () => {
    for (const bad of ["", ".", ".."]) {
      expect(() => pathParam(bad)).toThrow(TypeError);
    }
  });

  it("percent-encodes an ordinary id", () => {
    expect(pathParam("file_123")).toBe("file_123");
    expect(pathParam("a/b")).toBe("a%2Fb");
    expect(pathParam("a b#c")).toBe("a%20b%23c");
    expect(pathParam("...")).toBe("...");
    expect(pathParam("a..b")).toBe("a..b");
  });
});

describe("resource methods reject ids that would retarget the request", () => {
  const calls: Array<[string, (client: SpaceXSI, id: string) => PromiseLike<unknown>]> = [
    ["files.get", (c, id) => c.files.get(id)],
    ["files.delete", (c, id) => c.files.delete(id)],
    ["files.content", (c, id) => c.files.content(id)],
    ["files.createPublicUrl", (c, id) => c.files.createPublicUrl(id)],
    ["files.revokePublicUrl", (c, id) => c.files.revokePublicUrl(id)],
    ["batches.get", (c, id) => c.batches.get(id)],
    ["batches.cancel", (c, id) => c.batches.cancel(id)],
    ["batches.results", (c, id) => c.batches.results(id)],
    ["batches.requests.add", (c, id) => c.batches.requests.add(id, { batch_requests: [] })],
    ["batches.requests.list", (c, id) => c.batches.requests.list(id)],
    ["models.get", (c, id) => c.models.get(id)],
    ["models.language.get", (c, id) => c.models.language.get(id)],
    ["models.image.get", (c, id) => c.models.image.get(id)],
    ["models.video.get", (c, id) => c.models.video.get(id)],
    ["responses.get", (c, id) => c.responses.get(id)],
    ["responses.delete", (c, id) => c.responses.delete(id)],
    ["responses.inputItems.list", (c, id) => c.responses.inputItems.list(id)],
    ["videos.get", (c, id) => c.videos.get(id)],
    ["voice.get", (c, id) => c.voice.get(id)],
    ["voice.custom.get", (c, id) => c.voice.custom.get(id)],
    ["voice.custom.update", (c, id) => c.voice.custom.update(id, {})],
    ["voice.custom.delete", (c, id) => c.voice.custom.delete(id)],
    ["voice.custom.getAudio", (c, id) => c.voice.custom.getAudio(id)],
  ];

  for (const [name, call] of calls) {
    it(`${name} throws a TypeError for "", "." and ".." without sending a request`, async () => {
      const { fetch, captured } = mockFetch(() => jsonResponse({}));
      const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
      for (const bad of ["", ".", ".."]) {
        await expect(Promise.resolve().then(() => call(client, bad))).rejects.toThrow(TypeError);
      }
      expect(captured.requests).toHaveLength(0);
    });
  }
});
