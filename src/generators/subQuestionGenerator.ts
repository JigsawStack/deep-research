import { SubQuestion } from '../types/generators';
import { ResearchBreadthConfig } from '../types';
import 'dotenv/config';

import {
  generateSubQuestionsPrompt,
  checkRelevancePrompt,
} from '../prompts/generators';
import { AIProvider } from '../provider/aiProvider';

/**
 * Checks if a question is relevant to the main research topic
 */
export async function checkRelevance(
  question: string,
  mainPrompt: string[],
  model: string,
  provider: AIProvider
): Promise<boolean> {
  const { systemPrompt, userPrompt } = checkRelevancePrompt({
    question,
    mainPrompt,
  });

  const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

  const response = await provider.generateText(combinedPrompt, model);

  // Normalize the response to handle different formats
  const normalizedResponse = response.trim().toLowerCase();

  // Check if it contains "true" anywhere in the response
  return normalizedResponse.includes('true');
}

/**
 * Validates the generated questions for relevance and proper format
 */
async function validateResponse(
  questions: SubQuestion[],
  mainPrompt: string[],
  model: string,
  provider: AIProvider
): Promise<SubQuestion[]> {
  if (!Array.isArray(questions)) {
    throw new Error('Invalid response format: expected an array of questions');
  }

  const validatedQuestions = [...questions]; // Create a copy to avoid modifying during iteration

  // Using Promise.all for proper handling of asynchronous operations
  const relevanceChecks = await Promise.all(
    validatedQuestions.map(async (q) => {
      if (!q.question || typeof q.relevanceScore !== 'number') {
        q.relevanceScore = 0;
        return false;
      }
      if (q.relevanceScore < 0 || q.relevanceScore > 1) {
        q.relevanceScore = 0;
        return false;
      }

      // Check if the question is relevant to the main research topic
      return await checkRelevance(q.question, mainPrompt, model, provider);
    })
  );

  // Filter out irrelevant questions
  return validatedQuestions.filter(
    (_, index) =>
      relevanceChecks[index] && validatedQuestions[index].relevanceScore > 0
  );
}

/**
 * Generates sub-questions for a main research topic
 */

export interface GenerateSubQuestionsOptions {
  mainPrompt: string[];
  breadthConfig: ResearchBreadthConfig;
  provider: AIProvider;
  generationModel?: string;
  relevanceCheckModel?: string;
}

export async function generateSubQuestions({
  mainPrompt,
  breadthConfig,
  provider,
  generationModel = 'gemini-2.0-flash',
  relevanceCheckModel = 'gpt-4o',
}: GenerateSubQuestionsOptions): Promise<any> {
  if (!mainPrompt || mainPrompt.length === 0) {
    throw new Error('Prompts must be set before generating sub-questions');
  }

  const targetQuestionCount = breadthConfig.maxParallelTopics + 2;

  const { systemPrompt, userPrompt } = generateSubQuestionsPrompt({
    mainPrompt,
    targetQuestionCount,
  });

  try {
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const response = await provider.generateText(
      combinedPrompt,
      generationModel
    );

    let parsedQuestions;
    try {
      parsedQuestions = JSON.parse(response);
    } catch (parseError) {
      throw new Error(`Failed to parse response as JSON: ${parseError}`);
    }

    // pick the questions equal to the breadthConfig.maxParallelTopics
    let questions: SubQuestion[] = parsedQuestions.slice(
      0,
      breadthConfig.maxParallelTopics
    );

    questions = await validateResponse(
      questions,
      mainPrompt,
      relevanceCheckModel,
      provider
    );

    return {
      questions,
      metadata: {
        totalGenerated: questions.length,
        averageRelevanceScore:
          questions.reduce((acc, q) => acc + q.relevanceScore, 0) /
          questions.length,
        generationTimestamp: new Date().toISOString(),
      },
    };
  } catch (error: unknown) {
    throw new Error(
      `Failed to generate sub-questions: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
