import {
  SubQuestion,
  SubQuestionGeneratorConfig,
  SubQuestionGeneratorResult,
} from '../types/generators';
import { ResearchBreadthConfig } from '../types';
import { OpenAIProvider } from '../provider/openai';
import 'dotenv/config';
import { GeminiProvider } from '../provider/gemini';
import {
  generateSubQuestionsPrompt,
  checkRelevancePrompt,
} from '../prompts/generators';

export class SubQuestionGenerator {
  private openaiInstance: OpenAIProvider;
  private geminiInstance: GeminiProvider;
  constructor() {
    // if(!process.env.OPENAI_API_KEY) {
    //   throw new Error('OPENAI_API_KEY is not set');
    // }
    this.openaiInstance = OpenAIProvider.getInstance({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
    this.geminiInstance = GeminiProvider.getInstance({
      apiKey: process.env.GEMINI_API_KEY || '',
    });
  }

  async generateSubQuestions(
    mainPrompt: string[],
    breadthConfig: ResearchBreadthConfig
  ): Promise<any> {
    const targetQuestionCount = breadthConfig.maxParallelTopics + 2;

    const { systemPrompt, userPrompt } = generateSubQuestionsPrompt({
      mainPrompt,
      targetQuestionCount,
    });

    try {
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      // const response = await this.openaiInstance.generateText(
      //   combinedPrompt,
      //   'gpt-4o'
      // );
      const response = await this.geminiInstance.generateText(
        combinedPrompt,
        'gemini-2.0-flash'
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

      questions = await this.validateResponse(questions, mainPrompt);

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

  public async checkRelevance(
    question: string,
    mainPrompt: string[]
  ): Promise<boolean> {
    const { systemPrompt, userPrompt } = checkRelevancePrompt({
      question,
      mainPrompt,
    });

    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const response = await this.geminiInstance.generateText(
      combinedPrompt,
      'gemini-1.5-flash'
    );

    // Normalize the response to handle different formats
    const normalizedResponse = response.trim().toLowerCase();

    // Check if it contains "true" anywhere in the response
    return normalizedResponse.includes('true');
  }

  private async validateResponse(
    questions: SubQuestion[],
    mainPrompt: string[]
  ): Promise<SubQuestion[]> {
    if (!Array.isArray(questions)) {
      throw new Error(
        'Invalid response format: expected an array of questions'
      );
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
        return await this.checkRelevance(q.question, mainPrompt);
      })
    );

    // Filter out irrelevant questions
    return validatedQuestions.filter(
      (_, index) =>
        relevanceChecks[index] && validatedQuestions[index].relevanceScore > 0
    );
  }
}
