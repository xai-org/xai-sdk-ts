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
] satisfies Array<ImageGenerateParams>;

const sourceImage = { url: "https://example.com/cat.png" };
const editBase = { model: "grok-imagine-image-2.0", prompt: "Add a hat" } as const;

export const imageEditExamples = [
  { ...editBase, image: sourceImage },
  { ...editBase, image: new File(["png"], "cat.png", { type: "image/png" }) },
  { ...editBase, images: [new Blob(["png"]), { file_id: "file_1" }, sourceImage] },
] satisfies Array<ImageEditParams>;

// @ts-expect-error `image` and `images` are mutually exclusive.
export const conflictingEdit: ImageEditParams = { ...editBase, image: sourceImage, images: [] };
