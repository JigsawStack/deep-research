import GeminiProvider from '../provider/gemini';
import { WebSearchResult } from '../types';
import 'dotenv/config';
import { cleanJsonResponse } from '../utils/utils';
import { generateFollowupPrompts } from '../prompts/generators';

export class FollowupQuestionGenerator {
  // private openaiInstance: OpenAIProvider;
  private geminiInstance: GeminiProvider;

  constructor() {
    // this.openaiInstance = OpenAIProvider.getInstance({
    //   apiKey: process.env.OPENAI_API_KEY || '',
    // });

    this.geminiInstance = GeminiProvider.getInstance({
      apiKey: process.env.GEMINI_API_KEY || '',
    });
  }

  async generateFollowupQuestions(
    mainPrompt: string[],
    searchResult: WebSearchResult,
    maxQuestions: number = 2
  ): Promise<string[]> {
    const { systemPrompt, userPrompt } = generateFollowupPrompts({
      maxQuestions,
      searchResult,
      mainPrompt,
    });

    try {
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

      // Try up to 3 times to get a valid response
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          const response = await this.geminiInstance.generateText(
            combinedPrompt,
            'gemini-2.0-flash'
          );

          // Clean the response to handle markdown-formatted JSON
          const cleanedResponse = cleanJsonResponse(response);

          // Try to parse the JSON
          const parsedQuestions = JSON.parse(cleanedResponse);

          // Validate the response format
          if (Array.isArray(parsedQuestions) && parsedQuestions.length > 0) {
            // Return only the requested number of questions
            return parsedQuestions.slice(0, maxQuestions);
          } else {
            console.warn(
              `Attempt ${attempts}: Response is not a valid array or is empty`
            );
            if (attempts >= maxAttempts) {
              // If we've reached max attempts, return default questions
              return this.generateDefaultQuestions(
                searchResult.question.question,
                maxQuestions
              );
            }
          }
        } catch (parseError) {
          console.warn(
            `Attempt ${attempts}: Failed to parse response: ${parseError}`
          );
          if (attempts >= maxAttempts) {
            // If we've reached max attempts, return default questions
            return this.generateDefaultQuestions(
              searchResult.question.question,
              maxQuestions
            );
          }
        }
      }

      // Fallback if all attempts fail
      return this.generateDefaultQuestions(
        searchResult.question.question,
        maxQuestions
      );
    } catch (error) {
      console.error('Error generating follow-up questions:', error);
      return this.generateDefaultQuestions(
        searchResult.question.question,
        maxQuestions
      );
    }
  }

  // Generate default follow-up questions as a fallback
  private generateDefaultQuestions(
    originalQuestion: string,
    count: number
  ): string[] {
    const defaultQuestions = [
      `What are the limitations or challenges related to ${originalQuestion}?`,
      `How might future developments impact ${originalQuestion}?`,
      `What are the ethical considerations surrounding ${originalQuestion}?`,
      `How does ${originalQuestion} vary across different contexts or regions?`,
    ];

    return defaultQuestions.slice(0, count);
  }
}
