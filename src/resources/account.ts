import { send } from "../http.js";
import { APIProtocolError } from "../errors.js";
import { requireRecord } from "./shared.js";
import type { ApiKeyInfo, CallerInfo, RequestOpts } from "../types.js";
import type { xAI } from "../client.js";

export class Account {
  constructor(private readonly client: xAI) {}

  async apiKey(opts?: RequestOpts): Promise<ApiKeyInfo & { http: import("../types.js").HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/api-key",
      opts,
    });
    const body = requireRecord(result.payload, result.http.requestId, "API key info");
    if (typeof body.api_key_id !== "string") {
      throw new APIProtocolError("API key info is missing api_key_id", {
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as ApiKeyInfo), http: result.http };
  }

  async me(opts?: RequestOpts): Promise<CallerInfo & { http: import("../types.js").HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/me",
      opts,
    });
    const body = requireRecord(result.payload, result.http.requestId, "Caller info");
    if (typeof body.user_id !== "string") {
      throw new APIProtocolError("Caller info is missing user_id", {
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as CallerInfo), http: result.http };
  }
}
