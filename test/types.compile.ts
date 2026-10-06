import type { KnownStreamEventType } from "../src/constants.js";
import type {
  CreateParams,
  FunctionToolCall,
  InputItem,
  OutputMessage,
  ReasoningItem,
  ServerToolCall,
  Tool,
  ToolCall,
  ModelResponse,
  ResponseStream,
  ResponseStreamEvent,
} from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type FunctionTool = Extract<Tool, { type: "function" }>;
type WebSearchTool = Extract<Tool, { type: "web_search" }>;
type ReasoningConfig = NonNullable<CreateParams["reasoning"]>;
type SearchParameters = NonNullable<CreateParams["search_parameters"]>;

export type ModelIsRequired = Assert<
  IsOptional<CreateParams, "model"> extends false ? true : false
>;
export type FunctionParametersAreObjects = Assert<
  FunctionTool["parameters"] extends Record<string, unknown> ? true : false
>;
export type WebSearchContextIsOptional = Assert<
  IsOptional<WebSearchTool, "search_context_size">
>;
export type ReasoningEffortIsOptional = Assert<IsOptional<ReasoningConfig, "effort">>;
export type SearchDefaultsAreOptional = Assert<
  IsOptional<SearchParameters, "max_search_results">
>;
export type FastIsAServiceTier = Assert<
  "fast" extends NonNullable<CreateParams["service_tier"]> ? true : false
>;
export type ResponsesReportTheServiceTier = Assert<
  "fast" extends NonNullable<ModelResponse["service_tier"]> ? true : false
>;
export type MessageHasLiteralType = Assert<
  OutputMessage["type"] extends "message" ? true : false
>;
export type FunctionCallHasLiteralType = Assert<
  FunctionToolCall["type"] extends "function_call" ? true : false
>;
export type ReasoningHasLiteralType = Assert<
  ReasoningItem["type"] extends "reasoning" ? true : false
>;
export type StreamEventTypesAreKnown = Assert<
  Equals<KnownStreamEventType, Exclude<ResponseStreamEvent["type"], "unknown">>
>;
export type StreamDoneResolvesToResponse = Assert<
  Equals<Awaited<ReturnType<ResponseStream["done"]>>, ModelResponse>
>;

export function responseFields(response: ModelResponse): Array<unknown> {
  // @ts-expect-error fields the SDK doesn't know aren't typed on the response
  void response.field_added_later;
  const temperature: number | null | undefined = response.temperature;
  return [temperature, response.raw.field_added_later];
}

export function listenForEvents(stream: ResponseStream): ResponseStream {
  // @ts-expect-error unknown event names are rejected
  stream.on("tool_calls", () => {});
  // @ts-expect-error event listeners receive the event, not its text
  stream.on("response.output_text.delta", (text: string) => text);
  return stream
    .on("text", (text: string) => text.length)
    .on("reasoning", (text: string) => text.length)
    .on("tool_call", (call) => describeToolCall(call))
    .on("client_tool_call", (call) => (call.type === "function_call" ? (JSON.parse(call.arguments) as unknown) : call.action))
    .on("server_tool_call", (call) => `${call.type}: ${String(call.status)}`)
    .on("image", (image) => image.result)
    .on("citation", (citation) => citation.url.length)
    .on("response.function_call_arguments.delta", (event) => event.delta.length)
    .on("response.completed", (event) => event.response.id)
    .on("error", (event) => event.error?.status);
}

export function describeServerToolCall(call: ServerToolCall): string {
  // @ts-expect-error tool-specific fields need a type check first
  void call.name;
  if (call.type === "custom_tool_call") return `${call.name} ${call.input ?? ""}`;
  if (call.type === "web_search_call") return JSON.stringify(call.action);
  return `${call.type}: ${String(call.status)}`;
}

export function describeToolCall(call: ToolCall): string {
  // @ts-expect-error function arguments need a type check first
  void call.arguments;
  if (call.type === "function_call") return `${call.name}(${call.arguments})`;
  if (call.type === "shell_call") return JSON.stringify(call.action);
  return describeServerToolCall(call);
}

export const requestExamples = [
  {
    model: "grok-4.6",
    input: "Use the server defaults.",
    reasoning: {},
  },
  {
    model: "grok-4.6",
    input: "Search within this date range.",
    search_parameters: { from_date: "2026-01-01" },
  },
  {
    model: "grok-4.7",
    input: "Answer quickly.",
    service_tier: "fast",
  },
] satisfies Array<CreateParams>;

// @ts-expect-error service_tier only accepts the documented tiers.
export const unknownServiceTier: CreateParams = { model: "grok-4.7", input: "Hi", service_tier: "turbo" };

export const toolExamples = [
  { type: "web_search" },
  {
    type: "function",
    name: "get_weather",
    parameters: { type: "object", properties: {} },
  },
  { type: "tool_released_after_this_sdk", some_option: true },
] satisfies Array<Tool>;

export const imageExample = {
  role: "user",
  content: [
    {
      type: "input_image",
      image_url: "https://example.com/image.jpg",
      detail: "high",
    },
  ],
} satisfies InputItem;
