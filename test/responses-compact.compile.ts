import type { CompactParams, CompactResponse, InputItem } from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

export type CompactModelIsRequired = Assert<
  IsOptional<CompactParams, "model"> extends false ? true : false
>;
export type CompactOutputIsInput = Assert<
  CompactResponse["output"] extends InputItem[] ? true : false
>;

export const compactExample = {
  model: "grok-released-after-this-sdk",
  input: [
    { type: "compaction", id: "cmp_1", encrypted_content: "enc_1" },
    { role: "user", content: [{ type: "input_image", image: new Blob(["png"]) }] },
  ],
} satisfies CompactParams;
