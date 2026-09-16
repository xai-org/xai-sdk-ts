import { describe, expect, expectTypeOf, it } from "vitest";
import type { operations } from "../src/generated/types.js";
import type { ImageEditWireBody } from "../src/porcelain.js";
import { type ImageGenerateParams, xAI } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

type ListQuery = NonNullable<operations["handle_list_input_items"]["parameters"]["query"]>;
type GenerateImageBody =
  operations["handle_generate_image_request"]["requestBody"]["content"]["application/json"];
type EditImageBody =
  operations["handle_edit_image_request"]["requestBody"]["content"]["application/json"];

describe("OpenAPI query contract", () => {
  it("inputItems.list query matches handle_list_input_items", async () => {
    const query: ListQuery = { after: "msg_1", limit: 10, order: "asc" };
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ object: "list", data: [], has_more: false }),
    );
    await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.inputItems.list("resp_1", query);
    const url = new URL(captured.requests[0]!.url);
    expect(url.searchParams.get("after")).toBe("msg_1");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("order")).toBe("asc");
    expect(url.searchParams.has("before")).toBe(false);
  });
});

describe("OpenAPI image request contract", () => {
  it("image params are assignable to the documented request bodies", () => {
    expectTypeOf<ImageGenerateParams>().toExtend<GenerateImageBody>();
    expectTypeOf<ImageEditWireBody>().toExtend<EditImageBody>();
  });

  it("images.edit sends an EditImageRequest body", async () => {
    const expected: EditImageBody = {
      model: "grok-imagine-image-2.0",
      prompt: "Combine <IMAGE_0> and <IMAGE_1>",
      images: [{ url: `data:image/png;base64,${btoa("png")}` }, { file_id: "file_1" }],
    };
    const { fetch, captured } = mockFetch(() => jsonResponse({ data: [] }));
    await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).images.edit({
      model: "grok-imagine-image-2.0",
      prompt: "Combine <IMAGE_0> and <IMAGE_1>",
      images: [new Blob(["png"], { type: "image/png" }), { file_id: "file_1" }],
    });
    expect(await captured.requests[0]!.json()).toEqual(expected);
  });
});
