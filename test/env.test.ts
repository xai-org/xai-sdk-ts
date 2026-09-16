import { describe, expect, it } from "vitest";
import { assertNodeVersion, sdkLanguage } from "../src/env.js";

function withGlobal<T>(name: string, value: unknown, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  try {
    return run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as unknown as Record<string, unknown>)[name];
  }
}

describe("runtime attribution", () => {
  it("identifies Bun before its Node compatibility version", () => {
    withGlobal(
      "process",
      { versions: { node: "20.0.0", bun: "1.3.2" }, env: {} },
      () => {
        expect(sdkLanguage()).toBe("bun/1.3");
        expect(() => assertNodeVersion()).not.toThrow();
      },
    );
  });

  it("identifies Deno", () => {
    withGlobal("process", undefined, () =>
      withGlobal("Deno", { version: { deno: "2.5.1" } }, () => {
        expect(sdkLanguage()).toBe("deno/2.5");
      }),
    );
  });

  it("identifies Node and generic JavaScript", () => {
    expect(sdkLanguage()).toMatch(/^node\/\d+\.\d+$/);
    withGlobal("process", undefined, () => {
      expect(sdkLanguage()).toBe("javascript");
    });
  });
});
