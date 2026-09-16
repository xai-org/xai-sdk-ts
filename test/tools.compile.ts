import type { Tool } from "../src/index.js";
import {
  codeExecution,
  collectionsSearch,
  imageGeneration,
  mcp,
  toolSearch,
  webSearch,
  xSearch,
} from "../src/tools.js";

export const helperTools: Array<Tool> = [
  webSearch({ search_context_size: "high" }),
  xSearch({ enable_image_understanding: true }),
  codeExecution(),
  collectionsSearch({ vector_store_ids: ["collection_1"] }),
  mcp({ server_url: "https://example.com/mcp", server_label: "example", defer_loading: true }),
  imageGeneration(),
  toolSearch(),
];

export function optionsAreChecked(): void {
  // @ts-expect-error misspelled option
  xSearch({ allowed_x_handle: ["xai"] });
  // @ts-expect-error dates are strings
  xSearch({ from_date: 20260901 });
  // @ts-expect-error handles are an array
  xSearch({ allowed_x_handles: "xai" });
  // @ts-expect-error collection IDs are required
  collectionsSearch({});
  // @ts-expect-error the API rejects filters
  collectionsSearch({ vector_store_ids: ["collection_1"], filters: {} });
  // @ts-expect-error server_url is required
  mcp({ server_label: "example" });
  // @ts-expect-error require_approval isn't supported
  mcp({ server_url: "https://example.com/mcp", server_label: "example", require_approval: "never" });
  // @ts-expect-error code execution takes no options
  codeExecution({ container: "container_1" });
}
