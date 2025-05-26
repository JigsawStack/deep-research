import { ModelConfig, ReportConfig } from "@/types/types";
import { deepinfra } from "@ai-sdk/deepinfra";
import { openai } from "@ai-sdk/openai";
import { LanguageModelV1 } from "ai";


export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  default: openai.languageModel("gpt-4.1"),
  output: openai.languageModel("gpt-4.1"),
  reasoning: deepinfra.languageModel("deepseek-ai/DeepSeek-R1"),
};

export const DEFAULT_DEPTH_CONFIG = {
  maxDepth: 3,
};

export const DEFAULT_BREADTH_CONFIG = {
  maxBreadth: 3,
};


export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  maxOutputTokens: 32000,
};

// **TODO** 
// separate types
  // parameter types 
  // config types 
export interface DeepResearchConfig {
  models: ModelConfig;
  depth: {
    maxDepth: number;
  };
  breadth: {
    maxBreadth: number;
  };
  report: ReportConfig;
  logging: {
    enabled: boolean;
  };
  JIGSAW_API_KEY: string;
  OPENAI_API_KEY: string;
  GEMINI_API_KEY: string;
  DEEPINFRA_API_KEY: string;
}

export const DEFAULT_CONFIG = {
  models: DEFAULT_MODEL_CONFIG,
  depth: DEFAULT_DEPTH_CONFIG,
  breadth: DEFAULT_BREADTH_CONFIG,
  report: DEFAULT_REPORT_CONFIG,
  logging: {
    enabled: false,
  },
};
