import { send } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import { requireRecord } from "./shared.js";
import type { ApiKeyInfo, HttpMeta, RequestOpts } from "../types.js";
import type { SpaceXAI } from "../client.js";

export class Account {
  constructor(private readonly client: SpaceXAI) {}

  async apiKey(opts?: RequestOpts): Promise<ApiKeyInfo & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/api-key",
      opts,
    });
    const body = requireRecord(result.payload, result.http, "API key info");
    if (typeof body.api_key_id !== "string") {
      throw new APIProtocolError("API key info is missing api_key_id", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as ApiKeyInfo), http: result.http };
  }
}
