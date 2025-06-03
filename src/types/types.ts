import { LanguageModelV1 } from "@ai-sdk/provider";
export interface ModelConfig {
  default: LanguageModelV1;
  reasoning: LanguageModelV1;
  output: LanguageModelV1;
}

export interface ResearchSource {
  url: string;
  title?: string;
  content?: string;
  reference_number?: number;
  snippets?: string[];
  is_safe?: boolean;
}
export interface WebSearchResult {
  query: string;
  searchResults: {
    results: ResearchSource[];
  };
  context?: string;
  image_urls?: string[];
  links?: string[];
  geo_results?: any;
}

export interface DeepResearchConfig {
  models?: ModelConfig;
  maxBreadth: number;
  maxDepth: number;
  maxOutputTokens: number;
  targetOutputTokens?: number;
  logging: {
    enabled: boolean;
  };
  JIGSAW_API_KEY?: string;
  OPENAI_API_KEY?: string;
  DEEPINFRA_API_KEY?: string;

  webSearch?: (query: string) => Promise<WebSearchResult>;
}

export type DeepResearchParams = Partial<DeepResearchConfig>;
