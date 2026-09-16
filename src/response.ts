import { APIProtocolError } from "./errors.js";
import { parseJsonOutput, toInput, toText } from "./porcelain.js";
import { mapUsage, type Usage } from "./usage.js";
import type { HttpMeta, IncompleteDetails, InputItem, OutputItem } from "./types.js";

const SKIP_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyWireFields(target: xAIResponse, wire: Record<string, unknown>): void {
  const proto = Object.getPrototypeOf(target) as object;
  for (const [key, value] of Object.entries(wire)) {
    if (SKIP_KEYS.has(key)) continue;
    if (key === "id" || key === "status" || key === "output" || key === "incomplete_details" || key === "usage" || key === "http") {
      continue;
    }
    if (key in proto) continue;
    (target as unknown as Record<string, unknown>)[key] = value;
  }
}

export class xAIResponse {
  id: string;
  status: string;
  output: OutputItem[];
  incomplete_details: IncompleteDetails | null;
  usage: Usage;
  http: HttpMeta;
  object?: string;
  created_at?: number;
  completed_at?: number | null;
  model?: string;
  error?: unknown;
  [key: string]: unknown;

  constructor(payload: unknown, http: HttpMeta) {
    if (!isRecord(payload)) {
      throw new APIProtocolError("Response body must be a JSON object", {
        requestId: http.requestId,
        body: payload,
      });
    }
    const wire = payload;
    if (
      typeof wire.id !== "string" ||
      wire.id.length === 0 ||
      typeof wire.status !== "string" ||
      !Array.isArray(wire.output)
    ) {
      throw new APIProtocolError("Response body is missing id, status, or output", {
        requestId: http.requestId,
        body: wire,
      });
    }
    this.id = typeof wire.id === "string" ? wire.id : "";
    this.status = typeof wire.status === "string" ? wire.status : "in_progress";
    this.output = Array.isArray(wire.output) ? (wire.output as OutputItem[]) : [];
    this.incomplete_details = (wire.incomplete_details as IncompleteDetails | null) ?? null;
    this.usage = mapUsage(wire.usage);
    this.http = http;
    copyWireFields(this, wire);
  }

  get parsed(): unknown | null {
    return parseJsonOutput(this.output, this.status, false);
  }

  toText(): string {
    return toText(this.output);
  }

  toInput(): InputItem[] {
    return toInput(this.output);
  }

  toJson(): unknown {
    return parseJsonOutput(this.output, this.status, true);
  }
}
