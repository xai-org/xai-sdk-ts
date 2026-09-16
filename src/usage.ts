import type { components } from "./generated/types.js";

type ServerSideToolUsageDetails = components["schemas"]["ServerSideToolUsageDetails"];

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens_details: { reasoning_tokens: number };
  num_sources_used: number;
  num_server_side_tools_used: number;
  cost_usd: number | null;
  cost_in_nano_usd: number | null;
  cost_in_usd_ticks?: number | null;
  server_side_tool_usage_details?: ServerSideToolUsageDetails;
};

function int(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function emptyUsage(): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
    num_sources_used: 0,
    num_server_side_tools_used: 0,
    cost_usd: null,
    cost_in_nano_usd: null,
  };
}

/**
 * Map a wire usage object. `cost_usd` is nano / 1e9 when `cost_in_nano_usd` is present.
 * Completed results always surface a Usage object even if the wire omitted it.
 */
export function mapUsage(raw: unknown): Usage {
  const u = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const detailsIn =
    u.input_tokens_details && typeof u.input_tokens_details === "object"
      ? (u.input_tokens_details as Record<string, unknown>)
      : {};
  const detailsOut =
    u.output_tokens_details && typeof u.output_tokens_details === "object"
      ? (u.output_tokens_details as Record<string, unknown>)
      : {};
  const nano = intOrNull(u.cost_in_nano_usd);
  const ticks = intOrNull(u.cost_in_usd_ticks);
  const usage: Usage = {
    input_tokens: int(u.input_tokens),
    output_tokens: int(u.output_tokens),
    total_tokens: int(u.total_tokens),
    input_tokens_details: { cached_tokens: int(detailsIn.cached_tokens) },
    output_tokens_details: { reasoning_tokens: int(detailsOut.reasoning_tokens) },
    num_sources_used: int(u.num_sources_used),
    num_server_side_tools_used: int(u.num_server_side_tools_used),
    cost_in_nano_usd: nano,
    cost_usd: nano != null ? nano / 1e9 : null,
  };
  if (ticks != null) usage.cost_in_usd_ticks = ticks;
  if (u.server_side_tool_usage_details && typeof u.server_side_tool_usage_details === "object") {
    usage.server_side_tool_usage_details = u.server_side_tool_usage_details as ServerSideToolUsageDetails;
  }
  return usage;
}
