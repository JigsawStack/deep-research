import { ModelConfig, ResearchBreadthConfig, ResearchDepthConfig } from '../types';

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  default: 'gpt-4.1',
  quick: 'gemini-2-flash',
  reasoning: 'deepseek-r1'
};

export const DEFAULT_DEPTH_CONFIG: ResearchDepthConfig = {
  level: 3,
  maxTokensPerAnalysis: 2048,
  includeReferences: true,
  confidenceThreshold: 0.85
};

export const DEFAULT_BREADTH_CONFIG: ResearchBreadthConfig = {
  level: 2,
  maxParallelTopics: 3,
  includeRelatedTopics: true,
  minRelevanceScore: 0.7
};

export const DEFAULT_FORMAT = 'json';

export const DEFAULT_CONFIG = {
  models: DEFAULT_MODEL_CONFIG,
  depth: DEFAULT_DEPTH_CONFIG,
  breadth: DEFAULT_BREADTH_CONFIG,
  format: DEFAULT_FORMAT
} as const; 