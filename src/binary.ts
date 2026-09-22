import type { HttpMeta } from "./types.js";

export class xAIBinaryResponse {
  body: ReadableStream<Uint8Array> | null;
  contentType: string | null;
  http: HttpMeta;

  constructor(body: ReadableStream<Uint8Array> | null, http: HttpMeta) {
    this.body = body;
    this.contentType = http.headers.get("content-type");
    this.http = http;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return new Response(this.body).arrayBuffer();
  }

  async blob(): Promise<Blob> {
    return new Blob([await this.arrayBuffer()], { type: this.contentType ?? "" });
  }

  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.arrayBuffer());
  }

  async text(): Promise<string> {
    return new Response(this.body).text();
  }
}
