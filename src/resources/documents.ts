import { send } from "../http.js";
import { APIProtocolError } from "../errors.js";
import { requireRecord } from "./shared.js";
import type {
  DocumentSearchParams,
  DocumentSearchResponse,
  HttpMeta,
  RequestOpts,
} from "../types.js";
import type { xAI } from "../client.js";

export class Documents {
  constructor(private readonly client: xAI) {}

  async search(
    params: DocumentSearchParams,
    opts?: RequestOpts,
  ): Promise<DocumentSearchResponse & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: "/documents/search",
      body: params,
      opts,
    });
    const body = requireRecord(result.payload, result.http.requestId, "Document search response");
    if (!Array.isArray(body.matches)) {
      throw new APIProtocolError("Document search response is missing matches", {
        requestId: result.http.requestId,
        body,
      });
    }
    return { ...(body as DocumentSearchResponse), http: result.http };
  }
}
