import { afterEach, describe, expect, it, vi } from "vitest";
import { pathParam } from "../src/http.js";
import { SpaceXSI } from "../src/index.js";
import { mockFetch, jsonResponse } from "./helpers.js";

// What code without type checking can pass as an id, with the type that the error message names.
const NOT_STRING_OR_NUMBER: Array<[string, object | boolean | null | undefined, string]> = [
  ['[".."]', [".."], "array"],
  ["[]", [], "array"],
  ['new String("..")', new String(".."), "object"],
  ['{ toString: () => ".." }', { toString: () => ".." }, "object"],
  ["null", null, "null"],
  ["undefined", undefined, "undefined"],
  ["true", true, "boolean"],
];

afterEach(() => {
  vi.useRealTimers();
});

describe("pathParam", () => {
  it("rejects values that do not address their own segment", () => {
    for (const bad of ["", ".", ".."]) {
      expect(() => pathParam(bad)).toThrow(TypeError);
      expect(() => pathParam(bad)).toThrow(`Invalid path parameter: ${JSON.stringify(bad)}`);
    }
  });

  it.each(NOT_STRING_OR_NUMBER)("rejects %s, which is not a string or number", (_label, bad, type) => {
    const encode = () => pathParam(bad as unknown as string);
    expect(encode).toThrow(TypeError);
    expect(encode).toThrow(`Invalid path parameter: expected a string or number, got ${type}`);
  });

  it("encodes a number as its string", () => {
    expect(pathParam(42 as unknown as string)).toBe("42");
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
    ["batches.wait", (c, id) => c.batches.wait(id)],
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
    ["videos.wait", (c, id) => c.videos.wait(id)],
    ["voice.get", (c, id) => c.voice.get(id)],
    ["voice.custom.get", (c, id) => c.voice.custom.get(id)],
    ["voice.custom.update", (c, id) => c.voice.custom.update(id, {})],
    ["voice.custom.delete", (c, id) => c.voice.custom.delete(id)],
    ["voice.custom.getAudio", (c, id) => c.voice.custom.getAudio(id)],
  ];

  // batches.wait and videos.wait poll on timers. Every row runs under fake timers, so a poll interval or timeout
  // cannot delay the suite, and the timer count shows that the rejected call left no timer pending.
  for (const [name, call] of calls) {
    it(`${name} throws a TypeError for "", "." and ".." without sending a request`, async () => {
      vi.useFakeTimers();
      const { fetch, captured } = mockFetch(() => jsonResponse({}));
      const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
      for (const bad of ["", ".", ".."]) {
        const pending = Promise.resolve().then(() => call(client, bad));
        await expect(pending).rejects.toThrow(TypeError);
        await expect(pending).rejects.toThrow(`Invalid path parameter: ${JSON.stringify(bad)}`);
      }
      expect(captured.requests).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it(`${name} throws a TypeError for an id that is not a string or number without sending a request`, async () => {
      vi.useFakeTimers();
      const { fetch, captured } = mockFetch(() => jsonResponse({}));
      const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
      for (const [, bad, type] of NOT_STRING_OR_NUMBER) {
        const pending = Promise.resolve().then(() => call(client, bad as unknown as string));
        await expect(pending).rejects.toThrow(TypeError);
        await expect(pending).rejects.toThrow(`Invalid path parameter: expected a string or number, got ${type}`);
      }
      expect(captured.requests).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("batches.requests.add throws a TypeError for a bad id before it reads any image", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse({}));
    const client = new SpaceXSI({ apiKey: "test-key", fetch, maxRetries: 0 });
    const image = new Blob(["png-bytes"], { type: "image/png" });
    const arrayBuffer = vi.spyOn(image, "arrayBuffer");
    const stream = vi.spyOn(image, "stream");
    const add = (id: string) =>
      client.batches.requests.add(id, {
        batch_requests: [
          {
            batch_request: {
              responses: { model: "grok-4.3", input: [{ role: "user", content: [{ type: "input_image", image }] }] },
            },
          },
        ],
      });

    const pending = add("..");
    await expect(pending).rejects.toThrow(TypeError);
    await expect(pending).rejects.toThrow('Invalid path parameter: ".."');
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(captured.requests).toHaveLength(0);

    // The same request with a valid id reads the image, so the spies would have caught a read above.
    await add("batch_1");
    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(captured.requests).toHaveLength(1);
  });
});
