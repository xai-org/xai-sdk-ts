import { describe, expect, it } from "vitest";
import { APIProtocolError, SpaceXAI } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

const languageModel = {
  id: "grok-4.6",
  fingerprint: "fp_156d35dcaa",
  created: 1_776_556_800,
  object: "model",
  owned_by: "xai",
  version: "1.0",
  input_modalities: ["text", "image"],
  output_modalities: ["text"],
  prompt_text_token_price: 20_000,
  cached_prompt_text_token_price: 5_000,
  prompt_image_token_price: 20_000,
  completion_text_token_price: 60_000,
  search_price: 0,
  prompt_text_token_price_long_context: 40_000,
  cached_prompt_text_token_price_long_context: 10_000,
  completion_text_token_price_long_context: 120_000,
  long_context_threshold: 200_000,
  aliases: ["grok-4.6-latest"],
  capabilities: { reasoning_effort: ["low", "medium", "high"], default_reasoning_effort: "high" },
};

const apiKeyInfo = {
  redacted_api_key: "xai-...b14o",
  user_id: "59fbe5f2-040b-46d5-8325-868bb8f23eb2",
  name: "My API Key",
  create_time: "2024-01-01T12:55:18.139305Z",
  modify_time: "2024-08-28T17:20:12.343321Z",
  modified_by: "3d38b4dc-4eb7-4785-ae26-c3fa8997ffc7",
  team_id: "5ea6f6bd-7815-4b8a-9135-28b2d7ba6722",
  acls: ["api-key:model:*", "api-key:endpoint:*"],
  api_key_id: "ae1e1841-4326-4b36-a8a9-8a1a7237db11",
  team_blocked: false,
  api_key_blocked: false,
  api_key_disabled: false,
};

function client(fetch: typeof globalThis.fetch): SpaceXAI {
  return new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

describe("models.language", () => {
  it("lists and gets language models", async () => {
    const { fetch, captured } = mockFetch((req) =>
      req.url.endsWith("/language-models")
        ? jsonResponse({ models: [languageModel] })
        : jsonResponse(languageModel),
    );
    const c = client(fetch);
    const list = await c.models.language.list();
    const { http, ...got } = await c.models.language.get("grok-4.6");
    await c.models.language.get("custom/alias");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/language-models",
      "GET https://api.x.ai/v1/language-models/grok-4.6",
      "GET https://api.x.ai/v1/language-models/custom%2Falias",
    ]);
    expect(list.models).toEqual([languageModel]);
    expect(list.http.requestId).toBe("req_test");
    expect(got).toEqual(languageModel);
    expect(http.status).toBe(200);
  });
});

describe("account", () => {
  it("gets the calling API key", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(apiKeyInfo));
    const { http, ...info } = await client(fetch).account.apiKey();

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/api-key",
    ]);
    expect(info).toEqual(apiKeyInfo);
    expect(http.requestId).toBe("req_test");
  });
});

type Call = (c: SpaceXAI) => Promise<unknown>;

const listLanguageModels: Call = (c) => c.models.language.list();
const getLanguageModel: Call = (c) => c.models.language.get("grok-4.6");
const getApiKey: Call = (c) => c.account.apiKey();

describe("language model and account response validation", () => {
  it.each<[string, Call, unknown]>([
    ["a non-object language model list", listLanguageModels, [languageModel]],
    ["a /v1/models list body", listLanguageModels, { object: "list", data: [languageModel] }],
    ["language models without ids", listLanguageModels, { models: [{ object: "model" }] }],
    ["a language model without an id", getLanguageModel, { object: "model" }],
    ["a non-object API key body", getApiKey, "not json"],
    ["an API key without api_key_id", getApiKey, { name: apiKeyInfo.name }],
  ])("rejects %s", async (_label, call, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(call(client(fetch))).rejects.toBeInstanceOf(APIProtocolError);
  });
});
