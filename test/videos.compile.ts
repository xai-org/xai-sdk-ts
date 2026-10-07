import type {
  ImageInput,
  MediaUsage,
  ReferenceAudioInput,
  VideoEditParams,
  VideoExtendParams,
  VideoGenerateParams,
  VideoResponse,
  VoiceId,
} from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Keyframe = NonNullable<VideoGenerateParams["keyframes"]>[number];
type ReferenceAudio = NonNullable<VideoGenerateParams["reference_audios"]>[number];

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
export type LastFrameAcceptsBlobs = Assert<Equals<NonNullable<VideoGenerateParams["last_frame"]>, ImageInput>>;
export type ReferenceAudiosAcceptInputs = Assert<Equals<ReferenceAudio, ReferenceAudioInput>>;
export type ReferenceVoiceIdsAutocomplete = Assert<
  Equals<Extract<ReferenceAudio, { voice_id: unknown }>["voice_id"], VoiceId>
>;
export type UsageIsMapped = Assert<Equals<VideoResponse["usage"], MediaUsage | null>>;

export const generateExamples = [
  { model: "grok-imagine-video-1.5", prompt: "A lighthouse at dusk" },
  { model: "grok-imagine-video-1.5", image: { file_id: "file_1" } },
  { model: "grok-imagine-video-released-after-this-sdk", prompt: "A lighthouse at dusk" },
  { model: "grok-imagine-video-1.5", image: { file_id: "file_1" }, last_frame: new Blob(["png"]) },
] satisfies Array<VideoGenerateParams>;

export const referenceAudioExamples = [
  { voice_id: "ara" },
  { voice_id: "nlbqfwie" },
  { url: "https://example.com/voice.wav" },
  { url: "data:audio/wav;base64,UklGRg==" },
  new Blob(["wav"], { type: "audio/wav" }),
  new File(["mp3"], "voice.mp3", { type: "audio/mpeg" }),
] satisfies Array<ReferenceAudioInput>;

export const referenceAudioRequest: VideoGenerateParams = {
  model: "grok-imagine-video-1.5",
  prompt: "Two friends talk on a park bench",
  reference_audios: [{ voice_id: "eve" }, { url: "https://example.com/voice.wav" }],
};

export const emptyReferenceAudio: VideoGenerateParams = {
  model: "grok-imagine-video-1.5",
  // @ts-expect-error A reference audio needs a voice_id, a url, or a Blob.
  reference_audios: [{}],
};

// @ts-expect-error A reference audio takes a voice_id or a url, not both.
export const conflictingReferenceAudio: ReferenceAudioInput = { voice_id: "ara", url: "https://example.com/voice.wav" };

export const editExample = {
  model: "grok-imagine-video",
  prompt: "Add snow to the scene",
  video: new Blob(["mp4"]),
} satisfies VideoEditParams;

export const extendExample = {
  model: "grok-imagine-video",
  prompt: "The camera pulls back",
  video: new File(["mp4"], "clip.mp4", { type: "video/mp4" }),
  duration: 6,
} satisfies VideoExtendParams;
