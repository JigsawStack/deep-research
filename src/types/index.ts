import { SubQuestion } from './generators';
import { ReportConfig, SynthesisOutput } from './synthesis';
import { LanguageModelV1 } from '@ai-sdk/provider';

export interface RecursiveResearchResult {
  isComplete: boolean;
  synthesis?: SynthesisOutput;
  reason?: 'max_depth_reached' | 'sufficient_info' | 'research_complete';
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

export type ModelType = 'default' | 'quick' | 'reasoning';

export interface ModelConfig {
  default?: string | LanguageModelV1;
  quick?: string | LanguageModelV1;
  reasoning?: string | LanguageModelV1;
  output?: string | LanguageModelV1;
  [key: string]: string | LanguageModelV1 | undefined;
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
  depth?: Partial<ResearchDepthConfig>;
  breadth?: Partial<ResearchBreadthConfig>;
  models?: Partial<ModelConfig>;
  synthesis: ReportConfig;
  jigsawApiKey: string;
  openaiApiKey: string;
  geminiApiKey: string;
  deepInfraApiKey: string;
}

export interface DeepResearchInstance {
  prompts?: string[];
  config: DeepResearchConfig;
  getSynthesis(): Map<number, SynthesisOutput[]>;
  generate(prompt: string[]): Promise<DeepResearchResponse>;
}

export interface DeepResearchResponse {
  success: boolean;
  research: string;
  _usage: {
    input_tokens: number;
    output_tokens: number;
    inference_time_tokens: number;
    total_tokens: number;
  };
  sources: ResearchSource[];
}

export interface WebSearchResultItem {
  url: string;
  content: string;
}

export interface ResearchSource {
  url: string;
  content: string;
  ai_overview: string;
  title?: string;
  domain?: string;
  isAcademic?: boolean;
}

export interface CleanedSearchResult
  extends Omit<ResearchSource, 'domain' | 'isAcademic'> {
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

// Recursive search context to track states between recursion levels
export interface RecursiveSearchContext {
  mainQuestion: string[];
  parentQuestions: string[];
  currentDepth: number;
  searchPath: string[];
  previousResults: WebSearchResult[];
  exploredQuestions: Set<string>;
}

// Final deep research results with aggregated findings
export interface DeepResearchResult {
  answer: string;
  confidence: number;
  sources: {
    url: string;
    title: string;
    relevance: number;
    extractedInfo: string[];
  }[];
  citations: {
    id: string;
    text: string;
    sourceIndex: number;
  }[];
  searchPath: {
    question: string;
    depth: number;
    parent?: string;
  }[];
}
