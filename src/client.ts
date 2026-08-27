import {
  DEFAULT_BASE_URL,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BODY_BYTES,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
} from "./constants.js";
import { assertNodeVersion, isBrowser, isNode, readEnvApiKey } from "./env.js";
import { ModelsResource } from "./resources/models.js";
import { Responses } from "./resources/responses.js";
import type { ClientOptions, RequestHook, ResponseHook } from "./types.js";

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

export class xAI {
  readonly baseURL: string;
  readonly timeout: number;
  readonly idleTimeout: number;
  readonly maxResponseBodyBytes: number;
  /** Retry count (jitter + Retry-After). Creates retry only explicit 429 responses. */
  readonly maxRetries: number;
  readonly defaultHeaders: Record<string, string>;
  readonly fetch: typeof fetch;
  readonly onRequest?: RequestHook;
  readonly onResponse?: ResponseHook;
  readonly responses: Responses;
  readonly models: ModelsResource;

  #apiKey: string;

  constructor(opts: ClientOptions = {}) {
    assertNodeVersion();
    if (isBrowser() && !opts.dangerouslyAllowBrowser) {
      throw new Error(
        "xAI: browser and worker use is disabled because it can expose secret API credentials; " +
          "set dangerouslyAllowBrowser: true only if you understand the risk",
      );
    }
    const apiKey = opts.apiKey ?? readEnvApiKey();
    if (!apiKey) {
      throw new Error(
        isNode()
          ? "xAI: apiKey is missing (set XAI_API_KEY or pass apiKey)"
          : "xAI: pass apiKey from a server; do not use a secret API key in browsers or Workers",
      );
    }
    this.#apiKey = apiKey;
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
    this.idleTimeout = opts.idleTimeout ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.maxResponseBodyBytes =
      opts.maxResponseBodyBytes ?? DEFAULT_MAX_RESPONSE_BODY_BYTES;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.defaultHeaders = { ...opts.defaultHeaders };
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.onRequest = opts.onRequest;
    this.onResponse = opts.onResponse;
    this.responses = new Responses(this);
    this.models = new ModelsResource(this);
  }

  get apiKey(): string {
    return this.#apiKey;
  }

  [INSPECT](): object {
    return {
      baseURL: this.baseURL,
      timeout: this.timeout,
      idleTimeout: this.idleTimeout,
      maxResponseBodyBytes: this.maxResponseBodyBytes,
      maxRetries: this.maxRetries,
    };
  }
}
