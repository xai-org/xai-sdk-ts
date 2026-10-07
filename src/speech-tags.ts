import {
  INLINE_SPEECH_TAGS,
  WRAPPING_SPEECH_TAGS,
  type InlineSpeechTags,
  type WrappingSpeechTags,
} from "./generated/voice.js";

type InlineTag = InlineSpeechTags[number];
type WrappingTag = WrappingSpeechTags[number];

type Letter =
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m"
  | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z";
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** Lowercase words joined by hyphens, like `long-pause`. */
type IsTagName<S extends string> = S extends `${Letter}${infer Rest}` ? IsTagNameRest<Rest> : false;
type IsTagNameRest<S extends string> = S extends ""
  ? true
  : S extends `${Letter}${infer Rest}`
    ? IsTagNameRest<Rest>
    : S extends `-${Letter}${infer Rest}`
      ? IsTagNameRest<Rest>
      : false;

type Length<S extends string, N extends Array<0> = []> = S extends `${infer _}${infer Rest}`
  ? Length<Rest, [...N, 0]>
  : N;
type CommonPrefix<A extends string, B extends string, N extends Array<0> = []> =
  A extends `${infer C}${infer RestA}`
    ? B extends `${C}${infer RestB}`
      ? CommonPrefix<RestA, RestB, [...N, 0]>
      : N
    : N;
type Distance<A extends Array<0>, B extends Array<0>> = A extends [...B, ...infer Rest]
  ? Rest
  : B extends [...A, ...infer Rest]
    ? Rest
    : [];

/** A suggestion shares two leading letters, or one letter and nearly the same length. */
type Qualifies<Prefix extends Array<0>, Dist extends Array<0>> = Prefix extends [0, 0, ...Array<0>]
  ? true
  : Prefix extends [0]
    ? Dist extends [] | [0] | [0, 0]
      ? true
      : false
    : false;
/** Scores two points per shared leading letter, minus one per letter of length difference. */
type Better<
  Prefix extends Array<0>,
  Dist extends Array<0>,
  Best extends string,
  BestPrefix extends Array<0>,
  BestDist extends Array<0>,
> = [Best] extends [never]
  ? true
  : [...Prefix, ...Prefix, ...BestDist] extends [...BestPrefix, ...BestPrefix, ...Dist, 0, ...Array<0>]
    ? true
    : false;

/**
 * Starts with a tag, or has at least four letters, shares the tag's first two, and is within two letters
 * of its length. Shorter words such as `[sic]` are too often editorial to count.
 */
type ResemblesInlineTag<Name extends string, Tags extends Array<string> = InlineSpeechTags> = Tags extends [
  infer Tag extends string,
  ...infer Rest extends Array<string>,
]
  ? Name extends `${Tag}${string}`
    ? true
    : [Length<Name>, CommonPrefix<Name, Tag>, Distance<Length<Name>, Length<Tag>>] extends [
          [0, 0, 0, 0, ...Array<0>],
          [0, 0, ...Array<0>],
          [] | [0] | [0, 0],
        ]
      ? true
      : ResemblesInlineTag<Name, Rest>
  : false;

/**
 * Bracketed text is a tag when it's a known tag, has a hyphen like `long-pause`, or resembles a known
 * inline tag, like `[laff]` or `[laughs]`. Other bracketed text, such as `[they]` or `[Enter]`, is read aloud.
 */
type IsInlineTag<Name extends string> = IsTagName<Name> extends true
  ? Name extends InlineTag | WrappingTag | `${string}-${string}`
    ? true
    : ResemblesInlineTag<Name>
  : false;

type MarkupNameChar = Letter | Uppercase<Letter> | Digit | "_" | "." | ":" | "-";
type IsMarkupRest<S extends string> = S extends "" | "/"
  ? true
  : S extends `${" " | "\t" | "\n" | "\r"}${string}`
    ? true
    : S extends `${MarkupNameChar}${infer Rest}`
      ? IsMarkupRest<Rest>
      : false;
/** XML-style markup between `<` and `>` that isn't a speech tag, like `cite id="1"/` or `/grok:render`. */
type IsMarkup<Raw extends string> = Raw extends `${string}<${string}`
  ? false
  : (Raw extends `/${infer Tag}` ? Tag : Raw) extends `${Letter | Uppercase<Letter>}${infer Rest}`
    ? IsMarkupRest<Rest>
    : false;

/** The highest-scoring tag for `Name`; ties keep docs order. */
type Closest<
  Name extends string,
  Tags extends Array<string>,
  Best extends string = never,
  BestPrefix extends Array<0> = [],
  BestDist extends Array<0> = [],
> = Tags extends [infer Tag extends string, ...infer Rest extends Array<string>]
  ? [CommonPrefix<Name, Tag>, Distance<Length<Name>, Length<Tag>>] extends [
      infer Prefix extends Array<0>,
      infer Dist extends Array<0>,
    ]
    ? Qualifies<Prefix, Dist> extends true
      ? Better<Prefix, Dist, Best, BestPrefix, BestDist> extends true
        ? Closest<Name, Rest, Tag, Prefix, Dist>
        : Closest<Name, Rest, Best, BestPrefix, BestDist>
      : Closest<Name, Rest, Best, BestPrefix, BestDist>
    : never
  : Best;

type Suggest<Tag extends string, Suggestion extends string> = [Suggestion] extends [never]
  ? `Unknown speech tag ${Tag}.`
  : `Unknown speech tag ${Tag}, did you mean ${Suggestion}?`;
type UnknownInline<Name extends string> = Name extends WrappingTag
  ? `[${Name}] is a wrapping tag, use <${Name}>…</${Name}>.`
  : Suggest<`[${Name}]`, `[${Closest<Name, InlineSpeechTags>}]`>;
type UnknownWrapping<Tag extends string, Name extends string, Opener extends string> =
  Name extends InlineTag
    ? `${Tag} is an inline tag, use [${Name}].`
    : Suggest<Tag, `${Opener}${Closest<Name, WrappingSpeechTags>}>`>;

/** Text is checked up to this many brackets per scan, which stays under TypeScript's recursion limit. */
type MaxSteps = 500;

type InlineProblems<S extends string, Found extends Array<string> = [], Steps extends Array<0> = []> =
  Steps["length"] extends MaxSteps
    ? Found
    : S extends `${string}[${infer After}`
      ? After extends `${infer Name}]${infer Rest}`
        ? IsInlineTag<Name> extends true
          ? InlineProblems<
              Rest,
              Name extends InlineTag ? Found : [...Found, UnknownInline<Name>],
              [...Steps, 0]
            >
          : InlineProblems<After, Found, [...Steps, 0]>
        : Found
      : Found;

type Last<T extends Array<string>> = T extends [...Array<string>, infer L extends string] ? L : never;
type Remove<T extends Array<string>, Name extends string> =
  T extends [...infer Head extends Array<string>, infer L extends string]
    ? L extends Name
      ? Head
      : [...Remove<Head, Name>, L]
    : [];
type NeverClosed<Open extends Array<string>> =
  Open extends [infer Name extends string, ...infer Rest extends Array<string>]
    ? Name extends WrappingTag
      ? [`<${Name}> is never closed.`, ...NeverClosed<Rest>]
      : NeverClosed<Rest>
    : [];
/** A misnested close reports once and removes only the tag it names, so later closes still match. */
type CloseTag<Open extends Array<string>, Name extends string, Found extends Array<string>> =
  Open extends [...infer Outer extends Array<string>, Name]
    ? [Outer, Found]
    : Name extends Open[number]
      ? [Remove<Open, Name>, [...Found, `Close <${Last<Open>}> before </${Name}>.`]]
      : [
          Open,
          [
            ...Found,
            Name extends WrappingTag
              ? `</${Name}> has no opening tag.`
              : UnknownWrapping<`</${Name}>`, Name, "</">,
          ],
        ];

/** Markup is always removed, so it's reported on its own and doesn't count toward nesting. */
type MarkupProblems<
  After extends string,
  Raw extends string,
  Rest extends string,
  Open extends Array<string>,
  Found extends Array<string>,
  Steps extends Array<0>,
> = IsMarkup<Raw> extends true
  ? WrappingProblems<Rest, Open, [...Found, `<${Raw}> is not a speech tag.`], [...Steps, 0]>
  : WrappingProblems<After, Open, Found, [...Steps, 0]>;

type WrappingProblems<
  S extends string,
  Open extends Array<string> = [],
  Found extends Array<string> = [],
  Steps extends Array<0> = [],
> = Steps["length"] extends MaxSteps
  ? Found
  : S extends `${string}<${infer After}`
    ? After extends `${infer Raw}>${infer Rest}`
      ? Raw extends `/${infer Name}`
        ? IsTagName<Name> extends true
          ? CloseTag<Open, Name, Found> extends [
              infer NextOpen extends Array<string>,
              infer NextFound extends Array<string>,
            ]
            ? WrappingProblems<Rest, NextOpen, NextFound, [...Steps, 0]>
            : never
          : MarkupProblems<After, Raw, Rest, Open, Found, Steps>
        : IsTagName<Raw> extends true
          ? WrappingProblems<
              Rest,
              [...Open, Raw],
              Raw extends WrappingTag ? Found : [...Found, UnknownWrapping<`<${Raw}>`, Raw, "<">],
              [...Steps, 0]
            >
          : MarkupProblems<After, Raw, Rest, Open, Found, Steps>
      : [...Found, ...NeverClosed<Open>]
    : [...Found, ...NeverClosed<Open>];

type Join<T extends Array<string>> = T extends [infer First extends string, ...infer Rest extends Array<string>]
  ? Rest extends []
    ? First
    : `${First} ${Join<Rest>}`
  : "";
type Message<Problems extends Array<string>> = [
  Extract<Problems[number], `Unknown speech tag ${string}`>,
] extends [never]
  ? Join<Problems>
  : `${Join<Problems>} For a tag newer than this SDK, add \`as UnsafeSpeechText\` to the text.`;

/**
 * Speech text that skips tag checking, for tags released after this SDK:
 * `"Hello [new-tag]" as UnsafeSpeechText`.
 */
export type UnsafeSpeechText = string;

/**
 * Speech text that is a type error when a string literal has unknown tags, wrapping tags that
 * aren't closed in order, or markup such as `<cite id="1"/>`. The API accepts such text without
 * an error, then skips tags, reads them aloud, or makes unrelated sounds. Text typed as `string`
 * or `UnsafeSpeechText` is sent as written, so tags released after this SDK still work.
 */
export type SpeechText<T extends string> = string extends T
  ? T
  : [...InlineProblems<T>, ...WrappingProblems<T>] extends infer Problems extends Array<string>
    ? Problems extends []
      ? T
      : Message<Problems>
    : never;

const INLINE = new Set<string>(INLINE_SPEECH_TAGS);
const WRAPPING = new Set<string>(WRAPPING_SPEECH_TAGS);
const TAG_NAME = /^[a-z]+(?:-[a-z]+)*$/;
/** Like the `IsMarkup` type. */
const MARKUP = /^<\/?[A-Za-z][\w.:-]*(?:[\t\n\r ][^<>]*|\/)?>$/;

/** `name` is the whole tag for markup. */
type Tag = { kind: "inline" | "open" | "close" | "markup"; name: string; start: number; end: number };

/** Like the `IsInlineTag` type. */
function isInlineTag(name: string): boolean {
  if (!TAG_NAME.test(name)) return false;
  if (INLINE.has(name) || WRAPPING.has(name) || name.includes("-")) return true;
  return INLINE_SPEECH_TAGS.some(
    (tag) =>
      name.startsWith(tag) ||
      (name.length >= 4 && name.slice(0, 2) === tag.slice(0, 2) && Math.abs(name.length - tag.length) <= 2),
  );
}

/** Inline and wrapping tags are scanned separately, like the `SpeechText` check, so neither hides the other. */
function inlineTags(text: string): Array<Tag> {
  const tags: Array<Tag> = [];
  for (const match of text.matchAll(/\[([^[\]]*)\]/g)) {
    const name = match[1] ?? "";
    if (isInlineTag(name)) {
      tags.push({ kind: "inline", name, start: match.index, end: match.index + match[0].length });
    }
  }
  return tags;
}

function wrappingTags(text: string): Array<Tag> {
  const tags: Array<Tag> = [];
  for (const match of text.matchAll(/<(\/?)([^<>]*)>/g)) {
    const name = match[2] ?? "";
    const start = match.index;
    const end = match.index + match[0].length;
    if (TAG_NAME.test(name)) {
      tags.push({ kind: match[1] ? "close" : "open", name, start, end });
    } else if (MARKUP.test(match[0])) {
      tags.push({ kind: "markup", name: match[0], start, end });
    }
  }
  return tags;
}

function closest(name: string, tags: ReadonlyArray<string>): string | undefined {
  let best: string | undefined;
  let bestScore = 0;
  for (const tag of tags) {
    let prefix = 0;
    while (prefix < name.length && name[prefix] === tag[prefix]) prefix += 1;
    const distance = Math.abs(name.length - tag.length);
    if (prefix < 2 && !(prefix === 1 && distance <= 2)) continue;
    const score = 2 * prefix - distance;
    if (best === undefined || score > bestScore) {
      best = tag;
      bestScore = score;
    }
  }
  return best;
}

function suggest(tag: string, suggestion: string | undefined): string {
  return suggestion === undefined
    ? `Unknown speech tag ${tag}.`
    : `Unknown speech tag ${tag}, did you mean ${suggestion}?`;
}

function unknownInline(name: string): string {
  if (WRAPPING.has(name)) return `[${name}] is a wrapping tag, use <${name}>…</${name}>.`;
  const match = closest(name, INLINE_SPEECH_TAGS);
  return suggest(`[${name}]`, match && `[${match}]`);
}

function unknownWrapping(tag: string, name: string, opener: "<" | "</"): string {
  if (INLINE.has(name)) return `${tag} is an inline tag, use [${name}].`;
  const match = closest(name, WRAPPING_SPEECH_TAGS);
  return suggest(tag, match && `${opener}${match}>`);
}

/**
 * Lists the problems the `SpeechText` type reports for a string literal: unknown tags, wrapping tags
 * that aren't closed in order, and markup such as `<cite id="1"/>`. Use it for text you don't write
 * yourself, such as model output. An empty array means the API will read every tag as a tag.
 */
export function checkSpeechText(text: string): Array<string> {
  const problems: Array<string> = [];
  for (const tag of inlineTags(text)) {
    if (!INLINE.has(tag.name)) problems.push(unknownInline(tag.name));
  }
  const open: Array<string> = [];
  for (const { kind, name } of wrappingTags(text)) {
    if (kind === "markup") {
      problems.push(`${name} is not a speech tag.`);
      continue;
    }
    if (kind === "open") {
      open.push(name);
      if (!WRAPPING.has(name)) problems.push(unknownWrapping(`<${name}>`, name, "<"));
      continue;
    }
    const index = open.lastIndexOf(name);
    if (index === -1) {
      problems.push(WRAPPING.has(name) ? `</${name}> has no opening tag.` : unknownWrapping(`</${name}>`, name, "</"));
    } else if (index !== open.length - 1) {
      problems.push(`Close <${open.at(-1)}> before </${name}>.`);
      open.splice(index, 1);
    } else {
      open.pop();
    }
  }
  for (const name of open) {
    if (WRAPPING.has(name)) problems.push(`<${name}> is never closed.`);
  }
  return problems;
}

function stripOnce(text: string): string {
  const tags = [...inlineTags(text), ...wrappingTags(text)].sort((a, b) => a.start - b.start);
  const drop = new Set<Tag>();
  const open: Array<Tag> = [];
  for (const tag of tags) {
    if (tag.kind === "inline") {
      if (!INLINE.has(tag.name)) drop.add(tag);
    } else if (tag.kind === "markup") {
      drop.add(tag);
    } else if (tag.kind === "open") {
      open.push(tag);
    } else {
      const index = open.findLastIndex((opener) => opener.name === tag.name);
      if (index === -1) {
        drop.add(tag);
        continue;
      }
      const [opener] = open.splice(index, 1);
      const closesInnermost = index === open.length;
      if (opener && (!closesInnermost || !WRAPPING.has(tag.name))) {
        drop.add(opener);
        drop.add(tag);
      }
    }
  }
  for (const opener of open) drop.add(opener);
  let out = "";
  let last = 0;
  for (const tag of tags) {
    // A bracketed tag can sit inside markup, such as in an attribute, and goes with it.
    if (!drop.has(tag) || tag.start < last) continue;
    out += text.slice(last, tag.start);
    last = tag.end;
  }
  return out + text.slice(last);
}

/**
 * Removes the tags and markup `checkSpeechText` reports, keeping the words they wrap, so the API doesn't
 * read them aloud. A misnested pair is removed whole; well-formed known tags are kept, and so is bracketed
 * text that doesn't look like a tag, such as `[they]` in a quote.
 */
export function stripInvalidSpeechTags(text: string): string {
  let current = text;
  while (true) {
    // Removing a tag can join the text around it into a new tag, so repeat until nothing changes.
    const next = stripOnce(current);
    if (next === current) return next;
    current = next;
  }
}
