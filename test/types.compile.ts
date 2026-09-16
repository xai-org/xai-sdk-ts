import type {
  CreateParams,
  FunctionToolCall,
  InputItem,
  OutputMessage,
  ReasoningItem,
  Tool,
} from "../src/index.js";

type Assert<T extends true> = T;
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

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
export type MessageHasLiteralType = Assert<
  OutputMessage["type"] extends "message" ? true : false
>;
export type FunctionCallHasLiteralType = Assert<
  FunctionToolCall["type"] extends "function_call" ? true : false
>;
export type ReasoningHasLiteralType = Assert<
  ReasoningItem["type"] extends "reasoning" ? true : false
>;

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
] satisfies CreateParams[];

export const toolExamples = [
  { type: "web_search" },
  {
    type: "function",
    name: "get_weather",
    parameters: { type: "object", properties: {} },
  },
] satisfies Tool[];

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
