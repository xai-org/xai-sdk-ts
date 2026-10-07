import type { ImageEditParams, ImageGenerateParams, Tool } from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

export type ImageModelIsRequired = Assert<
  IsOptional<ImageGenerateParams, "model"> extends false ? true : false
>;
export type ImagePromptIsRequired = Assert<
  IsOptional<ImageGenerateParams, "prompt"> extends false ? true : false
>;

export const imageGenerationToolExample = {
  type: "image_generation",
  action: "generate",
} satisfies Tool;

export const imageGenerateExamples = [
  { model: "grok-imagine-image-2.0", prompt: "A lighthouse at dawn" },
  {
    model: "grok-imagine-image-released-after-this-sdk",
    prompt: "A lighthouse at dawn",
    n: 4,
    aspect_ratio: "16:9",
    resolution: "2k",
    quality: "medium",
    response_format: "b64_json",
  },
  {
    model: "grok-imagine-image-2.0",
    prompt: "A lighthouse at dawn",
    n: 2,
    output: { upload_urls: ["https://storage.example.com/1.jpg", "https://storage.example.com/2.jpg"] },
  },
] satisfies Array<ImageGenerateParams>;

const sourceImage = { url: "https://example.com/cat.png" };
const editBase = { model: "grok-imagine-image-2.0", prompt: "Add a hat" } as const;

export const imageEditExamples = [
  { ...editBase, image: sourceImage },
  { ...editBase, image: new File(["png"], "cat.png", { type: "image/png" }) },
  { ...editBase, images: [new Blob(["png"]), { file_id: "file_1" }, sourceImage] },
  { ...editBase, image: sourceImage, output: { upload_urls: ["https://storage.example.com/edit.jpg"] } },
] satisfies Array<ImageEditParams>;

// @ts-expect-error `image` and `images` are mutually exclusive.
export const conflictingEdit: ImageEditParams = { ...editBase, image: sourceImage, images: [] };

// @ts-expect-error `output` needs `upload_urls`.
export const outputWithoutUrls: ImageEditParams = { ...editBase, image: sourceImage, output: {} };

// @ts-expect-error Deferred requests stay out until their results can be fetched.
export const deferredGenerate: ImageGenerateParams = { ...editBase, deferred: true };

// @ts-expect-error Deferred requests stay out until their results can be fetched.
export const deferredEdit: ImageEditParams = { ...editBase, image: sourceImage, deferred: true };
