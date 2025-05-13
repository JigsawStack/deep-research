import { WebSearchResult } from '.';

export interface FinalSynthesisInput {
  mainPrompt: string[];
  allSyntheses: SynthesisOutput[];
  maxOutputTokens?: number;
  targetOutputLength: 'concise' | 'standard' | 'detailed' | number;
}
export interface SynthesisInput {
  mainPrompt: string[];
  results: WebSearchResult[];
  currentDepth: number;
  parentSynthesis?: SynthesisOutput;
}

export interface SynthesisOutput {
  analysis: string;
  keyThemes: string[];
  insights: string[];
  knowledgeGaps: string[];
  conflictingInformation?: {
    topic: string;
    conflicts: {
      claim1: string;
      claim2: string;
      resolution?: string;
    }[];
  }[];
  confidence: number;
  depth: number;
  relatedQuestions: string[];
}

export interface SynthesisConfig {
  maxOutputTokens: number;
  targetOutputLength: FinalSynthesisInput['targetOutputLength'];
  includeAllSources: boolean;
  formatAsMarkdown: boolean;
}

export interface SynthesisResult {
  depthSynthesis: Map<number, SynthesisOutput[]>;
  finalSynthesis: SynthesisOutput;
}
