import { DEFAULT_DEPTH_CONFIG } from '../config/defaults';
import { DEFAULT_BREADTH_CONFIG } from '../config/defaults';
import { SubQuestion } from './generators';
import { ReportConfig, SynthesisOutput } from './synthesis';
import { LanguageModelV1 } from '@ai-sdk/provider';

export interface ResearchBreadthConfig {
  maxParallelTopics: number;
  maxSearchResults: number;
  minRelevanceScore: number;
}

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

export interface ModelConfig {
  default?: string | LanguageModelV1;
  quick?: string | LanguageModelV1;
  reasoning?: string | LanguageModelV1;
  output?: string | LanguageModelV1;
  [key: string]: string | LanguageModelV1 | undefined;
}

export interface DeepResearchConfig {
  depth?: Partial<typeof DEFAULT_DEPTH_CONFIG>;
  breadth?: Partial<typeof DEFAULT_BREADTH_CONFIG>;
  models?: Partial<ModelConfig>;
  synthesis: ReportConfig;
  jigsawApiKey: string;
  openaiApiKey: string;
  geminiApiKey: string;
  deepInfraApiKey: string;
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

export interface WebSearchResult {
  question: SubQuestion;
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
