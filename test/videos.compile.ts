import type {
  ImageInput,
  MediaUsage,
  VideoEditParams,
  VideoExtendParams,
  VideoGenerateParams,
  VideoResponse,
} from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Keyframe = NonNullable<VideoGenerateParams["keyframes"]>[number];

export type GenerateModelIsRequired = Assert<
  IsOptional<VideoGenerateParams, "model"> extends false ? true : false
>;
export type EditModelIsRequired = Assert<
  IsOptional<VideoEditParams, "model"> extends false ? true : false
>;
export type ExtendModelIsRequired = Assert<
  IsOptional<VideoExtendParams, "model"> extends false ? true : false
>;
export type ImageAcceptsBlobs = Assert<
  Equals<NonNullable<VideoGenerateParams["image"]>, ImageInput>
>;
export type ReferenceImagesAcceptBlobs = Assert<
  Equals<NonNullable<VideoGenerateParams["reference_images"]>[number], ImageInput>
>;
export type KeyframeImagesAcceptBlobs = Assert<Equals<Keyframe["image"], ImageInput>>;
export type UsageIsMapped = Assert<Equals<VideoResponse["usage"], MediaUsage | null>>;

export const generateExamples = [
  { model: "grok-imagine-video-1.5", prompt: "A lighthouse at dusk" },
  { model: "grok-imagine-video-1.5", image: { file_id: "file_1" } },
  { model: "grok-imagine-video-released-after-this-sdk", prompt: "A lighthouse at dusk" },
] satisfies VideoGenerateParams[];

export const editExample = {
  model: "grok-imagine-video",
  prompt: "Add snow to the scene",
  // @ts-expect-error Only image inputs accept Blob or File.
  video: new Blob(["mp4"]),
} satisfies VideoEditParams;
