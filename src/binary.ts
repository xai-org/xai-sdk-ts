import { withClientRequestId } from "./errors.js";
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
    return this.#read((response) => response.arrayBuffer());
  }

  async blob(): Promise<Blob> {
    return new Blob([await this.arrayBuffer()], { type: this.contentType ?? "" });
  }

  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.arrayBuffer());
  }

  async text(): Promise<string> {
    return this.#read((response) => response.text());
  }

  async #read<T>(consume: (response: Response) => Promise<T>): Promise<T> {
    try {
      return await consume(new Response(this.body));
    } catch (err) {
      throw withClientRequestId(err, this.http.clientRequestId);
    }
  }
}
