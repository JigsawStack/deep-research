import { SubQuestion } from "../types/generators";

export interface ResearchSource {
  url: string;
  content: string;
  title?: string;
  domain?: string;
  isAcademic?: boolean;
  credibilityScore?: number;
}

export interface ProcessedSearchResults {
  overview: string;
  sources: ResearchSource[];
  sourceMetrics: {
    totalSources: number;
    uniqueDomains: number;
    academicSources: number;
    averageContentLength: number;
  };
}

export interface PreparedSubQuestion {
  originalQuestion: SubQuestion;
  processedResults: ProcessedSearchResults;
  topicTags?: string[];
  confidence?: number;
}

export interface PreparedResearchData {
  timestamp: string;
  originalQuestions: string[];
  subQuestions: PreparedSubQuestion[];
  metadata: {
    totalSources: number;
    uniqueDomains: number;
    academicSourcePercentage: number;
    averageContentLength: number;
    processingDuration: number;
  };
  qualityMetrics: {
    contentDiversity: number;  // 0-1 score based on content similarity
    sourceQuality: number;     // 0-1 score based on domain reputation
    informationDensity: number; // 0-1 score based on meaningful content ratio
  };
} 