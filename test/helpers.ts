import type { CreateParams } from "../src/types.js";

export const usageFixture = {
  input_tokens: 32,
  output_tokens: 9,
  total_tokens: 151,
  input_tokens_details: { cached_tokens: 8 },
  output_tokens_details: { reasoning_tokens: 110 },
  num_sources_used: 0,
  num_server_side_tools_used: 0,
  cost_in_nano_usd: 1_500_000_000,
  cost_in_usd_ticks: 15_000_000_000,
};

export const completedResponse = {
  id: "resp_123",
  object: "response",
  created_at: 1_754_475_266,
  model: "grok-4.6",
  status: "completed",
  store: false,
  incomplete_details: null,
  output: [
    {
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "think" }],
      encrypted_content: "enc_abc",
      status: "completed",
    },
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Hello world", annotations: [] }],
    },
  ],
  usage: usageFixture,
};

export const jsonSchemaResponse = {
  ...completedResponse,
  id: "resp_json",
  output: [
    {
      type: "message",
      id: "msg_json",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: '{"ok":true}' }],
    },
  ],
};

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_test",
      ...init.headers,
    },
  });
}

export function sseResponse(
  events: unknown[],
  init: { status?: number; headers?: Record<string, string>; hang?: boolean } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      if (init.hang) {
        await new Promise(() => {});
        return;
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/event-stream",
      "x-request-id": "req_test",
      ...init.headers,
    },
  });
}

export function erroringSse(beforeByte: boolean): Response {
  const encoder = new TextEncoder();
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (beforeByte) {
        controller.error(new TypeError("socket hang up"));
        return;
      }
      if (!sent) {
        sent = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`));
        return;
      }
      controller.error(new TypeError("socket hang up"));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-request-id": "req_test" },
  });
}

export type Captured = { requests: Request[] };

export function mockFetch(
  handler: (req: Request, n: number) => Response | Promise<Response>,
): { fetch: typeof fetch; captured: Captured } {
  const captured: Captured = { requests: [] };
  let n = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    captured.requests.push(req);
    n += 1;
    if (req.signal.aborted) {
      throw req.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    }
    return await new Promise((resolve, reject) => {
      const onAbort = () => {
        reject(req.signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      };
      req.signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve()
        .then(() => handler(req, n))
        .then(
          (value) => {
            req.signal.removeEventListener("abort", onAbort);
            if (req.signal.aborted) onAbort();
            else resolve(value);
          },
          (err) => {
            req.signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        );
    });
  };
  return { fetch, captured };
}

export const createBody: CreateParams = {
  model: "grok-4.6",
  input: "Say hello",
};
