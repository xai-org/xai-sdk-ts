import type { InlineSpeechTags, WrappingSpeechTags } from "./generated/voice.js";

type InlineTag = InlineSpeechTags[number];
type WrappingTag = WrappingSpeechTags[number];

type Letter =
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m"
  | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z";

/** Lowercase words joined by hyphens, like `long-pause`. Other bracketed text is read aloud. */
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
        ? IsTagName<Name> extends true
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
          : WrappingProblems<After, Open, Found, [...Steps, 0]>
        : IsTagName<Raw> extends true
          ? WrappingProblems<
              Rest,
              [...Open, Raw],
              Raw extends WrappingTag ? Found : [...Found, UnknownWrapping<`<${Raw}>`, Raw, "<">],
              [...Steps, 0]
            >
          : WrappingProblems<After, Open, Found, [...Steps, 0]>
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
 * Speech text that is a type error when a string literal has unknown tags or wrapping tags
 * that aren't closed in order. The API accepts such text without an error, then skips tags,
 * reads them aloud, or makes unrelated sounds. Text typed as `string` or `UnsafeSpeechText`
 * is sent as written, so tags released after this SDK still work.
 */
export type SpeechText<T extends string> = string extends T
  ? T
  : [...InlineProblems<T>, ...WrappingProblems<T>] extends infer Problems extends Array<string>
    ? Problems extends []
      ? T
      : Message<Problems>
    : never;
