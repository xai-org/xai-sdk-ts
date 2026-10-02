import { z } from "zod";
import type { ModelResponse } from "../src/index.js";

type Assert<T extends true> = T;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Coercion and defaults make Zod's output type differ from its input type. */
const Trip = z.object({
  city: z.string(),
  days: z.coerce.number(),
  budget: z.enum(["low", "medium", "high"]).default("medium"),
});

export function jsonResults(response: ModelResponse) {
  return { typed: response.toJson(Trip), untyped: response.toJson() };
}

type Results = ReturnType<typeof jsonResults>;

export type ToJsonReturnsTheZodOutput = Assert<Equals<Results["typed"], z.infer<typeof Trip>>>;
export type ToJsonWithoutASchemaIsUnknown = Assert<Equals<Results["untyped"], unknown>>;
