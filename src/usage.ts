import type { components } from "./generated/types.js";

type ModelUsage = components["schemas"]["ModelUsage"];
type WireMediaUsage = components["schemas"]["MediaUsage"];

const TICKS_PER_USD = 1e10;
const NANO_USD_PER_USD = 1e9;

/** Image and video generation usage. `cost_usd` is derived from `cost_in_usd_ticks`. */
export type MediaUsage = WireMediaUsage & { cost_usd: number | null };

type NormalizedUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens_details: { reasoning_tokens: number };
  num_sources_used: number;
  num_server_side_tools_used: number;
  /** From `cost_in_usd_ticks`, or from `cost_in_nano_usd` when that is the only cost reported. */
  cost_usd: number | null;
  cost_in_nano_usd: number | null;
  cost_in_usd_ticks: number | null;
};

/** Wire usage fields the SDK does not normalize, such as `context_details`, pass through. */
export type Usage = Omit<ModelUsage, keyof NormalizedUsage> & NormalizedUsage;

function costUsd(ticks?: number | null, nano?: number | null): number | null {
  if (ticks != null) return ticks / TICKS_PER_USD;
  if (nano != null) return nano / NANO_USD_PER_USD;
  return null;
}

/**
 * Map a wire usage object. Completed results always surface a Usage object even if the
 * wire omitted it.
 */
export function mapUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Partial<ModelUsage>;
  return {
    ...u,
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    total_tokens: u.total_tokens ?? 0,
    input_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens ?? 0 },
    output_tokens_details: { reasoning_tokens: u.output_tokens_details?.reasoning_tokens ?? 0 },
    num_sources_used: u.num_sources_used ?? 0,
    num_server_side_tools_used: u.num_server_side_tools_used ?? 0,
    cost_in_nano_usd: u.cost_in_nano_usd ?? null,
    cost_in_usd_ticks: u.cost_in_usd_ticks ?? null,
    cost_usd: costUsd(u.cost_in_usd_ticks, u.cost_in_nano_usd),
  };
}

export function mapMediaUsage(raw: unknown): MediaUsage | null {
  if (raw == null) return null;
  const usage = raw as WireMediaUsage;
  return { ...usage, cost_usd: costUsd(usage.cost_in_usd_ticks) };
}
