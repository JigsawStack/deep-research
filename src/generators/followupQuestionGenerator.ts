import { OpenAIProvider } from '../provider/openai';
import GeminiProvider from '../provider/gemini';
import { WebSearchResult } from '../types';
import 'dotenv/config';
import { cleanJsonResponse } from '../utils/utils';

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
    const systemPrompt = `You are an expert research assistant specializing in generating highly relevant follow-up questions. Review the information provided and generate specific follow-up questions that would deepen understanding of the main topic.

Your task is to:
1. Generate exactly ${maxQuestions} follow-up questions that build on the information provided
2. Ensure each question:
   - Explores an important aspect that needs more information
   - Is specific and answerable through web search
   - Helps deepen understanding of the main research topic
   - Focuses on filling knowledge gaps

IMPORTANT: Return ONLY a JSON array of strings with your questions. Format your response as a valid JSON array with no additional text, markdown formatting, or explanation.
Example: ["What are the environmental impacts of large language models?", "How do quantum computing advancements affect cryptography?"]`;

    const content =
      searchResult.searchResults.ai_overview ||
      searchResult.searchResults.results.map((r) => r.content).join('\n\n');

    const userPrompt = `Main Research Topic(s):
${mainPrompt.join('\n')}

Question that was researched:
${searchResult.question.question}

Information found so far:
${content}

Based on this information, what are ${maxQuestions} important follow-up questions that would help fill knowledge gaps?`;

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
