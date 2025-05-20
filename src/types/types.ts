import { LanguageModelV1 } from "@ai-sdk/provider";

export interface ResearchBreadthConfig {
  maxParallelTopics: number;
  maxSearchResults: number;
  minRelevanceScore: number;
}

export interface RecursiveResearchResult {
  isComplete: boolean;
  synthesis: string;
  reason?: "max_depth_reached" | "sufficient_info" | "research_complete";
}

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

export interface ModelConfig {
  default?: string | LanguageModelV1;
  quick?: string | LanguageModelV1;
  reasoning?: string | LanguageModelV1;
  output?: string | LanguageModelV1;
  [key: string]: string | LanguageModelV1 | undefined;
}

export interface ResearchSource {
  url: string;
  title?: string;
  domain?: string;
  isAcademic?: boolean;
  referenceNumber?: number;
}

export interface WebSearchResult {
  question: string;
  searchResults: {
    ai_overview: string;
    results: ResearchSource[];
  };
}

// Recursive search context to track states between recursion levels
export interface RecursiveSearchContext {
  mainQuestion: string[];
  parentQuestions: string[];
  currentDepth: number;
  searchPath: string[];
  previousResults: WebSearchResult[];
  exploredQuestions: Set<string>;
}

