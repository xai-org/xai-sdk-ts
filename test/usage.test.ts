import { describe, expect, it } from "vitest";
import { mapMediaUsage } from "../src/usage.js";

describe("mapMediaUsage", () => {
  it("derives cost_usd from cost_in_usd_ticks and keeps wire fields", () => {
    const wire = {
      cost_in_usd_ticks: 700_000_000,
      input_tokens: 12,
      input_tokens_details: { text_tokens: 12, image_tokens: 0, cached_tokens: 0 },
      output_tokens: 1_024,
      output_tokens_details: { text_tokens: 0, reasoning_tokens: 0, image_tokens: 1_024 },
      total_tokens: 1_036,
    };
    expect(mapMediaUsage(wire)).toEqual({ ...wire, cost_usd: 0.07 });
  });

  it("returns null when the API omits usage", () => {
    expect(mapMediaUsage(undefined)).toBeNull();
    expect(mapMediaUsage(null)).toBeNull();
  });
});
