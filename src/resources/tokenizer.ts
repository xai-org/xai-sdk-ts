import { send } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import { requireRecord } from "./shared.js";
import type { HttpMeta, RequestOpts, TokenizeParams, TokenizeResponse } from "../types.js";
import type { xAI } from "../client.js";

export class Tokenizer {
  constructor(private readonly client: xAI) {}

  async encode(
    params: TokenizeParams,
    opts?: RequestOpts,
  ): Promise<TokenizeResponse & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: "/tokenize-text",
      body: params,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Tokenize response");
    if (!Array.isArray(body.token_ids)) {
      throw new APIProtocolError("Tokenize response is missing token_ids", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as TokenizeResponse), http: result.http };
  }
}
