import { ModelConfig } from "../types/types";

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  default: "gpt-4.1",
  output: "gemini-2-flash",
  reasoning: "deepseek-r1",
};

export const DEFAULT_DEPTH_CONFIG = {
  maxLevel: 3,
  maxTokensPerAnalysis: 2048,
  includeReferences: true,
  confidenceThreshold: 0.9,
};

export const DEFAULT_BREADTH_CONFIG = {
  maxLevel: 2,
  maxParallelTopics: 3,
  includeRelatedTopics: true,
  minRelevanceScore: 0.7,
};

export const DEFAULT_SYNTHESIS_CONFIG = {
  maxOutputTokens: 8000,
  targetOutputLength: 5000,
};

export const DEFAULT_CONFIG = {
  models: DEFAULT_MODEL_CONFIG,
  depth: DEFAULT_DEPTH_CONFIG,
  breadth: DEFAULT_BREADTH_CONFIG,
  synthesis: DEFAULT_SYNTHESIS_CONFIG,
};
