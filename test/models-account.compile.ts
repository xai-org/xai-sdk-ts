import type { ModelId, SpaceXAI } from "../src/index.js";

type Assert<T extends true> = T;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type LanguageModelIdIsModelId = Assert<
  Equals<Parameters<SpaceXAI["models"]["language"]["get"]>[0], ModelId>
>;
