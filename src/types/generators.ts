export interface SubQuestion {
  id: string;
  question: string;
  relevanceScore: number;
  parentTopicId?: string;
}

export interface SubQuestionGeneratorResult {
  questions: SubQuestion[];
  metadata: {
    totalGenerated: number;
    averageRelevanceScore: number;
    generationTimestamp: string;
  };
}
