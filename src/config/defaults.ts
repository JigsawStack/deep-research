import { deepinfra } from "@ai-sdk/deepinfra";
import { openai } from "@ai-sdk/openai";
import { LanguageModelV1 } from "ai";

export interface ModelConfig {
  default?: string | LanguageModelV1;
  quick?: string | LanguageModelV1;
  reasoning?: string | LanguageModelV1;
  output?: string | LanguageModelV1;
  [key: string]: string | LanguageModelV1 | undefined;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  default: openai.languageModel("gpt-4.1"),
  output: openai.languageModel("gpt-4.1"),
  // output: "gemini-2-flash",
  // reasoning: "deepseek-r1",
  reasoning: deepinfra.languageModel("deepseek-ai/DeepSeek-R1"),
  // reasoning: "o4-mini",
};

export const DEFAULT_DEPTH_CONFIG = {
  maxLevel: 3,
};

export const DEFAULT_BREADTH_CONFIG = {
  maxParallelTopics: 3,
};

interface ReportConfig {
  maxOutputTokens?: number;
  targetOutputTokens?: number;
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  maxOutputTokens: 32000,
};

export const DEFAULT_CONFIG = {
  models: DEFAULT_MODEL_CONFIG,
  depth: DEFAULT_DEPTH_CONFIG,
  breadth: DEFAULT_BREADTH_CONFIG,
  report: DEFAULT_REPORT_CONFIG,
  JIGSAW_API_KEY: "",
  OPENAI_API_KEY: "",
  GEMINI_API_KEY: "",
  DEEPINFRA_API_KEY: "",
};
