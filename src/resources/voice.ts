import { send, type SendResult } from "../http.js";
import { APIProtocolError, requestIds } from "../errors.js";
import { BinaryResponse } from "../binary.js";
import { tokenPages, type PagePromise } from "../pagination.js";
import { requireRecord } from "./shared.js";
import type {
  ClientSecret,
  ClientSecretCreateParams,
  CustomVoice,
  CustomVoiceCreateParams,
  CustomVoiceList,
  CustomVoiceUpdateParams,
  HttpMeta,
  RequestOpts,
  SpeechParams,
  SpeechWithTimestamps,
  Transcription,
  TranscriptionParams,
  Voice,
  VoiceList,
} from "../types.js";
import type { VoiceId } from "../generated/voice.js";
import type { SpaceXAI } from "../client.js";

const AUDIO_FORMATS = new Set<string>([
  "pcm",
  "mulaw",
  "alaw",
  "wav",
  "mp3",
  "ogg",
  "opus",
  "flac",
  "aac",
  "mp4",
  "m4a",
  "mkv",
] satisfies Array<NonNullable<TranscriptionParams["audio_format"]>>);
/** MIME subtypes, without an `x-` prefix, whose format has another name. */
const SUBTYPE_FORMATS = new Map([
  ["mpeg", "mp3"],
  ["wave", "wav"],
  ["matroska", "mkv"],
]);

/**
 * The API can read the audio format from the file name, which FormData sets to `blob` for a `Blob`
 * without one. For such a Blob, returns a name such as `audio.mp3` from its MIME type, unless
 * `audio_format` is set.
 */
function audioFileName(file: Blob, audioFormat: unknown): string | undefined {
  if (audioFormat !== undefined || (file instanceof File && file.name)) return undefined;
  const essence = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  const subtype = essence.split("/")[1]?.replace(/^x-/, "") ?? "";
  const format = SUBTYPE_FORMATS.get(subtype) ?? subtype;
  return AUDIO_FORMATS.has(format) ? `audio.${format}` : undefined;
}

/** Fields sent after `file` may be ignored, so `file` is appended last. */
function toFormData({ file, ...fields }: { file?: Blob } & Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) form.append(name, String(item));
    }
  }
  if (file) {
    const filename = audioFileName(file, fields.audio_format);
    if (filename === undefined) form.append("file", file);
    else form.append("file", file, filename);
  }
  return form;
}

function toCustomVoice(result: SendResult): CustomVoice & { http: HttpMeta } {
  const body = requireRecord(result.payload, result.http, "Custom voice");
  if (typeof body.voice_id !== "string") {
    throw new APIProtocolError("Custom voice response is missing voice_id", {
      ...requestIds(result.http),
      body,
    });
  }
  return { ...(body as CustomVoice), http: result.http };
}

export class VoiceResource {
  readonly custom: CustomVoices;
  readonly clientSecrets: ClientSecrets;

  constructor(private readonly client: SpaceXAI) {
    this.custom = new CustomVoices(client);
    this.clientSecrets = new ClientSecrets(client);
  }

  speak<T extends string, Timestamps extends boolean | undefined = undefined>(
    body: SpeechParams<T> & { with_timestamps?: Timestamps },
    opts?: RequestOpts,
  ): Promise<Timestamps extends true ? SpeechWithTimestamps & { http: HttpMeta } : BinaryResponse>;
  async speak(
    body: SpeechParams,
    opts?: RequestOpts,
  ): Promise<BinaryResponse | (SpeechWithTimestamps & { http: HttpMeta })> {
    const binary = body.with_timestamps !== true;
    const result = await send(this.client, {
      method: "POST",
      path: "/tts",
      body,
      binary,
      opts,
    });
    if (binary) return new BinaryResponse(result.body, result.http);
    const speech = requireRecord(result.payload, result.http, "Speech response");
    if (typeof speech.audio !== "string") {
      throw new APIProtocolError("Speech response is missing audio", {
        ...requestIds(result.http),
        body: speech,
      });
    }
    return { ...(speech as SpeechWithTimestamps), http: result.http };
  }

  async transcribe(
    body: TranscriptionParams,
    opts?: RequestOpts,
  ): Promise<Transcription & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: "/stt",
      body: toFormData(body),
      opts,
    });
    const transcription = requireRecord(result.payload, result.http, "Transcription");
    if (typeof transcription.text !== "string") {
      throw new APIProtocolError("Transcription is missing text", {
        ...requestIds(result.http),
        body: transcription,
      });
    }
    return { ...(transcription as Transcription), http: result.http };
  }

  /** Built-in voices. Custom voices are listed by `custom.list()`. */
  async list(opts?: RequestOpts): Promise<VoiceList & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: "/tts/voices",
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Voice list");
    if (!Array.isArray(body.voices)) {
      throw new APIProtocolError("Voice list is missing voices", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as VoiceList), http: result.http };
  }

  async get(voiceId: VoiceId, opts?: RequestOpts): Promise<Voice & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/tts/voices/${encodeURIComponent(voiceId)}`,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Voice");
    if (typeof body.voice_id !== "string") {
      throw new APIProtocolError("Voice response is missing voice_id", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as Voice), http: result.http };
  }
}

export class CustomVoices {
  constructor(private readonly client: SpaceXAI) {}

  async create(
    body: CustomVoiceCreateParams,
    opts?: RequestOpts,
  ): Promise<CustomVoice & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: "/custom-voices",
      body: toFormData(body),
      opts,
    });
    return toCustomVoice(result);
  }

  list(
    query: { limit?: number; pagination_token?: string } = {},
    opts?: RequestOpts,
  ): PagePromise<CustomVoiceList & { http: HttpMeta }, CustomVoice> {
    return tokenPages(
      query,
      async (pageQuery) => {
        const result = await send(this.client, {
          method: "GET",
          path: "/custom-voices",
          query: pageQuery,
          opts,
        });
        const body = requireRecord(result.payload, result.http, "Custom voice list");
        if (!Array.isArray(body.voices)) {
          throw new APIProtocolError("Custom voice list is missing voices", {
            ...requestIds(result.http),
            body,
          });
        }
        return { ...(body as CustomVoiceList), http: result.http };
      },
      (page) => page.voices,
    );
  }

  async get(voiceId: string, opts?: RequestOpts): Promise<CustomVoice & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "GET",
      path: `/custom-voices/${encodeURIComponent(voiceId)}`,
      opts,
    });
    return toCustomVoice(result);
  }

  async update(
    voiceId: string,
    body: CustomVoiceUpdateParams,
    opts?: RequestOpts,
  ): Promise<CustomVoice & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "PATCH",
      path: `/custom-voices/${encodeURIComponent(voiceId)}`,
      body,
      opts,
    });
    return toCustomVoice(result);
  }

  async delete(voiceId: string, opts?: RequestOpts): Promise<{ deleted: true; http: HttpMeta }> {
    const result = await send(this.client, {
      method: "DELETE",
      path: `/custom-voices/${encodeURIComponent(voiceId)}`,
      opts,
    });
    const body = requireRecord(result.payload, result.http, "Custom voice delete response");
    if (body.deleted !== true) {
      throw new APIProtocolError("Custom voice delete response is missing deleted=true", {
        ...requestIds(result.http),
        body,
      });
    }
    return { ...(body as { deleted: true }), http: result.http };
  }

  async getAudio(voiceId: string, opts?: RequestOpts): Promise<BinaryResponse> {
    const result = await send(this.client, {
      method: "GET",
      path: `/custom-voices/${encodeURIComponent(voiceId)}/audio`,
      binary: true,
      opts,
    });
    return new BinaryResponse(result.body, result.http);
  }
}

export class ClientSecrets {
  constructor(private readonly client: SpaceXAI) {}

  async create(
    body: ClientSecretCreateParams = {},
    opts?: RequestOpts,
  ): Promise<ClientSecret & { http: HttpMeta }> {
    const result = await send(this.client, {
      method: "POST",
      path: "/realtime/client_secrets",
      body,
      opts,
    });
    const secret = requireRecord(result.payload, result.http, "Client secret");
    if (typeof secret.value !== "string") {
      throw new APIProtocolError("Client secret response is missing value", {
        ...requestIds(result.http),
        body: secret,
      });
    }
    return { ...(secret as ClientSecret), http: result.http };
  }
}
