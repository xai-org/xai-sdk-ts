import { APIProtocolError, requestIds } from "./errors.js";
import { parseJsonOutput, toInput, toText } from "./porcelain.js";
import { mapUsage, type Usage } from "./usage.js";
import type { components } from "./generated/types.js";
import type {
  HttpMeta,
  IncompleteDetails,
  InputItem,
  OutputItem,
  StandardSchema,
  StandardSchemaIssue,
} from "./types.js";

const SKIP_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const OWN_KEYS = new Set(["id", "status", "output", "incomplete_details", "usage", "http", "raw"]);

/** The API may omit any of these, so they're all optional. */
type ResponseFields = Partial<
  Omit<components["schemas"]["ModelResponse"], "id" | "status" | "output" | "incomplete_details" | "usage">
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatIssue(issue: StandardSchemaIssue): string {
  const path = issue.path?.map((segment) => String(typeof segment === "object" ? segment.key : segment)).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function validateJson<Output>(schema: StandardSchema<Output>, value: unknown): Output {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new TypeError("toJson() needs a schema that validates synchronously");
  }
  if (result.issues) {
    throw new Error(`Structured output doesn't match the schema: ${result.issues.map(formatIssue).join("; ")}`, {
      cause: result.issues,
    });
  }
  return result.value;
}

function copyWireFields(target: ModelResponse, wire: Record<string, unknown>): void {
  const proto = Object.getPrototypeOf(target) as object;
  for (const [key, value] of Object.entries(wire)) {
    if (SKIP_KEYS.has(key) || OWN_KEYS.has(key) || key in proto) continue;
    (target as unknown as Record<string, unknown>)[key] = value;
  }
}

// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- every merged field is optional and copied from the API response
export interface ModelResponse extends ResponseFields {}

export class ModelResponse {
  id: string;
  status: string;
  output: Array<OutputItem>;
  incomplete_details: IncompleteDetails | null;
  usage: Usage;
  http: HttpMeta;
  /** The response object as the API sent it, including fields this SDK doesn't know yet. */
  readonly raw: Readonly<Record<string, unknown>>;

  constructor(payload: unknown, http: HttpMeta) {
    if (!isRecord(payload)) {
      throw new APIProtocolError("Response body must be a JSON object", {
        ...requestIds(http),
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
        ...requestIds(http),
        body: wire,
      });
    }
    this.id = typeof wire.id === "string" ? wire.id : "";
    this.status = typeof wire.status === "string" ? wire.status : "in_progress";
    this.output = Array.isArray(wire.output) ? (wire.output as Array<OutputItem>) : [];
    this.incomplete_details = (wire.incomplete_details as IncompleteDetails | null) ?? null;
    this.usage = mapUsage(wire.usage);
    this.http = http;
    this.raw = wire;
    copyWireFields(this, wire);
  }

  get parsed(): unknown | null {
    return parseJsonOutput(this.output, this.status, false);
  }

  toText(): string {
    return toText(this.output);
  }

  toInput(): Array<InputItem> {
    return toInput(this.output);
  }

  /**
   * Parses the completed text output as JSON. Pass a Standard Schema validator that validates synchronously,
   * such as a Zod, Valibot, or ArkType schema, to check the result and get its type; without one, the result
   * is `unknown`.
   */
  toJson(): unknown;
  toJson<Output>(schema: StandardSchema<Output>): Output;
  toJson(schema?: StandardSchema): unknown {
    const value = parseJsonOutput(this.output, this.status, true);
    return schema === undefined ? value : validateJson(schema, value);
  }
}
