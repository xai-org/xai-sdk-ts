import type { CreateParams } from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Guideline = NonNullable<CreateParams["guidelines"]>[number];

export type GuidelinesAreOptional = Assert<IsOptional<CreateParams, "guidelines">>;
export type GuidelineCategories = Assert<Equals<Guideline["category"], "nsfw" | "violence" | "profanity">>;
export type GuidelineBehaviors = Assert<Equals<Guideline["behavior"], "decline">>;

export const guidelinesExample = {
  model: "grok-released-after-this-sdk",
  input: "Hello",
  guidelines: [
    { type: "policy", category: "nsfw", behavior: "decline" },
    { type: "policy", category: "violence", behavior: "decline" },
    { type: "policy", category: "profanity", behavior: "decline" },
  ],
} satisfies CreateParams;

// @ts-expect-error `sexual` is now `nsfw`.
export const sexualCategory: Guideline = { type: "policy", category: "sexual", behavior: "decline" };
// @ts-expect-error The API no longer accepts `self_harm`.
export const selfHarmCategory: Guideline = { type: "policy", category: "self_harm", behavior: "decline" };
// @ts-expect-error The API no longer accepts `illicit`.
export const illicitCategory: Guideline = { type: "policy", category: "illicit", behavior: "decline" };
// @ts-expect-error `decline` is the only behavior.
export const offerSupportBehavior: Guideline = { type: "policy", category: "violence", behavior: "offer_support" };
