import { combineSignals, sleep } from "../http.js";
import { APIProtocolError, TimeoutError, requestIds } from "../errors.js";
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

type PollOptions = {
  interval: number;
  timeout: number;
  signal?: AbortSignal;
  /** Names what is polled in the timeout message, such as `Video request req_1`. */
  label: string;
};

/**
 * Calls `poll` every `interval` milliseconds until `isDone` accepts its result. After `timeout`, rejects with
 * `TimeoutError` and aborts the poll in flight.
 */
export async function pollUntil<T>(
  poll: (signal: AbortSignal | undefined) => Promise<T>,
  isDone: (value: T) => boolean,
  { interval, timeout, signal, label }: PollOptions,
): Promise<T> {
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort(new TimeoutError(`${label} did not finish within ${timeout}ms`));
  }, timeout);
  const combined = combineSignals([signal, deadline.signal]);
  try {
    while (true) {
      const value = await poll(combined);
      if (isDone(value)) return value;
      await sleep(interval, combined);
    }
  } finally {
    clearTimeout(timer);
  }
}
