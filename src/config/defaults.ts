import { ModelConfig } from "../types/types";

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  default: "gpt-4.1",
  output: "gemini-2-flash",
  reasoning: "deepseek-r1",
};

export const DEFAULT_DEPTH_CONFIG = {
  maxLevel: 3,
};

export const DEFAULT_BREADTH_CONFIG = {
  maxParallelTopics: 3,
};

export const DEFAULT_REPORT_CONFIG = {
  targetOutputTokens: 7000,
  maxOutputTokens: 32000,
};

export const DEFAULT_CONFIG = {
  models: DEFAULT_MODEL_CONFIG,
  depth: DEFAULT_DEPTH_CONFIG,
  breadth: DEFAULT_BREADTH_CONFIG,
  report: DEFAULT_REPORT_CONFIG,
  jigsawApiKey: "",
  openaiApiKey: "",
  geminiApiKey: "",
  deepInfraApiKey: "",
};
