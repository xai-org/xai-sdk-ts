const MISSING = Symbol("missing");
const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};
const LITERALS: Array<[string, unknown]> = [
  ["true", true],
  ["false", false],
  ["null", null],
];
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

class InvalidJson extends Error {}

/**
 * Parses JSON that may be cut off, such as structured output that is still streaming. Unfinished strings,
 * arrays, and objects are closed. A key without a value yet, or a number that may still grow, is left out.
 * Returns `undefined` when `text` holds no value yet or isn't the start of valid JSON.
 */
export function parsePartialJson(text: string): unknown {
  let i = 0;

  const fail = (): never => {
    throw new InvalidJson();
  };

  const skipWhitespace = (): void => {
    while (i < text.length && " \t\n\r".includes(text[i] ?? "")) i += 1;
  };

  const value = (): unknown => {
    skipWhitespace();
    const char = text[i];
    if (char === undefined) return MISSING;
    if (char === "{") return object();
    if (char === "[") return array();
    if (char === '"') return string().value;
    if (char === "-" || (char >= "0" && char <= "9")) return number();
    return literal();
  };

  const object = (): Record<string, unknown> => {
    i += 1;
    const out: Record<string, unknown> = {};
    skipWhitespace();
    if (text[i] === "}") {
      i += 1;
      return out;
    }
    while (true) {
      skipWhitespace();
      if (i >= text.length) return out;
      if (text[i] !== '"') fail();
      const key = string();
      skipWhitespace();
      if (!key.closed || i >= text.length) return out;
      if (text[i] !== ":") fail();
      i += 1;
      const item = value();
      if (item === MISSING) return out;
      Object.defineProperty(out, key.value, { value: item, enumerable: true, writable: true, configurable: true });
      skipWhitespace();
      if (i >= text.length) return out;
      if (text[i] === "}") {
        i += 1;
        return out;
      }
      if (text[i] !== ",") fail();
      i += 1;
    }
  };

  const array = (): Array<unknown> => {
    i += 1;
    const out: Array<unknown> = [];
    skipWhitespace();
    if (text[i] === "]") {
      i += 1;
      return out;
    }
    while (true) {
      const item = value();
      if (item === MISSING) return out;
      out.push(item);
      skipWhitespace();
      if (i >= text.length) return out;
      if (text[i] === "]") {
        i += 1;
        return out;
      }
      if (text[i] !== ",") fail();
      i += 1;
    }
  };

  const string = (): { value: string; closed: boolean } => {
    i += 1;
    let out = "";
    while (i < text.length) {
      const char = text[i] ?? "";
      if (char === '"') {
        i += 1;
        return { value: out, closed: true };
      }
      if (char === "\\") {
        const escape = text[i + 1];
        if (escape === undefined) break;
        if (escape === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (hex.length < 4) break;
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 6;
          continue;
        }
        out += ESCAPES[escape] ?? fail();
        i += 2;
        continue;
      }
      if (char < " ") fail();
      out += char;
      i += 1;
    }
    i = text.length;
    // A surrogate pair can be cut in half; the next parse sees both halves.
    return { value: out.replace(/[\uD800-\uDBFF]$/, ""), closed: false };
  };

  const number = (): number | typeof MISSING => {
    const start = i;
    while (i < text.length && /[-+.\deE]/.test(text[i] ?? "")) i += 1;
    if (i >= text.length) return MISSING;
    const raw = text.slice(start, i);
    if (!NUMBER.test(raw)) fail();
    return Number(raw);
  };

  const literal = (): unknown => {
    for (const [word, result] of LITERALS) {
      const rest = text.slice(i, i + word.length);
      // A cut-off literal such as `tr` can only become `true`.
      if (rest === word || (i + rest.length === text.length && word.startsWith(rest))) {
        i += rest.length;
        return result;
      }
    }
    return fail();
  };

  try {
    const result = value();
    skipWhitespace();
    if (i < text.length) fail();
    return result === MISSING ? undefined : result;
  } catch (err) {
    if (err instanceof InvalidJson) return undefined;
    throw err;
  }
}
