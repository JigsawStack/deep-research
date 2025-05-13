import { JigsawStack } from 'jigsawstack';
import 'dotenv/config';
import { SubQuestionGeneratorResult, SubQuestion } from '../types/generators';
import { WebSearchResult, ResearchSource, CleanedSearchResult } from '../types';
import { ContentCleaner } from '../preparation/contentCleaner';

export class JigsawProvider {
  private static instance: JigsawProvider;
  private jigsawInstance: ReturnType<typeof JigsawStack>;

  private constructor() {
    this.jigsawInstance = JigsawStack({
      apiKey: process.env.JIGSAW_API_KEY,
    });
  }

  public static getInstance(): JigsawProvider {
    if (!JigsawProvider.instance) {
      JigsawProvider.instance = new JigsawProvider();
    }
    return JigsawProvider.instance;
  }

  public async fireWebSearches(
    subQuestions: SubQuestionGeneratorResult
  ): Promise<WebSearchResult[]> {
    // Map each question to a promise that resolves to a search result
    const searchPromises = subQuestions.questions.map(async (question) => {
      try {
        // Add retry logic for API requests
        const maxRetries = 3;
        let retryCount = 0;
        let results;

        while (retryCount < maxRetries) {
          try {
            results = await this.jigsawInstance.web.search({
              query: question.question,
              ai_overview: true,
            });

            // If we get here, the request succeeded
            break;
          } catch (apiError) {
            retryCount++;
            console.warn(
              `API request failed (attempt ${retryCount}/${maxRetries}):`,
              (apiError as Error).message
            );

            if (retryCount >= maxRetries) {
              throw apiError; // Rethrow after max retries
            }

            // Wait before retrying (exponential backoff)
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * Math.pow(2, retryCount))
            );
          }
        }

        // Check if results has the expected structure
        if (!results || !results.results) {
          console.error('Invalid response structure:', results);
          throw new Error('Invalid search response structure');
        }

        // Clean and process each search result
        const cleanedResults = results.results.map((result) => {
          const source: ResearchSource = {
            url: result.url || '',
            content: result.content || '',
            title: result.title || '',
            ai_overview: results.ai_overview || '',
          };
          const cleaned = ContentCleaner.cleanContent(source);
          return {
            ...cleaned,
            domain: cleaned.domain || '',
            isAcademic: cleaned.isAcademic || false,
          } as CleanedSearchResult;
        });

        return {
          question,
          searchResults: {
            ai_overview: results.ai_overview || '',
            results: cleanedResults,
          },
        };
      } catch (error) {
        console.error('Full error details:', error);
        // Return a default structure in case of error
        return {
          question,
          searchResults: {
            ai_overview: 'Error fetching results',
            results: [],
          },
        };
      }
    });

    // Execute all searches in parallel
    return Promise.all(searchPromises);
  }
}
