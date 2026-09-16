import { describe, expect, it } from "vitest";
import { isFunctionCall, isMessage, isReasoning, xAI } from "../src/index.js";
import {
  completedResponse,
  createBody,
  jsonResponse,
  jsonSchemaResponse,
  mockFetch,
  sseResponse,
} from "./helpers.js";

describe("porcelain", () => {
  it("toText concatenates output_text", () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({
        ...completedResponse,
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "A" },
              { type: "output_text", text: "B" },
            ],
          },
        ],
      }),
    );
    return new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody).then((res) => {
      expect(res.toText()).toBe("AB");
    });
  });

  it("toInput echoes all output items including reasoning", async () => {
    const { fetch } = mockFetch(() => jsonResponse(completedResponse));
    const res = await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    const next = res.toInput();
    expect(next).toHaveLength(2);
    expect(isReasoning(next[0])).toBe(true);
    expect(isMessage(next[1])).toBe(true);
    expect(isFunctionCall(next[1])).toBe(false);
  });

  it("toJson throws when completed output has no text", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({
        ...completedResponse,
        output: [{ type: "function_call", name: "fn", arguments: "{}" }],
      }),
    );
    const res = await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    expect(res.parsed).toBeNull();
    expect(() => res.toJson()).toThrow(/no output_text/);
  });

  it("toJson throws and parsed is null when completed text is not valid JSON", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({
        ...completedResponse,
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: '{"ok":' }],
          },
        ],
      }),
    );
    const res = await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    expect(res.parsed).toBeNull();
    expect(() => res.toJson()).toThrow(SyntaxError);
  });

  it("toJson/parsed work for completed json_schema output", async () => {
    const { fetch } = mockFetch(() => jsonResponse(jsonSchemaResponse));
    const res = await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    expect(res.parsed).toEqual({ ok: true });
    expect(res.toJson()).toEqual({ ok: true });
  });

  it("truncated stream: parsed is null, toJson throws, toText returns the fragment", async () => {
    const { fetch } = mockFetch(() =>
      sseResponse([
        { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: '{"ok":' },
        {
          type: "response.incomplete",
          response: {
            id: "resp_trunc",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: '{"ok":' }],
              },
            ],
          },
        },
      ]),
    );
    const stream = await new xAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create({
      ...createBody,
      stream: true,
    });
    for await (const _ of stream) {
      // drain
    }
    expect(stream.status).toBe("incomplete");
    expect(stream.toText()).toBe('{"ok":');
    expect(stream.parsed).toBeNull();
    expect(() => stream.toJson()).toThrow(/truncated/);
  });
});
