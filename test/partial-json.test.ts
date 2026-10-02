import { describe, expect, it } from "vitest";
import { parsePartialJson } from "../src/index.js";

describe("parsePartialJson", () => {
  it("closes unfinished values and leaves out what may still change", () => {
    const cases: Array<[string, unknown]> = [
      ["", undefined],
      ["  ", undefined],
      ["{", {}],
      ['{"na', {}],
      ['{"name"', {}],
      ['{"name":', {}],
      ['{"name": "Gro', { name: "Gro" }],
      ['{"name": "Grok", "lines": [', { name: "Grok", lines: [] }],
      ['{"lines": [{"speaker": "A", "text": "Hi\\', { lines: [{ speaker: "A", text: "Hi" }] }],
      ['{"score": -0.8', {}],
      ['{"score": -0.8 ', { score: -0.8 }],
      ['{"score": -0.8,', { score: -0.8 }],
      ['{"ok": tr', { ok: true }],
      ['{"ok": nul', { ok: null }],
      ["[1, 2", [1]],
      ["[1, 2]", [1, 2]],
      ['"\\u00e9t\\u00', "ét"],
      ['"\\ud83d', ""],
      ['"tab\\tquote\\"', 'tab\tquote"'],
    ];
    for (const [text, value] of cases) {
      expect(parsePartialJson(text), text).toEqual(value);
    }
  });

  it("returns undefined for text that can't become valid JSON", () => {
    for (const text of ['{"a": 1} x', '{"a": 01}', '{"a" 1}', "[1,]", '{"a": tx', '"\\x"', '"\\u12zz"', "{a", '"a\nb"']) {
      expect(parsePartialJson(text), text).toBeUndefined();
    }
  });

  it("parses every prefix of a document and matches JSON.parse at the end", () => {
    const doc = JSON.stringify({
      title: "Ep. 1 \u2014 \u{1F680}",
      lines: [
        { speaker: "Ara", text: 'She said "hi"\n', score: -0.25, tags: ["[laugh]"] },
        { speaker: "Rex", text: "", score: 1e3, ok: true, none: null },
      ],
    });
    for (let end = 1; end < doc.length; end += 1) {
      expect(parsePartialJson(doc.slice(0, end)), doc.slice(0, end)).toBeTypeOf("object");
    }
    expect(parsePartialJson(doc)).toEqual(JSON.parse(doc));
  });

  it("keeps __proto__ as an own key like JSON.parse", () => {
    const value = parsePartialJson('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(["__proto__"]);
  });
});
