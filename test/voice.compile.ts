import type {
  ClientSecretCreateParams,
  CustomVoiceCreateParams,
  CustomVoiceUpdateParams,
  HttpMeta,
  KnownRealtimeModelId,
  KnownTranscriptionModelId,
  KnownVoiceId,
  SpeechParams,
  SpeechWithTimestamps,
  TranscriptionParams,
  UnsafeSpeechText,
  SpaceXAI,
  BinaryResponse,
  Voice,
} from "../src/index.js";
import type { SpeechText } from "../src/speech-tags.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export async function speakResults(client: SpaceXAI) {
  return {
    audio: await client.voice.speak({ text: "Hello", language: "en" }),
    timed: await client.voice.speak({ text: "Hello", language: "en", with_timestamps: true }),
  };
}

type Spoken = Awaited<ReturnType<typeof speakResults>>;

export type SpeakReturnsAudioBytes = Assert<Equals<Spoken["audio"], BinaryResponse>>;
export type TimestampsReturnJson = Assert<
  Equals<Spoken["timed"], SpeechWithTimestamps & { http: HttpMeta }>
>;
export type SpeechLanguageIsRequired = Assert<
  IsOptional<SpeechParams, "language"> extends false ? true : false
>;
export type CustomVoiceFileIsRequired = Assert<
  IsOptional<CustomVoiceCreateParams, "file"> extends false ? true : false
>;

export async function speechTagChecks(client: SpaceXAI) {
  await client.voice.speak({ text: "Hi [new-tag] there." as UnsafeSpeechText, language: "en" });
  await client.voice.speak({ text: "They said [they] would come.", language: "en" });
  // @ts-expect-error `[laff]` is not a speech tag.
  await client.voice.speak({ text: "Hi [laff] there.", language: "en" });
  // @ts-expect-error Markup is not a speech tag.
  await client.voice.speak({ text: 'Grok said so.<citation id="web:23"/>', language: "en" });
}

type Newer = " For a tag newer than this SDK, add `as UnsafeSpeechText` to the text.";

export type SpeechTagMessages = [
  Assert<Equals<SpeechText<"Hi [laff] there.">, `Unknown speech tag [laff], did you mean [laugh]?${Newer}`>>,
  Assert<
    Equals<
      SpeechText<"Hi [laff] there. <wisper>Quiet.</wisper>">,
      `Unknown speech tag [laff], did you mean [laugh]? Unknown speech tag <wisper>, did you mean <whisper>?${Newer}`
    >
  >,
  Assert<Equals<SpeechText<"Then a [door-creak] sounded.">, `Unknown speech tag [door-creak].${Newer}`>>,
  Assert<
    Equals<
      SpeechText<"Ha [laughs], [sighing], [long-paws].">,
      `Unknown speech tag [laughs], did you mean [laugh]? Unknown speech tag [sighing], did you mean [sigh]? Unknown speech tag [long-paws], did you mean [long-pause]?${Newer}`
    >
  >,
  Assert<
    Equals<
      SpeechText<"They said [they] would bring [them] to [the] show.">,
      "They said [they] would bring [them] to [the] show."
    >
  >,
  Assert<Equals<SpeechText<"He said it was fine [sic].">, "He said it was fine [sic].">>,
  Assert<Equals<SpeechText<"Then the [music] started.">, "Then the [music] started.">>,
  Assert<
    Equals<SpeechText<"<lower>Listen.</lower>">, `Unknown speech tag <lower>, did you mean <lower-pitch>?${Newer}`>
  >,
  Assert<Equals<SpeechText<"Wait [whisper] now.">, "[whisper] is a wrapping tag, use <whisper>…</whisper>.">>,
  Assert<Equals<SpeechText<"Wait <pause> now.">, "<pause> is an inline tag, use [pause].">>,
  Assert<Equals<SpeechText<"<whisper>It is a secret.">, "<whisper> is never closed.">>,
  Assert<Equals<SpeechText<"It is a secret.</whisper>">, "</whisper> has no opening tag.">>,
  Assert<Equals<SpeechText<"<slow><soft>Goodnight.</slow></soft>">, "Close <soft> before </slow>.">>,
  Assert<
    Equals<
      SpeechText<'Grok said so.<citation id="web:23"/> <b>Bold</b> </grok:render>'>,
      `<citation id="web:23"/> is not a speech tag. Unknown speech tag <b>. </grok:render> is not a speech tag.${Newer}`
    >
  >,
  Assert<
    Equals<
      SpeechText<'<whisper volume="low">Quiet.</whisper> <pause/>'>,
      '<whisper volume="low"> is not a speech tag. </whisper> has no opening tag. <pause/> is not a speech tag.'
    >
  >,
  Assert<
    Equals<
      SpeechText<"Visit <https://x.ai> or write to <support@x.ai>. If a < b and c > d, then <3.">,
      "Visit <https://x.ai> or write to <support@x.ai>. If a < b and c > d, then <3."
    >
  >,
  Assert<
    Equals<
      SpeechText<"<slow><soft>Goodnight.</soft></slow> [pause] Press [Enter] [1] [citation needed].">,
      "<slow><soft>Goodnight.</soft></slow> [pause] Press [Enter] [1] [citation needed]."
    >
  >,
  Assert<Equals<SpeechText<string>, string>>,
];

export const voiceIds = [
  { text: "Hi", language: "en", voice_id: "eve" },
  { text: "Hi", language: "en", voice_id: "nlbqfwie" },
] satisfies Array<SpeechParams>;
// @ts-expect-error KnownVoiceId only accepts built-in voices.
export const unknownBuiltInVoice: KnownVoiceId = "nlbqfwie";
// @ts-expect-error KnownTranscriptionModelId only accepts documented models.
export const unknownTranscriptionModel: KnownTranscriptionModelId = "grok-voice-transcribe-9.9";
// @ts-expect-error KnownRealtimeModelId only accepts documented models.
export const unknownRealtimeModel: KnownRealtimeModelId = "grok-voice-think-slow-1.0";

export const transcriptionExamples = [
  { file: new Blob(["audio"]) },
  { file: new File(["audio"], "call.wav"), model: "grok-voice-transcribe-1.0", keyterm: ["Grok"] },
  { url: "https://example.com/call.mp3", model: "grok-voice-transcribe-released-after-this-sdk" },
] satisfies Array<TranscriptionParams>;

// @ts-expect-error `file` and `url` are mutually exclusive.
export const conflictingTranscription: TranscriptionParams = {
  file: new Blob(["audio"]),
  url: "https://example.com/call.mp3",
};

// @ts-expect-error Either `file` or `url` is required.
export const missingAudio: TranscriptionParams = { language: "en" };

export const clearedLabels = {
  description: null,
  tone: null,
  gender: "neutral",
} satisfies CustomVoiceUpdateParams;

export const clientSecretExamples = [
  {},
  { expires_after: { seconds: 300 }, session: null },
  { session: { model: "grok-voice-think-fast-2.0", reasoning: { effort: "high" } } },
  {
    session: {
      instructions: "You are a helpful assistant.",
      turn_detection: { type: "server_vad", idle_timeout_ms: 10_000 },
    },
  },
  { session: { turn_detection: { type: null } } },
  { session: { turn_detection: null } },
] satisfies Array<ClientSecretCreateParams>;

type Session = NonNullable<ClientSecretCreateParams["session"]>;
type TurnDetection = NonNullable<Session["turn_detection"]>;

export type SessionInstructionsAreText = Assert<Equals<Session["instructions"], string | undefined>>;
export type TurnDetectionTypeAutocompletes = Assert<
  Equals<TurnDetection["type"], "server_vad" | (string & {}) | null | undefined>
>;

export const wrongInstructions: ClientSecretCreateParams = {
  // @ts-expect-error `instructions` is the system prompt text.
  session: { instructions: ["You are a helpful assistant."] },
};

export type VoiceGenderIsOptional = Assert<IsOptional<Voice, "gender">>;

export const builtInVoices = [
  { voice_id: "eve", name: "Eve", language: "en", gender: "female" },
  { voice_id: "rex", name: "Rex", language: "en", gender: "male" },
  { voice_id: "voice-added-later", name: "Later", gender: "label-added-later" },
  { voice_id: "sal", name: "Sal", gender: null },
] satisfies Array<Voice>;
