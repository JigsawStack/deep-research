import { JigsawStack } from "jigsawstack";
import "dotenv/config";
import { ResearchSource } from "../types/types";
import { ContentCleaner } from "../utils/utils";
import { retryAsync, createExponetialDelay } from "ts-retry";

export class JigsawProvider {
  private static instance: JigsawProvider;
  private jigsawInstance: ReturnType<typeof JigsawStack>;

  private constructor(apiKey?: string) {
    this.jigsawInstance = JigsawStack({
      apiKey: apiKey || process.env.JIGSAW_API_KEY,
    });
  }

  public static getInstance(apiKey?: string): JigsawProvider {
    if (!JigsawProvider.instance) {
      JigsawProvider.instance = new JigsawProvider(apiKey);
    }
    return JigsawProvider.instance;
  }

  public async fireWebSearches(queries: string[]) {
    // Map each query to a promise that resolves to a search result
    const searchPromises = queries.map(async (query) => {
      try {
        // Use ts-retry for API requests
        const results = await retryAsync(
          async () => {
            const response = await this.jigsawInstance.web.search({
              query,
              ai_overview: true,
            });
            return response;
          },
          {
            delay: createExponetialDelay(1000), // Start with 1s, then grows exponentially
            maxTry: 3,
            onError: (error, currentTry) => {
              console.warn(`API request failed (attempt ${currentTry}/3):`, (error as Error).message);
              return true;
            },
          }
        );

        // Check if results has the expected structure
        if (!results || !results.results) {
          console.error("Invalid response structure:", results);
          throw new Error("Invalid search response structure");
        }

        // Clean and process each search result
        const cleanedResults = results.results.map((result) => {
          const source: ResearchSource = {
            url: result.url || "",
            title: result.title || "",
          };
          const cleaned = ContentCleaner.cleanContent(source);
          return {
            ...cleaned,
            domain: cleaned.domain || "",
            isAcademic: cleaned.isAcademic || false,
          } as ResearchSource;
        });
        return {
          question: query,
          searchResults: {
            ai_overview: results.ai_overview || "",
            results: cleanedResults,
          },
        };
      } catch (error) {
        console.error("Full error details:", error);
        return {
          question: query,
          searchResults: {
            ai_overview: "Error fetching results",
            results: [],
          },
        };
      }
    });

    // Execute all searches in parallel
    return Promise.all(searchPromises);
  }
}
