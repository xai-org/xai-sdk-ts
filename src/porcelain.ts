import { ENCRYPTED_REASONING, SDK_STORE_DEFAULT } from "./constants.js";
import { errorFromAbort } from "./errors.js";
import type {
  CreateParams,
  FunctionToolCall,
  ImageEditParams,
  ImageGenerationCall,
  ImageInput,
  InputItem,
  OutputItem,
  OutputMessage,
  ReasoningItem,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMessage(item: unknown): item is OutputMessage {
  return isRecord(item) && item.type === "message";
}

export function isReasoning(item: unknown): item is ReasoningItem {
  return isRecord(item) && item.type === "reasoning";
}

export function isFunctionCall(item: unknown): item is FunctionToolCall {
  return isRecord(item) && item.type === "function_call";
}

export function isImageGenerationCall(item: unknown): item is ImageGenerationCall {
  return isRecord(item) && item.type === "image_generation_call";
}

export function toText(output: readonly OutputItem[]): string {
  let text = "";
  for (const item of output) {
    if (!isMessage(item) || !Array.isArray(item.content)) continue;
    let chunk = "";
    for (const part of item.content) {
      if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") {
        chunk += part.text;
      }
    }
    if (!chunk) continue;
    text += text ? `\n${chunk}` : chunk;
  }
  return text;
}

/** Echoes all output items, including reasoning, for the next turn. */
export function toInput(output: readonly OutputItem[]): InputItem[] {
  return output.map((item) => structuredClone(item) as InputItem);
}

export function parseJsonOutput(
  output: readonly OutputItem[],
  status: string,
  throwOnFail: boolean,
): unknown {
  const text = toText(output);
  if (status !== "completed") {
    if (throwOnFail) {
      throw new Error("Response is truncated; toJson() requires a completed result");
    }
    return null;
  }
  if (!text) {
    if (throwOnFail) {
      throw new Error("Response has no output_text; toJson() requires completed text output");
    }
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    if (throwOnFail) throw err;
    return null;
  }
}

function isBlobLike(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw errorFromAbort(signal, null);
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  assertNotAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(errorFromAbort(signal, null));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

/** The API rejects image data URLs that are not typed as JPEG, PNG, or WebP. */
function sniffImageType(bytes: Uint8Array): string {
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp";
  }
  return "application/octet-stream";
}

async function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  assertNotAborted(signal);
  const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), signal));
  assertNotAborted(signal);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  const mime =
    blob.type && blob.type !== "application/octet-stream" ? blob.type : sniffImageType(bytes);
  return `data:${mime};base64,${b64}`;
}

async function inlineValue(value: unknown, signal?: AbortSignal): Promise<unknown> {
  assertNotAborted(signal);
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await inlineValue(item, signal));
    return out;
  }
  if (!isRecord(value)) return value;
  if (value.type === "input_image" && isBlobLike(value.image)) {
    const image_url = await blobToDataUrl(value.image, signal);
    const next: Record<string, unknown> = { type: "input_image", image_url };
    if (value.detail !== undefined) next.detail = value.detail;
    return next;
  }
  const next: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(value)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    next[k] = await inlineValue(v, signal);
  }
  return next;
}

/**
 * Convert porcelain `image: Blob | File` parts to wire `image_url` data URLs.
 */
export async function inlineBlobs(
  input: string | InputItem[],
  signal?: AbortSignal,
): Promise<string | InputItem[]> {
  assertNotAborted(signal);
  if (typeof input === "string") return input;
  return (await inlineValue(input, signal)) as InputItem[];
}

export async function inlineImageInput(
  image: ImageInput,
  signal?: AbortSignal,
): Promise<Exclude<ImageInput, Blob>> {
  return isBlobLike(image) ? { url: await blobToDataUrl(image, signal) } : image;
}

export type ImageEditWireBody = Omit<ImageEditParams, "image" | "images"> & {
  image?: Exclude<ImageInput, Blob>;
  images?: Exclude<ImageInput, Blob>[];
};

/**
 * Convert porcelain `Blob | File` edit inputs to wire `{ url }` data URLs.
 */
export async function inlineImageInputs(
  body: ImageEditParams,
  signal?: AbortSignal,
): Promise<ImageEditWireBody> {
  assertNotAborted(signal);
  const { image, images, ...rest } = body;
  const out: ImageEditWireBody = rest;
  if (image != null) out.image = await inlineImageInput(image, signal);
  if (images != null) {
    out.images = [];
    for (const item of images) out.images.push(await inlineImageInput(item, signal));
  }
  return out;
}

/**
 * Apply SDK defaults. `store` wire default is true (30 days); SDK default is false.
 * When `store` is false, `reasoning.encrypted_content` is always included (merged
 * into a caller-supplied `include` list).
 */
export function applyCreateDefaults(body: CreateParams): Record<string, unknown> {
  const store = body.store ?? SDK_STORE_DEFAULT;
  const out: Record<string, unknown> = { ...body, store };
  if (store === false) {
    const include = Array.isArray(body.include) ? [...body.include] : [];
    if (!include.includes(ENCRYPTED_REASONING)) include.push(ENCRYPTED_REASONING);
    out.include = include;
  }
  if (body.stream === undefined) {
    out.stream = false;
  }
  return out;
}
