import type { CreateParams } from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Guideline = NonNullable<CreateParams["guidelines"]>[number];

export type GuidelinesAreOptional = Assert<IsOptional<CreateParams, "guidelines">>;
export type GuidelineCategories = Assert<
  [Guideline["category"]] extends ["sexual" | "violence" | "self_harm" | "illicit" | "profanity"] ? true : false
>;
export type GuidelineBehaviors = Assert<
  [Guideline["behavior"]] extends ["decline" | "offer_support"] ? true : false
>;

export const guidelinesExample = {
  model: "grok-released-after-this-sdk",
  input: "Hello",
  guidelines: [
    { type: "policy", category: "violence", behavior: "decline" },
    { type: "policy", category: "self_harm", behavior: "offer_support" },
  ],
} satisfies CreateParams;

export const unknownCategoryIsRejected = {
  model: "grok-released-after-this-sdk",
  input: "Hello",
  // @ts-expect-error: not a GuidelineCategory
  guidelines: [{ type: "policy", category: "gambling", behavior: "decline" }],
} satisfies CreateParams;
