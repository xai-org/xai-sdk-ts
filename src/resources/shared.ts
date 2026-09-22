import { APIProtocolError } from "../errors.js";

export function requireRecord(
  payload: unknown,
  requestId: string | null,
  label: string,
): Record<string, unknown> {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  throw new APIProtocolError(`${label} must be a JSON object`, {
    requestId,
    body: payload,
  });
}
