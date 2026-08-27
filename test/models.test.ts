import { describe, expect, it } from "vitest";
import { models } from "../src/models.js";

describe("models catalog", () => {
  it("exposes Grok 4.6 as models.Grok46", () => {
    expect(models.Grok46).toBe("grok-4.6");
  });

  it("uses unique PascalCase keys and string ids", () => {
    const ids = Object.values(models);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [key, id] of Object.entries(models)) {
      expect(key).toMatch(/^[A-Z][A-Za-z0-9]*$/);
      expect(id).toMatch(/^[a-z0-9][a-z0-9._-]*$/i);
    }
  });
});
