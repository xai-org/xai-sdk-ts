import { describe, expect, expectTypeOf, it } from "vitest";
import type { KnownModelId, KnownVideoModelId, ModelId } from "../src/models.js";
import type { CreateParams, VideoGenerateParams } from "../src/types.js";

describe("model IDs", () => {
  it("preserves known model string literals", () => {
    const model = "grok-4.6" satisfies KnownModelId;
    const params = { model, input: "hello" } satisfies CreateParams;

    expect(model).toBe("grok-4.6");
    expectTypeOf(params.model).toEqualTypeOf<"grok-4.6">();
  });

  it("accepts model IDs released after the SDK", () => {
    const model = "grok-released-after-this-sdk" satisfies ModelId;
    const params = { model, input: "hello" } satisfies CreateParams;

    expectTypeOf(params.model).toEqualTypeOf<"grok-released-after-this-sdk">();
  });

  it("keeps strict validation available for known IDs", () => {
    // @ts-expect-error KnownModelId only accepts generated model IDs.
    const model: KnownModelId = "not-an-xai-model";
    expect(model).toBe("not-an-xai-model");
  });

  it("preserves known video model string literals", () => {
    const model = "grok-imagine-video-1.5-lite" satisfies KnownVideoModelId;
    const params = { model, prompt: "A lighthouse at dusk" } satisfies VideoGenerateParams;

    expect(params.model).toBe("grok-imagine-video-1.5-lite");
    expectTypeOf(params.model).toEqualTypeOf<"grok-imagine-video-1.5-lite">();
  });
});
