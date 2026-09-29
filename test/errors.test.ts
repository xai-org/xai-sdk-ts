import { describe, expect, it } from "vitest";
import {
  APIError,
  AuthenticationError,
  NotFoundError,
  OverloadedError,
  PermissionDeniedError,
  RateLimitError,
  SDK_VERSION,
  TimeoutError,
  xAI,
} from "../src/index.js";
import { createBody, jsonResponse, mockFetch } from "./helpers.js";

describe("typed errors", () => {
  function client(status: number, body: unknown): xAI {
    const { fetch } = mockFetch(() => jsonResponse(body, { status }));
    return new xAI({ apiKey: "k", fetch, maxRetries: 0 });
  }

  it("maps status codes to classes and APIError.is", async () => {
    const cases: Array<[number, unknown]> = [
      [401, AuthenticationError],
      [403, PermissionDeniedError],
      [404, NotFoundError],
      [429, RateLimitError],
      [529, OverloadedError],
    ];
    for (const [status, Ctor] of cases) {
      try {
        await client(status, { error: { message: "nope" } }).responses.create(createBody);
        throw new Error("expected failure");
      } catch (err) {
        expect(APIError.is(err)).toBe(true);
        expect(err).toBeInstanceOf(Ctor);
        expect((err as APIError).requestId).toBe("req_test");
      }
    }
  });

  it("exposes isRateLimit / isOverloaded", async () => {
    try {
      await client(429, { error: { message: "slow" } }).responses.create(createBody);
      throw new Error("expected failure");
    } catch (err) {
      expect(APIError.is(err)).toBe(true);
      expect((err as APIError).isRateLimit()).toBe(true);
    }
    try {
      await client(529, { error: { message: "busy" } }).responses.create(createBody);
      throw new Error("expected failure");
    } catch (err) {
      expect(APIError.is(err)).toBe(true);
      expect((err as APIError).isOverloaded()).toBe(true);
    }
  });

  it("exposes structured error details", async () => {
    try {
      await client(400, {
        error: {
          type: "invalid_request_error",
          code: "invalid_model",
          param: "model",
          message: "Unknown model",
        },
      }).responses.create(createBody);
      throw new Error("expected failure");
    } catch (err) {
      expect(APIError.is(err)).toBe(true);
      expect((err as APIError).type).toBe("invalid_request_error");
      expect((err as APIError).code).toBe("invalid_model");
      expect((err as APIError).param).toBe("model");
      expect((err as APIError).message).toBe("Unknown model");
    }
  });

  it("uses a string error field as the message", async () => {
    const message = "Public URLs are not supported for files with content type 'text/plain'.";
    try {
      await client(400, { code: "invalid-argument", error: message }).responses.create(createBody);
      throw new Error("expected failure");
    } catch (err) {
      expect(APIError.is(err)).toBe(true);
      expect((err as APIError).code).toBe("invalid-argument");
      expect((err as APIError).message).toBe(message);
    }
  });

  it("rewrites 400 dropped-reasoning messages", async () => {
    try {
      await client(400, { error: { message: "missing encrypted reasoning content" } }).responses.create(
        createBody,
      );
      throw new Error("expected failure");
    } catch (err) {
      expect(APIError.is(err)).toBe(true);
      expect((err as APIError).message).toBe("pass response.toInput() (or include encrypted reasoning)");
    }
  });

  it("times out idle JSON reads as TimeoutError", async () => {
    const { fetch } = mockFetch(
      () =>
        new Response(
          new ReadableStream({
            async start() {
              await new Promise(() => {});
            },
          }),
          { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_test" } },
        ),
    );
    const c = new xAI({ apiKey: "k", fetch, maxRetries: 0, idleTimeout: 20, timeout: 5_000 });
    await expect(c.responses.create({ ...createBody, stream: false })).rejects.toBeInstanceOf(TimeoutError);
  });

  it("requires the unflagged require(esm) Node floor", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
      engines: { node: string };
      private?: boolean;
      publishConfig?: { access?: string; registry?: string; tag?: string };
    };
    expect(pkg.engines.node).toBe(">=22.13.0");
    expect(pkg.version).toBe(SDK_VERSION);
    expect(pkg.private).toBeUndefined();
    expect(pkg.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/",
      tag: "next",
    });
  });
});
