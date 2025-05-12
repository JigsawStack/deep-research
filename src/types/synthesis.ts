import { WebSearchResult } from '.';

export interface SynthesisInput {
  mainPrompt: string[];
  results: WebSearchResult[];
  currentDepth: number;
  parentSynthesis?: SynthesisOutput;
}

export interface SynthesisOutput {
  summary: string;
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

export interface SynthesisResult {
  depthSynthesis: Map<number, SynthesisOutput[]>;
  finalSynthesis: SynthesisOutput;
}
