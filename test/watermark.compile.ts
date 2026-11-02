import type { CreateParams, ModelResponse, ResponseStream } from "../src/index.js";

type Assert<T extends true> = T;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type ResponsesReportWatermarking = Assert<Equals<ModelResponse["watermarked"], boolean>>;
export type StreamsReportWatermarking = Assert<Equals<ResponseStream["watermarked"], boolean>>;

export function setWatermarked(response: ModelResponse, stream: ResponseStream): void {
  // @ts-expect-error `watermarked` comes from the response headers.
  response.watermarked = true;
  // @ts-expect-error `watermarked` comes from the response headers.
  stream.watermarked = true;
}

// @ts-expect-error Watermarking has no request parameter.
export const watermarkedRequest: CreateParams = { model: "grok-4.7", input: "Hi", watermarked: true };
