import type { components } from "./generated/types.js";

type GeneratedTool = components["schemas"]["ModelTool"];
type ToolOf<T extends GeneratedTool["type"]> = Extract<GeneratedTool, { type: T }>;
type OptionsOf<T extends GeneratedTool["type"], Unsupported extends string = never> = Omit<
  ToolOf<T>,
  "type" | Unsupported
>;

/** Searches the web. */
export function webSearch(options: OptionsOf<"web_search"> = {}): ToolOf<"web_search"> {
  return { ...options, type: "web_search" };
}

/** Searches posts on X. `allowed_x_handles` and `excluded_x_handles` can't be used together. */
export function xSearch(options: OptionsOf<"x_search"> = {}): ToolOf<"x_search"> {
  return { ...options, type: "x_search" };
}

/** Writes and runs Python code in a sandbox. */
export function codeExecution(): ToolOf<"code_interpreter"> {
  return { type: "code_interpreter" };
}

/** Searches the collections listed in `vector_store_ids`. The API rejects `filters` and `ranking_options`. */
export function collectionsSearch(
  options: OptionsOf<"file_search", "filters" | "ranking_options">,
): ToolOf<"file_search"> {
  return { ...options, type: "file_search" };
}

/** Calls tools on a remote MCP server. `connector_id` and `require_approval` aren't supported. */
export function mcp(options: OptionsOf<"mcp", "connector_id" | "require_approval">): ToolOf<"mcp"> {
  return { ...options, type: "mcp" };
}

/** Lets the model create or edit images. */
export function imageGeneration(options: OptionsOf<"image_generation"> = {}): ToolOf<"image_generation"> {
  return { ...options, type: "image_generation" };
}

/** Loads the definitions of tools marked `defer_loading: true` when the model needs them. */
export function toolSearch(): ToolOf<"tool_search"> {
  return { type: "tool_search" };
}
