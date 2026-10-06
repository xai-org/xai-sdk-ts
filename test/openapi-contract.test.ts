import { describe, expect, expectTypeOf, it } from "vitest";
import type { operations, paths } from "../src/generated/types.js";
import type { ImageEditWireBody } from "../src/porcelain.js";
import {
  type DeferredImageEditParams,
  type DeferredImageGenerateParams,
  type DeferredImageResponse,
  type ImageGenerateParams,
  SpaceXAI,
} from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

type ListQuery = NonNullable<operations["handle_list_input_items"]["parameters"]["query"]>;
type GenerateImageBody =
  operations["handle_generate_image_request"]["requestBody"]["content"]["application/json"];
type EditImageBody =
  operations["handle_edit_image_request"]["requestBody"]["content"]["application/json"];
type GetDeferredImage = operations["handle_get_deferred_image_request"];
type DeferredImageBody = GetDeferredImage["responses"][200]["content"]["application/json"];

describe("OpenAPI query contract", () => {
  it("inputItems.list query matches handle_list_input_items", async () => {
    const query: ListQuery = { after: "msg_1", limit: 10, order: "asc" };
    const { fetch, captured } = mockFetch(() =>
      jsonResponse({ object: "list", data: [], has_more: false }),
    );
    await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.inputItems.list("resp_1", query);
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
    await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).images.edit({
      model: "grok-imagine-image-2.0",
      prompt: "Combine <IMAGE_0> and <IMAGE_1>",
      images: [new Blob(["png"], { type: "image/png" }), { file_id: "file_1" }],
    });
    expect(await captured.requests[0]!.json()).toEqual(expected);
  });

  it("deferred and output match the documented request fields", () => {
    expectTypeOf<DeferredImageGenerateParams>().toExtend<GenerateImageBody>();
    expectTypeOf<DeferredImageEditParams["deferred"]>().toExtend<EditImageBody["deferred"]>();
    expectTypeOf<ImageGenerateParams["output"]>().toEqualTypeOf<GenerateImageBody["output"]>();
    expectTypeOf<ImageEditWireBody["output"]>().toEqualTypeOf<EditImageBody["output"]>();
  });
});

describe("OpenAPI deferred image contract", () => {
  it("images.get polls GET /v1/images/{request_id} and returns its documented body", async () => {
    expectTypeOf<paths["/v1/images/{request_id}"]["get"]>().toEqualTypeOf<GetDeferredImage>();
    expectTypeOf<Omit<DeferredImageResponse, "usage" | "http">>().toEqualTypeOf<
      Omit<DeferredImageBody, "usage">
    >();
    const params: GetDeferredImage["parameters"]["path"] = { request_id: "req_1" };
    const { fetch, captured } = mockFetch(() => new Response(null, { status: 202 }));
    await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).images.get(params.request_id);
    expect(captured.requests[0]!.method).toBe("GET");
    expect(new URL(captured.requests[0]!.url).pathname).toBe(
      "/v1/images/{request_id}".replace("{request_id}", params.request_id),
    );
  });
});
