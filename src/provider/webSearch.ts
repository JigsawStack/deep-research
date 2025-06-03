import { PROMPTS } from "@/prompts/prompts";
import { DeepResearchConfig, WebSearchResult } from "@/types/types";
import { ContentCleaner, deduplicateSearchResults } from "@utils/utils";
import { generateObject } from "ai";
import { createExponetialDelay, retryAsync } from "ts-retry";
import { z } from "zod";
import AIProvider from "./aiProvider";
import { JigsawProvider } from "./jigsaw";

export class WebSearchProvider {
  private static instance: WebSearchProvider;
  private jigsaw: JigsawProvider | null = null;
  private customSearchFunction: ((query: string) => Promise<WebSearchResult>) | null = null;

  private constructor(config: DeepResearchConfig) {
    // If user provided a custom search function, use it
    if (config.webSearch) {
      this.customSearchFunction = config.webSearch;
    }

    // If a JIGSAW_API_KEY is provided, initialize JigsawProvider as fallback
    if (config.JIGSAW_API_KEY) {
      this.jigsaw = JigsawProvider.getInstance({ apiKey: config.JIGSAW_API_KEY });
    }
  }

  public static getInstance(config: DeepResearchConfig): WebSearchProvider {
    if (!WebSearchProvider.instance) {
      WebSearchProvider.instance = new WebSearchProvider(config);
    }
    return WebSearchProvider.instance;
  }

  /**
   * Fire web searches for all queries
   */
  private async fireWebSearches(queries: string[]): Promise<WebSearchResult[]> {
    // Map each query to a promise that resolves to a search result
    const searchPromises = queries.map(async (query) => {
      try {
        // If custom search function is available, use it
        if (this.customSearchFunction) {
          return await this.customSearchFunction(query);
        }

        // Otherwise use JigsawProvider as fallback
        if (this.jigsaw) {
          // Use ts-retry for API requests
          const results = await retryAsync(
            async () => {
              return await this.jigsaw!.jigsawInstance.web.search({
                query,
                ai_overview: false,
              });
            },
            {
              delay: createExponetialDelay(2000), // Start with 2s, then grows exponentially
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
          const cleanedResults = results.results
            .slice(0, 5)
            .map((result) => {
              const cleaned = ContentCleaner.cleanContent(result);
              return {
                ...cleaned,
              };
            })
            // Filter out sources with empty content and empty snippets early
            .filter((source) => (source.content && source.content.length > 0) || (source.snippets && source.snippets.length > 0));

          return {
            ...results,
            search_results: {
              results: cleanedResults,
            },
          };
        }

        // This should never happen due to initialization checks
        throw new Error("No search method available");
      } catch (error) {
        console.error("Full error details:", error);
        return {
          query: query,
          search_results: {
            results: [],
          },
        };
      }
    });

    // Execute all searches in parallel
    return Promise.all(searchPromises);
  }

  /**
   * Fire web searches for all queries and generate context for the search results
   */
  public async searchAndGenerateContext({
    queries,
    prompt,
    aiProvider,
    sources,
  }: { queries: string[]; prompt: string; aiProvider: AIProvider; sources: WebSearchResult[] }): Promise<WebSearchResult[]> {
    // Step 1: Fire web searches for all queries
    const searchResults = await this.fireWebSearches(queries);

    // Filter out queries with empty search results
    const nonEmptySearchResults = searchResults.filter(
      (result) => result.search_results && result.search_results.results && result.search_results.results.length > 0
    );

    // If all results are empty, return an empty array
    if (nonEmptySearchResults.length === 0) {
      console.warn("No search results found for any query");
      return [];
    }

    // Step 2: Generate context for the search results with non-empty results
    const contextQueries = nonEmptySearchResults.map((result) => result.query);
    const contextResults = await this.contextGenerator({
      queries: contextQueries,
      sources: nonEmptySearchResults,
      prompt,
      aiProvider,
    });

    // Step 3: Combine search results with generated contexts
    const resultsWithContext = nonEmptySearchResults.map((searchResult, index) => {
      return {
        ...searchResult,
        context: contextResults[index],
      };
    });

    // step 4: deduplicate results
    const deduplicatedResults = deduplicateSearchResults({
      sources: [...sources, ...resultsWithContext],
    });

    return deduplicatedResults;
  }

  /**
   * Generate context for the search results
   */
  private async contextGenerator({
    queries,
    sources,
    prompt,
    aiProvider,
  }: { queries: string[]; sources: WebSearchResult[]; prompt: string; aiProvider: AIProvider }) {
    try {
      // Generate context for each query's search results
      const contextResults = await Promise.all(
        queries.map(async (query) => {
          // Extract content from sources for this query
          const querySources = sources.find((source) => source.query === query)?.search_results.results || [];

          // Process sources to use snippets when content is empty
          const processedSources = querySources
            .map((source) => {
              if (!source.content || source.content.trim() === "") {
                // If content is empty but snippets are available, join snippets as content
                if (source.snippets && source.snippets.length > 0) {
                  return {
                    ...source,
                    content: source.snippets.join("\n"),
                  };
                } else {
                  // otherwise we dont use the source at all
                  return null;
                }
              }
              return source;
            })
            .filter((source) => source !== null);

          const response = await generateObject({
            model: aiProvider.getModel("default"),
            prompt: PROMPTS.contextGeneration({
              prompt: prompt,
              queries: [query],
              research_sources: processedSources,
            }),
            schema: z.object({
              context: z.string().describe("The context overview"),
            }),
          });

          return response.object.context;
        })
      );

      return contextResults;
    } catch (error) {
      console.error("Error generating context overview:", error);
      return "Error generating context overview.";
    }
  }
}
