import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type StandardSchema,
  type StandardSchemaIssue,
  isFunctionCall,
  isMessage,
  isReasoning,
  SpaceXAI,
} from "../src/index.js";
import { inlineImageInput } from "../src/porcelain.js";
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
    return new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody).then((res) => {
      expect(res.toText()).toBe("AB");
    });
  });

  it("toInput echoes all output items including reasoning", async () => {
    const { fetch } = mockFetch(() => jsonResponse(completedResponse));
    const res = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
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
    const res = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
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
    const res = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    expect(res.parsed).toBeNull();
    expect(() => res.toJson()).toThrow(SyntaxError);
  });

  it("toJson/parsed work for completed json_schema output", async () => {
    const { fetch } = mockFetch(() => jsonResponse(jsonSchemaResponse));
    const res = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    expect(res.parsed).toEqual({ ok: true });
    expect(res.toJson()).toEqual({ ok: true });
  });

  it("toJson validates with a Zod schema and returns Zod's output", async () => {
    const script = { title: "Ep. 1", minutes: "12", lines: [{ speaker: "host", text: "Hi" }] };
    const { fetch } = mockFetch(() =>
      jsonResponse({
        ...completedResponse,
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(script) }] }],
      }),
    );
    const res = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    const Line = z.object({ speaker: z.enum(["host", "guest"]), text: z.string() });
    const Script = z.object({
      title: z.string(),
      minutes: z.coerce.number(),
      lines: z.array(Line),
      mood: z.string().default("upbeat"),
    });

    expect(res.toJson(Script)).toEqual({
      title: "Ep. 1",
      minutes: 12,
      lines: [{ speaker: "host", text: "Hi" }],
      mood: "upbeat",
    });

    const Strict = z.object({ title: z.number(), lines: z.array(Line.extend({ speaker: z.literal("guest") })) });
    expect(() => res.toJson(Strict)).toThrow(
      /^Structured output doesn't match the schema: title: .+; lines\.0\.speaker: .+$/,
    );

    expect(() => res.toJson(Script.refine(async () => true))).toThrow(TypeError);
  });

  it("toJson accepts any Standard Schema validator", async () => {
    const { fetch } = mockFetch(() => jsonResponse(jsonSchemaResponse));
    const res = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create(createBody);
    const schema = <Output>(
      validate: (value: unknown) => { value: Output } | { issues: Array<StandardSchemaIssue> },
    ): StandardSchema<Output> => ({ "~standard": { version: 1, vendor: "test", validate } });

    const flag = schema((value) => ({ value: { flag: (value as { ok: boolean }).ok } }));
    expect(res.toJson(flag)).toEqual({ flag: true });

    const strict = schema(() => ({ issues: [{ message: "Expected false", path: [{ key: "ok" }] }, { message: "Too short" }] }));
    expect(() => res.toJson(strict)).toThrow("Structured output doesn't match the schema: ok: Expected false; Too short");
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
    const stream = await new SpaceXAI({ apiKey: "k", fetch, maxRetries: 0 }).responses.create({
      ...createBody,
      stream: true,
    });
    const response = await stream.done();
    expect(response.status).toBe("incomplete");
    expect(response.toText()).toBe('{"ok":');
    expect(response.parsed).toBeNull();
    expect(() => response.toJson()).toThrow(/truncated/);
  });

  it("inlineImageInput converts Blob and File inputs to typed data URLs", async () => {
    const webp = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
    const cases: Array<[Blob, string]> = [
      [new File(["png"], "cat.png", { type: "image/png" }), "image/png"],
      [new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]), "image/jpeg"],
      [new Blob([new Uint8Array(webp)], { type: "application/octet-stream" }), "image/webp"],
      [new Blob(["not an image"]), "application/octet-stream"],
    ];
    for (const [image, type] of cases) {
      const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
      expect(await inlineImageInput(image)).toEqual({ url: `data:${type};base64,${base64}` });
    }
  });

  it("inlineImageInput passes URL and file_id inputs through", async () => {
    const url = { url: "https://example.com/cat.png" };
    const file = { file_id: "file_1" };
    expect(await inlineImageInput(url)).toBe(url);
    expect(await inlineImageInput(file)).toBe(file);
  });
});
