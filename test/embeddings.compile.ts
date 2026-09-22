import type { EmbeddingCreateParams, TokenizeParams } from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

export type EmbeddingModelIsRequired = Assert<
  IsOptional<EmbeddingCreateParams, "model"> extends false ? true : false
>;
export type EmbeddingInputIsRequired = Assert<
  IsOptional<EmbeddingCreateParams, "input"> extends false ? true : false
>;
export type TokenizeModelIsRequired = Assert<
  IsOptional<TokenizeParams, "model"> extends false ? true : false
>;
export type TokenizeTextIsRequired = Assert<
  IsOptional<TokenizeParams, "text"> extends false ? true : false
>;

const model = "grok-embedding-small";

export const embeddingExamples = [
  { model, input: "query: What is Grok?" },
  { model, input: ["passage: one", "passage: two"], dimensions: 256, encoding_format: "base64" },
  { model, input: [13902, 1749] },
  { model, input: [[13902, 1749], [161]] },
] satisfies EmbeddingCreateParams[];

// @ts-expect-error The API takes bare inputs, not the tagged objects in the OpenAPI schema.
export const taggedInput: EmbeddingCreateParams = { model, input: { StringArray: ["one"] } };

export const tokenizeExamples = [
  { model: "grok-4.6", text: "Hello world!" },
  { model: "grok-released-after-this-sdk", text: "Hello world!" },
] satisfies TokenizeParams[];
