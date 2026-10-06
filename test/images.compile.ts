import type {
  DeferredImageResponse,
  HttpMeta,
  ImageEditParams,
  ImageGenerateParams,
  ImageResponse,
  ImageStartResponse,
  ImageWaitOptions,
  MediaUsage,
  SpaceXAI,
  Tool,
} from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ImageStart = ImageStartResponse & { http: HttpMeta };

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

export type DeferredIsOptional = Assert<IsOptional<ImageGenerateParams, "deferred">>;
export type OutputIsOptional = Assert<IsOptional<ImageEditParams, "output">>;
export type WaitOptionsAreOptional = Assert<
  Equals<ImageWaitOptions, { interval?: number; timeout?: number; signal?: AbortSignal }>
>;
export type DeferredUsageIsMapped = Assert<Equals<DeferredImageResponse["usage"], MediaUsage | null>>;
export type DeferredResultHasRequestId = Assert<Equals<DeferredImageResponse["request_id"], string>>;

const generateBase = { model: "grok-imagine-image", prompt: "A lighthouse at dawn" } as const;
const preparedDeferred = { ...generateBase, deferred: true } satisfies ImageGenerateParams;
declare const deferredFlag: boolean;

export async function generateResults(client: SpaceXAI) {
  return [
    await client.images.generate({ ...generateBase, deferred: true }),
    await client.images.generate({ ...generateBase, deferred: false }),
    await client.images.generate(generateBase),
    await client.images.generate({ ...generateBase, deferred: deferredFlag }),
    await client.images.generate(preparedDeferred),
  ] as const;
}

type GenerateResults = Awaited<ReturnType<typeof generateResults>>;
export type DeferredGenerateResolvesToStart = Assert<Equals<GenerateResults[0], ImageStart>>;
export type UndeferredGenerateResolvesToImages = Assert<Equals<GenerateResults[1], ImageResponse>>;
export type DefaultGenerateResolvesToImages = Assert<Equals<GenerateResults[2], ImageResponse>>;
export type BooleanGenerateResolvesToEither = Assert<
  Equals<GenerateResults[3], ImageResponse | ImageStart>
>;
export type PreparedDeferredResolvesToStart = Assert<Equals<GenerateResults[4], ImageStart>>;

export async function deferredEdit(client: SpaceXAI) {
  const start = await client.images.edit({
    ...editBase,
    images: [new Blob(["png"]), { file_id: "file_1" }],
    deferred: true,
    output: { upload_urls: ["https://storage.example.com/a.jpg", "https://storage.example.com/b.jpg"] },
  });
  const result = await client.images.wait(start.request_id, { interval: 2_000, timeout: 60_000 });
  return { start, result, once: await client.images.get(start.request_id) };
}

type DeferredEdit = Awaited<ReturnType<typeof deferredEdit>>;
export type DeferredEditResolvesToStart = Assert<Equals<DeferredEdit["start"], ImageStart>>;
export type WaitResolvesToDeferredResult = Assert<
  Equals<DeferredEdit["result"], DeferredImageResponse>
>;
export type GetResolvesToDeferredResult = Assert<Equals<DeferredEdit["once"], DeferredImageResponse>>;

// @ts-expect-error `output` needs `upload_urls`.
export const outputWithoutUrls: ImageGenerateParams = { ...generateBase, output: {} };
