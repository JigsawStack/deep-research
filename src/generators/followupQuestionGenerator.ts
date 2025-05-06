import { OpenAIProvider } from '../provider/openai';
import { WebSearchResult } from '../types';
import 'dotenv/config';

export class FollowupQuestionGenerator {
  private openaiInstance: OpenAIProvider;

  constructor() {
    this.openaiInstance = OpenAIProvider.getInstance({
      apiKey: process.env.OPENAI_API_KEY || '',
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

IMPORTANT: Return ONLY a JSON array of strings with your questions. Do not include any explanation, scores, or extra text.
Example format: ["What are the environmental impacts of large language models?", "How do quantum computing advancements affect cryptography?"]`;

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
      const response = await this.openaiInstance.generateText(
        combinedPrompt,
        'gpt-4o'
      );

      let parsedQuestions;
      try {
        parsedQuestions = JSON.parse(response);
        if (!Array.isArray(parsedQuestions)) {
          throw new Error('Response is not an array');
        }
      } catch (parseError) {
        console.error('Raw response:', response);
        throw new Error(`Failed to parse response as JSON: ${parseError}`);
      }

      return parsedQuestions;
    } catch (error) {
      console.error('Error generating follow-up questions:', error);
      return [];
    }
  }
}
