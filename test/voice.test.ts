import { describe, expect, it } from "vitest";
import {
  AbortError,
  APIProtocolError,
  type ClientSecretCreateParams,
  type CustomVoiceUpdateParams,
  type SpeechParams,
  SpaceXAI,
  BinaryResponse,
} from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers.js";

const customVoice = {
  voice_id: "nlbqfwie",
  name: "Friendly Narrator",
  description: "Warm, conversational tone for narration.",
  gender: "female",
  accent: "American",
  age: "young",
  language: "en",
  use_case: "narration",
  tone: "warm",
  created_at: "2026-04-26T18:56:34.872993+00:00",
};

const transcription = {
  text: "The balance is $167,983.15.",
  language: "en",
  duration: 3.45,
  words: [
    { text: "The", start: 0.24, end: 0.48, confidence: 0.33, speaker: 0 },
    { text: "balance", start: 0.48, end: 0.96, confidence: 0.67, speaker: 0 },
  ],
};

function client(fetch: typeof globalThis.fetch): SpaceXAI {
  return new SpaceXAI({ apiKey: "test-key", fetch, maxRetries: 0 });
}

function audioResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes, {
    headers: { "content-type": contentType, "x-request-id": "req_test" },
  });
}

async function formEntries(request: Request | undefined): Promise<Array<[string, FormDataEntryValue]>> {
  return [...(await request!.formData()).entries()];
}

/** Builds a file's leading bytes from ASCII signatures and byte values. */
function bytesOf(...parts: Array<string | Array<number>>): Uint8Array {
  return new Uint8Array(
    parts.flatMap((part) => (typeof part === "string" ? Array.from(part, (char) => char.charCodeAt(0)) : part)),
  );
}

describe("voice.speak", () => {
  it("posts the params as JSON and returns the audio bytes", async () => {
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0xff]);
    const { fetch, captured } = mockFetch(() => audioResponse(mp3, "audio/mpeg"));
    const params = {
      text: "Hello! [pause] Welcome to SpaceXAI.",
      language: "en",
      voice_id: "eve",
      output_format: { codec: "mp3", sample_rate: 44100, bit_rate: 192000 },
      speed: 1.2,
      replace: { nginx: "/ˈɛndʒɪn ˈɛks/" },
    } satisfies SpeechParams;
    const speech = await client(fetch).voice.speak(params);

    const request = captured.requests[0];
    expect(captured.requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.x.ai/v1/tts");
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(request?.headers.get("accept")).toBe("*/*");
    expect(await request?.json()).toEqual(params);

    expect(speech).toBeInstanceOf(BinaryResponse);
    expect(speech.contentType).toBe("audio/mpeg");
    expect(speech.http.requestId).toBe("req_test");
    expect(new Uint8Array(await speech.arrayBuffer())).toEqual(mp3);
  });

  it("returns base64 audio with character timings when with_timestamps is true", async () => {
    const timed = {
      audio: btoa("mp3-bytes"),
      content_type: "audio/mpeg",
      duration: 0.34,
      audio_timestamps: {
        graph_chars: ["H", "i"],
        graph_times: [
          [0, 0.12],
          [0.12, 0.34],
        ],
      },
    };
    const { fetch, captured } = mockFetch(() => jsonResponse(timed));
    const speech = await client(fetch).voice.speak({
      text: "Hi",
      language: "en",
      with_timestamps: true,
    });

    expect(captured.requests[0]?.headers.get("accept")).toBe("application/json");
    expect(await captured.requests[0]?.json()).toEqual({
      text: "Hi",
      language: "en",
      with_timestamps: true,
    });
    expect(speech).toMatchObject(timed);
    expect(speech.http.requestId).toBe("req_test");
  });

  it.each([
    ["a non-object body", "not json"],
    ["a missing audio field", { content_type: "audio/mpeg", duration: 1 }],
  ])("rejects a timestamps response with %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(
      client(fetch).voice.speak({ text: "Hi", language: "en", with_timestamps: true }),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });

  it("sends tags this SDK doesn't know unchanged", async () => {
    const { fetch, captured } = mockFetch(() => audioResponse(new Uint8Array([1]), "audio/mpeg"));
    const text: string = "Hi [gasp] there. <mumble>Quietly.</mumble>";
    await client(fetch).voice.speak({ text, language: "en" });
    expect(await captured.requests[0]?.json()).toMatchObject({ text });
  });
});

describe("voice.transcribe", () => {
  it("sends options as multipart fields with the file last", async () => {
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    const { fetch, captured } = mockFetch(() => jsonResponse(transcription));
    const res = await client(fetch).voice.transcribe({
      file: new File([bytes], "call.mp3", { type: "audio/mpeg" }),
      model: "grok-voice-transcribe-2.0",
      language: "en",
      format: true,
      diarize: true,
      keyterm: ["Understand The Universe", "Grok"],
      vad_threshold: 0.3,
    });

    const request = captured.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.x.ai/v1/stt");
    expect(request?.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    const entries = await formEntries(request);
    expect(entries.slice(0, -1)).toEqual([
      ["model", "grok-voice-transcribe-2.0"],
      ["language", "en"],
      ["format", "true"],
      ["diarize", "true"],
      ["keyterm", "Understand The Universe"],
      ["keyterm", "Grok"],
      ["vad_threshold", "0.3"],
    ]);
    const [name, file] = entries.at(-1)!;
    expect(name).toBe("file");
    expect((file as File).name).toBe("call.mp3");
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(bytes);

    expect(res.text).toBe(transcription.text);
    expect(res.words).toEqual(transcription.words);
    expect(res.http.requestId).toBe("req_test");
  });

  it("names an unnamed Blob after its MIME type, so the API can tell its format", async () => {
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    const { fetch, captured } = mockFetch(() => jsonResponse(transcription));
    const c = client(fetch);
    const files = [
      new Blob([bytes], { type: "audio/mpeg" }),
      new Blob([bytes], { type: "audio/x-wav" }),
      new Blob([bytes], { type: "audio/ogg; codecs=opus" }),
      new Blob([bytes], { type: "video/x-matroska" }),
      new File([bytes], "", { type: "audio/flac" }),
      new File([bytes], "call.mp3", { type: "audio/wav" }),
      new Blob([bytes], { type: "audio/webm" }),
      new Blob([bytes], { type: "video/webm" }),
      new Blob([bytes], { type: "audio/aiff" }),
    ];
    for (const file of files) await c.voice.transcribe({ file, diarize: true });
    await c.voice.transcribe({ file: new Blob([bytes], { type: "audio/mpeg" }), audio_format: "mp3" });

    const sent: Array<[Array<string>, string]> = [];
    for (const request of captured.requests) {
      const entries = await formEntries(request);
      sent.push([entries.map(([name]) => name), (entries.at(-1)![1] as File).name]);
    }
    expect(sent).toEqual([
      [["diarize", "file"], "audio.mp3"],
      [["diarize", "file"], "audio.wav"],
      [["diarize", "file"], "audio.ogg"],
      [["diarize", "file"], "audio.mkv"],
      [["diarize", "file"], "audio.flac"],
      [["diarize", "file"], "call.mp3"],
      [["diarize", "file"], "audio.webm"],
      [["diarize", "file"], "audio.webm"],
      [["diarize", "file"], "blob"],
      [["audio_format", "file"], "blob"],
    ]);
  });

  it("names an unnamed Blob without a MIME type after the format its first bytes show", async () => {
    const wav = bytesOf("RIFF", [0x24, 0, 0, 0], "WAVEfmt ");
    // An Ogg page header up to its segment count at byte 26, then the segment table and first packet.
    const oggPage = bytesOf("OggS", [0, 2], Array.from({ length: 20 }, () => 0));
    const { fetch, captured } = mockFetch(() => jsonResponse(transcription));
    const c = client(fetch);
    const files = [
      new Blob([bytesOf("ID3", [4, 0, 0, 0, 0, 0, 0])]),
      new Blob([bytesOf([0xff, 0xfb, 0x90, 0x00])]),
      new Blob([bytesOf([0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc])]),
      new Blob([wav, new Uint8Array(100)]),
      new Blob([bytesOf("fLaC", [0, 0, 0, 0x22])]),
      new Blob([oggPage, bytesOf([1, 30, 1], "vorbis")]),
      new Blob([oggPage, bytesOf([1, 19], "OpusHead", [1, 2])]),
      new Blob([bytesOf("OggS")]),
      new Blob([bytesOf([0, 0, 0, 0x20], "ftypM4A ", [0, 0, 0, 0])]),
      new Blob([bytesOf([0, 0, 0, 0x20], "ftypM4B ", [0, 0, 0, 0])]),
      new Blob([bytesOf([0, 0, 0, 0x18], "ftypisom", [0, 0, 2, 0])]),
      new Blob([bytesOf([0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x86, 0x81, 1, 0x42, 0x82, 0x88], "matroska")]),
      new Blob([bytesOf([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0x82, 0x84], "webm")]),
      new File([wav], "", { type: "application/octet-stream" }),
      new Blob([bytesOf([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1])]),
      new Blob([bytesOf([0xff, 0xfd, 0x90, 0x00])]),
      new Blob([bytesOf("Hello")]),
      new Blob([bytesOf([0xff])]),
      new Blob([]),
      new File([wav], "call.bin"),
      new Blob([wav], { type: "audio/webm" }),
    ];
    for (const file of files) await c.voice.transcribe({ file, diarize: true });
    await c.voice.transcribe({ file: new Blob([wav]), audio_format: "wav" });

    const sent: Array<File> = [];
    for (const request of captured.requests) sent.push((await request.formData()).get("file") as File);
    expect(sent.map((file) => file.name)).toEqual([
      "audio.mp3",
      "audio.mp3",
      "audio.aac",
      "audio.wav",
      "audio.flac",
      "audio.ogg",
      "audio.opus",
      "audio.ogg",
      "audio.m4a",
      "audio.m4a",
      "audio.mp4",
      "audio.mkv",
      "audio.webm",
      "audio.wav",
      "blob",
      "blob",
      "blob",
      "blob",
      "blob",
      "call.bin",
      "audio.webm",
      "blob",
    ]);
    expect(sent[3]?.size).toBe(wav.length + 100);
  });

  it("aborts while reading the first bytes of a Blob without a MIME type", async () => {
    const ac = new AbortController();
    class HangingBlob extends Blob {
      override slice(): Blob {
        return this;
      }
      override arrayBuffer(): Promise<ArrayBuffer> {
        queueMicrotask(() => ac.abort());
        return new Promise(() => {});
      }
    }
    const { fetch, captured } = mockFetch(() => jsonResponse(transcription));
    await expect(
      client(fetch).voice.transcribe({ file: new HangingBlob(["audio"]), diarize: true }, { signal: ac.signal }),
    ).rejects.toBeInstanceOf(AbortError);
    expect(captured.requests).toHaveLength(0);
  });

  it("sends a url instead of a file and skips undefined options", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(transcription));
    await client(fetch).voice.transcribe({
      url: "https://example.com/call.mp3",
      language: undefined,
      multichannel: false,
    });

    expect(await formEntries(captured.requests[0])).toEqual([
      ["url", "https://example.com/call.mp3"],
      ["multichannel", "false"],
    ]);
  });

  it.each([
    ["a non-object body", ["The balance"]],
    ["a missing text field", { language: "en", duration: 1 }],
  ])("rejects a transcription with %s", async (_label, payload) => {
    const { fetch } = mockFetch(() => jsonResponse(payload));
    await expect(
      client(fetch).voice.transcribe({ url: "https://example.com/call.mp3" }),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });
});

describe("voice.list and voice.get", () => {
  it("lists and gets built-in voices", async () => {
    const eve = { voice_id: "eve", name: "Eve", language: "en", gender: "female" };
    const { fetch, captured } = mockFetch((req) =>
      req.url.endsWith("/tts/voices") ? jsonResponse({ voices: [eve] }) : jsonResponse(eve),
    );
    const c = client(fetch);
    const list = await c.voice.list();
    const voice = await c.voice.get("eve");
    await c.voice.get("custom/id");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/tts/voices",
      "GET https://api.x.ai/v1/tts/voices/eve",
      "GET https://api.x.ai/v1/tts/voices/custom%2Fid",
    ]);
    expect(list.voices).toEqual([eve]);
    expect(list.voices[0]?.gender).toBe("female");
    expect(list.http.requestId).toBe("req_test");
    expect(voice).toMatchObject(eve);
  });

  it("rejects malformed voice bodies", async () => {
    const missingVoices = mockFetch(() => jsonResponse({ data: [] }));
    await expect(client(missingVoices.fetch).voice.list()).rejects.toBeInstanceOf(
      APIProtocolError,
    );

    const missingId = mockFetch(() => jsonResponse({ name: "Eve" }));
    await expect(client(missingId.fetch).voice.get("eve")).rejects.toBeInstanceOf(
      APIProtocolError,
    );
  });
});

describe("voice.custom", () => {
  it("creates a voice from a multipart upload with the file last", async () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const { fetch, captured } = mockFetch(() => jsonResponse(customVoice, { status: 201 }));
    const voice = await client(fetch).voice.custom.create({
      file: new Blob([wav], { type: "audio/wav" }),
      name: "Friendly Narrator",
      language: "en",
      gender: "female",
      tone: "warm",
      use_case: "narration",
    });

    const request = captured.requests[0];
    expect(`${request?.method} ${request?.url}`).toBe("POST https://api.x.ai/v1/custom-voices");
    expect(request?.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    const entries = await formEntries(request);
    expect(entries.slice(0, -1)).toEqual([
      ["name", "Friendly Narrator"],
      ["language", "en"],
      ["gender", "female"],
      ["tone", "warm"],
      ["use_case", "narration"],
    ]);
    const [name, file] = entries.at(-1)!;
    expect(name).toBe("file");
    expect((file as File).type).toBe("audio/wav");
    expect((file as File).name).toBe("audio.wav");
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(wav);

    expect(voice).toMatchObject(customVoice);
    expect(voice.http.status).toBe(201);
  });

  it("names a clip without a MIME type after the format its first bytes show", async () => {
    const { fetch, captured } = mockFetch(() => jsonResponse(customVoice, { status: 201 }));
    await client(fetch).voice.custom.create({
      file: new Blob([bytesOf("RIFF", [0x24, 0, 0, 0], "WAVEfmt ")]),
      name: "Friendly Narrator",
    });

    const [name, file] = (await formEntries(captured.requests[0])).at(-1)!;
    expect(name).toBe("file");
    expect((file as File).name).toBe("audio.wav");
  });

  it("lists voices and passes pagination query parameters", async () => {
    const page = { voices: [customVoice], pagination_token: "page_2" };
    const { fetch, captured } = mockFetch(() => jsonResponse(page));
    const c = client(fetch);
    const first = await c.voice.custom.list();
    await c.voice.custom.list({ limit: 50, pagination_token: "page_2" });

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/custom-voices",
      "GET https://api.x.ai/v1/custom-voices?limit=50&pagination_token=page_2",
    ]);
    expect(first.voices).toEqual([customVoice]);
    expect(first.pagination_token).toBe("page_2");
    expect(first.http.requestId).toBe("req_test");
  });

  it("gets, updates, and deletes a voice", async () => {
    const updated = { ...customVoice, description: null, tone: "calm" };
    const { fetch, captured } = mockFetch((req) => {
      if (req.method === "PATCH") return jsonResponse(updated);
      if (req.method === "DELETE") return jsonResponse({ deleted: true });
      return jsonResponse(customVoice);
    });
    const c = client(fetch);
    const changes = { description: null, tone: "calm" } satisfies CustomVoiceUpdateParams;
    const voice = await c.voice.custom.get("nlbqfwie");
    const patched = await c.voice.custom.update("nlbqfwie", changes);
    const deleted = await c.voice.custom.delete("nlbqfwie");

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://api.x.ai/v1/custom-voices/nlbqfwie",
      "PATCH https://api.x.ai/v1/custom-voices/nlbqfwie",
      "DELETE https://api.x.ai/v1/custom-voices/nlbqfwie",
    ]);
    expect(captured.requests[1]?.headers.get("content-type")).toBe("application/json");
    expect(await captured.requests[1]?.json()).toEqual(changes);
    expect(voice).toMatchObject(customVoice);
    expect(patched).toMatchObject(updated);
    expect(deleted.deleted).toBe(true);
    expect(deleted.http.requestId).toBe("req_test");
  });

  it("downloads the reference audio", async () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00]);
    const { fetch, captured } = mockFetch(() => audioResponse(wav, "audio/wav"));
    const audio = await client(fetch).voice.custom.getAudio("nlbqfwie");

    const request = captured.requests[0];
    expect(`${request?.method} ${request?.url}`).toBe(
      "GET https://api.x.ai/v1/custom-voices/nlbqfwie/audio",
    );
    expect(request?.headers.get("accept")).toBe("*/*");
    expect(audio).toBeInstanceOf(BinaryResponse);
    expect(audio.contentType).toBe("audio/wav");
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(wav);
  });

  it("rejects malformed custom voice bodies", async () => {
    const missingVoices = mockFetch(() => jsonResponse({ data: [customVoice] }));
    await expect(client(missingVoices.fetch).voice.custom.list()).rejects.toBeInstanceOf(
      APIProtocolError,
    );

    const missingId = mockFetch(() => jsonResponse({ name: "Friendly Narrator" }));
    await expect(
      client(missingId.fetch).voice.custom.get("nlbqfwie"),
    ).rejects.toBeInstanceOf(APIProtocolError);

    const notDeleted = mockFetch(() => jsonResponse({ deleted: false }));
    await expect(
      client(notDeleted.fetch).voice.custom.delete("nlbqfwie"),
    ).rejects.toBeInstanceOf(APIProtocolError);
  });
});

describe("voice.clientSecrets", () => {
  it("creates a client secret with and without params", async () => {
    const secret = { value: "xai-realtime-client-secret-abc123", expires_at: 1_750_000_000 };
    const { fetch, captured } = mockFetch(() => jsonResponse(secret));
    const c = client(fetch);
    const params = {
      expires_after: { seconds: 300 },
      session: {
        model: "grok-voice-latest",
        instructions: "You are a helpful assistant.",
        reasoning: { effort: "none" },
        turn_detection: { type: "server_vad", idle_timeout_ms: 10_000 },
      },
    } satisfies ClientSecretCreateParams;
    const res = await c.voice.clientSecrets.create(params);
    await c.voice.clientSecrets.create();

    expect(captured.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://api.x.ai/v1/realtime/client_secrets",
      "POST https://api.x.ai/v1/realtime/client_secrets",
    ]);
    expect(await captured.requests[0]?.json()).toEqual(params);
    expect(await captured.requests[1]?.json()).toEqual({});
    expect(res).toMatchObject(secret);
    expect(res.http.requestId).toBe("req_test");
  });

  it("rejects a response without a value", async () => {
    const { fetch } = mockFetch(() => jsonResponse({ expires_at: 1_750_000_000 }));
    await expect(client(fetch).voice.clientSecrets.create()).rejects.toBeInstanceOf(
      APIProtocolError,
    );
  });
});
