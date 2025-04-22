export interface SubQuestion {
  id: string;
  question: string;
  relevanceScore: number;
  parentTopicId?: string;
}

export interface SubQuestionGeneratorConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface SubQuestionGeneratorResult {
  questions: SubQuestion[];
  metadata: {
    totalGenerated: number;
    averageRelevanceScore: number;
    generationTimestamp: string;
  };
} 