import type {
  BatchCreateParams,
  BatchRequest,
  BatchRequestMetadata,
  BatchResult,
  CreateParams,
} from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type RequestBody = BatchRequest["batch_request"];

export type BatchNameIsRequired = Assert<
  IsOptional<BatchCreateParams, "name"> extends false ? true : false
>;
export type BatchRequestIdIsOptional = Assert<IsOptional<BatchRequest, "batch_request_id">>;
export type ResponsesRequestsTakeCreateParams = Assert<
  Equals<Extract<RequestBody, { responses: unknown }>["responses"], CreateParams>
>;
export type RequestStatesAreDocumented = Assert<
  Equals<
    BatchRequestMetadata["state"],
    "unknown" | "pending" | "succeeded" | "cancelled" | "failed"
  >
>;

export const batchRequestExamples = [
  {
    batch_request_id: "feedback_001",
    batch_request: {
      responses: {
        model: "grok-4.3",
        input: [
          { role: "system", content: "Classify the sentiment as positive, negative, or neutral." },
          { role: "user", content: "The product exceeded my expectations!" },
        ],
      },
    },
  },
  {
    batch_request_id: "chat_001",
    batch_request: {
      responses: {
        model: "grok-4.3",
        tools: [{ type: "web_search" }, { type: "x_search" }],
        input: [{ role: "user", content: "What is the current sentiment around TSLA stock?" }],
      },
    },
  },
  {
    batch_request_id: "img_001",
    batch_request: {
      image_generation: {
        model: "grok-imagine-image-2.0",
        prompt: "A sleek modern laptop on a minimalist desk",
      },
    },
  },
  {
    batch_request_id: "img_edit_001",
    batch_request: {
      image_edit: {
        model: "grok-imagine-image-2.0",
        prompt: "Add a rainbow in the background",
        image: { url: "https://picsum.photos/800" },
      },
    },
  },
  {
    batch_request_id: "vid_001",
    batch_request: {
      video_generation: {
        model: "grok-imagine-video-1.5",
        prompt: "A product rotating on a turntable with dramatic lighting",
      },
    },
  },
  {
    batch_request_id: "vid_edit_001",
    batch_request: {
      video_generation: {
        model: "grok-imagine-video",
        prompt: "Make it slow motion",
        video: { url: "https://lorem.video/cat_360p_3s" },
      },
    },
  },
  {
    batch_request_id: "vid_ext_001",
    batch_request: {
      video_extension: {
        model: "grok-imagine-video",
        prompt: "The camera slowly pans to reveal a sunset behind the mountains",
        video: { url: "https://lorem.video/cat_360p_3s" },
        duration: 6,
      },
    },
  },
] satisfies Array<BatchRequest>;

// @ts-expect-error Batch requests wrap only the documented request types.
export const unsupportedRequest: BatchRequest = { batch_request: { embeddings: { input: "hi" } } };

export const chatRequest: BatchRequest = {
  // @ts-expect-error Text requests go through `responses`, not Chat Completions.
  batch_request: { chat_get_completion: { model: "grok-4", messages: [{ role: "user", content: "hi" }] } },
};

export function describeResult({ batch_request_id, batch_result }: BatchResult): string {
  if ("error" in batch_result) return `${batch_request_id} failed: ${batch_result.error}`;
  const { response } = batch_result;
  if (typeof response === "object" && "chat_get_completion" in response) {
    return response.chat_get_completion.choices[0]?.message.content ?? "";
  }
  return batch_request_id;
}
