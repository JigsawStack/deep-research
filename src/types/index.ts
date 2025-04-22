import { SubQuestion, SubQuestionGeneratorResult } from './generators';

export interface ResearchProvider {
  analyze(text: string): Promise<ResearchResult>;
  summarize(text: string): Promise<string>;
}

export interface ResearchResult {
  summary: string;
  keyPoints: string[];
  references?: string[];
  confidence: number;
}

export type ModelType = 'default' | 'quick' | 'reasoning';

export interface ModelConfig {
  default: string;
  quick: string;
  reasoning: string;
}

export interface ResearchDepthConfig {
  level: 1 | 2 | 3 | 4 | 5;
  maxTokensPerAnalysis: number;
  includeReferences: boolean;
  confidenceThreshold: number;
}

export interface ResearchBreadthConfig {
  level: 1 | 2 | 3 | 4 | 5;
  maxParallelTopics: number;
  includeRelatedTopics: boolean;
  minRelevanceScore: number;
}

export interface DeepResearchConfig {
  prompt: string[];
  depth?: Partial<ResearchDepthConfig>;
  breadth?: Partial<ResearchBreadthConfig>;
  format: 'json';
  models?: Partial<ModelConfig>;
}

export interface DeepResearchInstance {
  config: DeepResearchConfig;
  generateSubQuestions(): Promise<SubQuestionGeneratorResult>;
  // Will add more methods here as we develop
}

// Moving DEFAULT_MODEL_CONFIG to config/defaults.ts

export interface WebSearchResultItem {
  url: string;
  content: string;
}

export interface JigsawSearchResult {
  url: string;
  content: string;
  title?: string;
  snippet?: string;
}

export interface JigsawSearchResponse {
  ai_overview: string;
  results: JigsawSearchResult[];
}

export interface ResearchSource {
  url: string;
  content: string;
  ai_overview: string;
  title?: string;
  domain?: string;
  isAcademic?: boolean;
}

export interface CleanedSearchResult extends Omit<ResearchSource, 'domain' | 'isAcademic'> {
  domain: string;
  isAcademic: boolean;
}

export interface WebSearchResult {
  question: SubQuestion;
  searchResults: {
    ai_overview: string;
    results: CleanedSearchResult[];
  };
}
