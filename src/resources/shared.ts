import { APIProtocolError, requestIds } from "../errors.js";
import type { HttpMeta } from "../types.js";

export function requireRecord(
  payload: unknown,
  http: HttpMeta,
  label: string,
): Record<string, unknown> {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  throw new APIProtocolError(`${label} must be a JSON object`, {
    ...requestIds(http),
    body: payload,
  });
}
