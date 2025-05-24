import { LanguageModelV1 } from "@ai-sdk/provider";

export interface ReportConfig {
  maxOutputTokens?: number;
  targetOutputTokens?: number;
}

export interface ModelConfig {
  default: string | LanguageModelV1;
  reasoning: string | LanguageModelV1;
  output: string | LanguageModelV1;
}

export interface ResearchSource {
  url: string;
  title?: string;
  domain?: string;
  content?: string;
  isAcademic?: boolean;
  referenceNumber?: number;
  snippets?: string[];
}

export interface WebSearchResult {
  query: string;
  searchResults: {
    results: ResearchSource[];
  };
  context?: string;
}
