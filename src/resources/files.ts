import { send, type SendResult } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import { xAIBinaryResponse } from "../binary.js";
import { requireRecord } from "./shared.js";
import type {
  DeletedFile,
  FileContentParams,
  FileListParams,
  FileObject,
  FileObjectList,
  FilePublicUrl,
  FilePublicUrlParams,
  FilePublicUrlRevocation,
  FileUploadParams,
  HttpMeta,
  RequestOpts,
} from "../types.js";
import type { xAI } from "../client.js";

function toFileObject(result: SendResult): FileObject & { http: HttpMeta } {
  const body = requireRecord(result.payload, result.http, "File");
  if (typeof body.id !== "string" || body.id.length === 0) {
    throw new APIProtocolError("File response is missing id", {
      ...requestIds(result.http),
      body,
    });
  }
  return { ...(body as FileObject), http: result.http };
}

export class Files {
  constructor(private readonly client: xAI) {}

  async upload(params: FileUploadParams, opts?: RequestOpts): Promise<FileObject & { http: HttpMeta }> {
    const form = new FormData();
    // The API streams the file part as it arrives, so metadata fields must come first.
    if (params.expires_after != null) form.append("expires_after", String(params.expires_after));
    if (params.purpose != null) form.append("purpose", params.purpose);
    // Node 22 names the part "undefined" when the filename argument is undefined.
    if (params.filename === undefined) form.append("file", params.file);
    else form.append("file", params.file, params.filename);
    const result = await send(this.client, {
      method: "POST",
      path: "/files",
      body: form,
      opts,
    });
    return toFileObject(result);
  }

  async list(query: FileListParams = {}, opts?: RequestOpts): Promise<FileObjectList & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/files",
      query: { ...query, sort_by: query.sort_by ?? "created_at" },
      opts,
    });
    const body = requireRecord(result.payload, result.http, "File list");
    if (!Array.isArray(body.data)) {
      throw new APIProtocolError("File list is missing data", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as FileObjectList), http: result.http };
  }

  async get(id: string, opts?: RequestOpts): Promise<FileObject & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/files/${encodeURIComponent(id)}`,
      opts,
    });
    return toFileObject(result);
  }

  async delete(id: string, opts?: RequestOpts): Promise<DeletedFile & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "DELETE",
      path: `/files/${encodeURIComponent(id)}`,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "File delete response");
    if (typeof body.id !== "string" || body.deleted !== true) {
      throw new APIProtocolError("File delete response is missing id or deleted=true", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as DeletedFile), http: result.http };
  }

  async content(id: string, query: FileContentParams = {}, opts?: RequestOpts): Promise<xAIBinaryResponse> {
    const result = await send(this.client, {
      method: "GET",
      path: `/files/${encodeURIComponent(id)}/content`,
      query,
      binary: true,
      opts,
    });
    return new xAIBinaryResponse(result.body, result.http);
  }

  async createPublicUrl(
    id: string,
    params: FilePublicUrlParams = {},
    opts?: RequestOpts,
  ): Promise<FilePublicUrl & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: `/files/${encodeURIComponent(id)}/public-url`,
      body: params,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Public URL response");
    if (typeof body.public_url !== "string") {
      throw new APIProtocolError("Public URL response is missing public_url", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as FilePublicUrl), http: result.http };
  }

  async revokePublicUrl(id: string, opts?: RequestOpts): Promise<FilePublicUrlRevocation & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: `/files/${encodeURIComponent(id)}/public-url/revoke`,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Public URL revoke response");
    if (typeof body.id !== "string" || typeof body.revoked !== "boolean") {
      throw new APIProtocolError("Public URL revoke response is missing id or revoked", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as FilePublicUrlRevocation), http: result.http };
  }
}
