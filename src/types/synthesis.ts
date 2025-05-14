import { WebSearchResult } from '.';

// Base interface for common synthesis properties
export interface BaseSynthesisInput {
  mainPrompt: string[];
}

// Interface for synthesizing search results
export interface SynthesisInput extends BaseSynthesisInput {
  results: WebSearchResult[];
  currentDepth: number;
  parentSynthesis?: SynthesisOutput;
}

// Interface for generating the final research report
export interface ReportInput extends BaseSynthesisInput {
  allSyntheses: SynthesisOutput[];
}

// Common output format for both synthesis and report
export interface SynthesisOutput {
  analysis: string;
  keyThemes: string[];
  insights: string[];
  knowledgeGaps: string[];
  conflictingInformation?: Array<{
    topic: string;
    conflicts: Array<{
      claim1: string;
      claim2: string;
      resolution?: string;
    }>;
  }>;
  confidence: number;
  depth: number;
  relatedQuestions: string[];
  sources?: Array<{
    index: number;
    url: string;
    title: string;
    domain: string;
  }>;
}

// Configuration for report generation
export interface ReportConfig {
  maxOutputTokens?: number;
  targetOutputLength: 'concise' | 'standard' | 'detailed' | number;
  formatAsMarkdown: boolean;
}

export interface ReportOutput {
  analysis: string;
  keyThemes: string[];
  insights: string[];
  knowledgeGaps: string[];
  sources: Array<{
    index: number;
    url: string;
    title?: string;
    domain?: string;
  }>;
  citationMapping?: Record<string, string>;
}

// Overall synthesis result including all depth levels and final report
export interface SynthesisResult {
  depthSynthesis: Map<number, SynthesisOutput[]>;
  finalReport: ReportOutput;
}
