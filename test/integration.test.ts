import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { APIConnectionError, xAI } from "../src/index.js";
import { completedResponse, createBody } from "./helpers.js";

const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  servers.clear();
});

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.add(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind TCP");
  return `http://127.0.0.1:${address.port}/v1`;
}

describe("native fetch integration", () => {
  it("creates a response over a real HTTP socket", async () => {
    const baseURL = await listen((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/v1/responses");
      expect(request.headers.authorization).toBe("Bearer test-key");
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": "req_socket",
      });
      response.end(JSON.stringify(completedResponse));
    });
    const result = await new xAI({
      apiKey: "test-key",
      baseURL,
      maxRetries: 0,
    }).responses.create(createBody);
    expect(result.id).toBe("resp_123");
    expect(result.http.requestId).toBe("req_socket");
  });

  it("parses split SSE chunks over a real HTTP socket", async () => {
    const baseURL = await listen((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "x-request-id": "req_stream_socket",
      });
      response.write('data: {"type":"response.output_text.delta","delta":"O"');
      setTimeout(() => {
        response.write(',"output_index":0,"content_index":0}\n\n');
        response.end(
          `data: ${JSON.stringify({
            type: "response.completed",
            response: { ...completedResponse, id: "resp_socket" },
          })}\n\n`,
        );
      }, 5);
    });
    const stream = await new xAI({
      apiKey: "test-key",
      baseURL,
      maxRetries: 0,
    }).responses.create({ ...createBody, stream: true });
    const deltas: Array<string> = [];
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") deltas.push(event.delta);
    }
    expect(deltas).toEqual(["O"]);
    expect((await stream.done()).id).toBe("resp_socket");
    expect(stream.http.requestId).toBe("req_stream_socket");
  });

  it("does not follow a 307 redirect with credentials or prompt body", async () => {
    let reachedRedirectTarget = false;
    const baseURL = await listen((request, response) => {
      if (request.url === "/capture") {
        reachedRedirectTarget = true;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(completedResponse));
        return;
      }
      response.writeHead(307, { location: `${baseURL.replace(/\/v1$/, "")}/capture` });
      response.end();
    });
    await expect(
      new xAI({ apiKey: "test-key", baseURL, maxRetries: 0 }).responses.create(createBody),
    ).rejects.toBeInstanceOf(APIConnectionError);
    expect(reachedRedirectTarget).toBe(false);
  });
});
