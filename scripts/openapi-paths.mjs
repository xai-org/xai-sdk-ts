/**
 * How `pnpm generate:types` treats each path in the OpenAPI spec. Every path must be in exactly one list,
 * so a new endpoint fails generation instead of disappearing from src/generated/types.ts.
 */

/** Paths whose operations src/generated/types.ts keeps. */
export const KEEP_PATHS = new Set([
  "/v1/responses",
  "/v1/responses/{response_id}",
  "/v1/responses/{response_id}/input_items",
  "/v1/models",
  "/v1/models/{model_id}",
  "/v1/images/generations",
  "/v1/images/edits",
  "/v1/images/{request_id}",
  "/v1/image-generation-models",
  "/v1/image-generation-models/{model_id}",
  "/v1/files",
  "/v1/files/{file_id}",
  "/v1/files/{file_id}/content",
  "/v1/files/{file_id}/public-url",
  "/v1/files/{file_id}/public-url/revoke",
  "/v1/responses/compact",
  "/v1/videos/generations",
  "/v1/videos/edits",
  "/v1/videos/extensions",
  "/v1/videos/{request_id}",
  "/v1/video-generation-models",
  "/v1/video-generation-models/{model_id}",
  "/v1/tokenize-text",
  "/v1/language-models",
  "/v1/language-models/{model_id}",
  "/v1/api-key",
]);

/** Public paths the SDK doesn't wrap. */
export const IGNORED_PATHS = new Set([
  // The SDK uses the Responses API instead of these compatibility and legacy endpoints.
  "/v1/chat/completions",
  "/v1/chat/deferred-completion/{request_id}",
  "/v1/complete",
  "/v1/completions",
  "/v1/messages",
  // Not wrapped yet.
  "/v1/documents/search",
  "/v1/embedding-models",
  "/v1/embedding-models/{model_id}",
  "/v1/embeddings",
  "/v1/me",
  "/v1/skills",
  "/v1/skills/{skill_id}",
  "/v1/skills/{skill_id}/content",
]);

/** Describes each spec path in neither list or both, and each listed path the spec no longer has. */
export function pathProblems(paths, keep = KEEP_PATHS, ignored = IGNORED_PATHS) {
  const specPaths = new Set(paths);
  const problems = [];
  for (const candidate of specPaths) {
    if (!keep.has(candidate) && !ignored.has(candidate)) {
      problems.push(
        `${candidate} is new: add it to KEEP_PATHS to generate its types, or to IGNORED_PATHS if the SDK won't wrap it`,
      );
    }
  }
  for (const candidate of keep) {
    if (ignored.has(candidate)) problems.push(`${candidate} is in both KEEP_PATHS and IGNORED_PATHS`);
  }
  for (const [name, list] of [["KEEP_PATHS", keep], ["IGNORED_PATHS", ignored]]) {
    for (const candidate of list) {
      if (!specPaths.has(candidate)) problems.push(`${name} has ${candidate}, which the spec no longer has`);
    }
  }
  return problems;
}
