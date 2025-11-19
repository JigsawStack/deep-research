import { PROMPTS } from "@/prompts/prompts";
import { DeepResearchConfig, WebSearchResult } from "@/types/types";
import { ContentCleaner, deduplicateSearchResults } from "@utils/utils";
import { generateObject, generateText } from "ai";
import { createExponetialDelay, retryAsync } from "ts-retry";
import AIProvider from "./aiProvider";
import { JigsawProvider } from "./jigsaw";

export class WebSearchProvider {
  private static instance: WebSearchProvider;
  private jigsaw: JigsawProvider | null = null;
  private customSearchFunction: ((query: string) => Promise<WebSearchResult>) | null = null;

  private constructor(config: DeepResearchConfig) {
    // If user provided a custom search function, use it
    if (config.web_search) {
      this.customSearchFunction = config.web_search;
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
                max_results: 3,
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

          console.log(`${query} Results: ${results.results.length} results`);
          // Clean and process each search result
          const cleanedResults = results.results
            .slice(0, 3)
            .map((result) => {
              const normalizedResult = {
                ...result,
                content: typeof result.content === "string" ? result.content : result.content?.text || "",
              };
              const cleaned = ContentCleaner.cleanContent(normalizedResult);
              return {
                ...cleaned,
              };
            })
            // Filter out sources with empty content and empty snippets early
            .filter((source) => (source.content && source.content.length > 0) || (source.snippets && source.snippets.length > 0));

          console.log(
            `${query} Cleaned Results: ${cleanedResults.length} results, ${cleanedResults.reduce((acc, result) => acc + (result.content?.length || 0), 0)} characters`
          );
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
    console.log("contextQueries", contextQueries);
    let contextGenerationStartTime = performance.now();
    console.log("Starting context generation", contextGenerationStartTime);
    const contextResults = await this.contextGenerator({
      queries: contextQueries,
      sources: nonEmptySearchResults,
      prompt,
      aiProvider,
    });
    let contextGenerationEndTime = performance.now();
    console.log("Context generation complete", contextGenerationEndTime - contextGenerationStartTime);
    // Step 3: Combine search results with generated contexts
    const resultsWithContext = nonEmptySearchResults
      .map((searchResult, index) => {
        // Filter out sources with empty content and empty snippets
        const filteredResults = searchResult.search_results.results.filter(
          (source) => (source.content && source.content.trim() !== "") || (source.snippets && source.snippets.length > 0)
        );

        // Skip queries that end up with empty results after filtering
        if (filteredResults.length === 0) {
          return null;
        }

        return {
          query: searchResult.query,
          search_results: {
            results: filteredResults,
          },
          context: contextResults[index] || "",
          geo_results: searchResult.geo_results,
          image_urls: searchResult.image_urls,
          links: searchResult.links,
        };
      })
      .filter((result) => result !== null);

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

          let PromptToModel = PROMPTS.contextGeneration({
            prompt: prompt,
            queries: [query],
            research_sources: processedSources,
          });
          console.log(`${query} Prompt to Model: ${PromptToModel.length} characters`);
          const response = await generateText({
            model: aiProvider.getModel("default"),
            providerOptions: {
              openai: {
                reasoning_effort: "minimal",
              },
            },
            prompt: PromptToModel,
            maxRetries: 3,
          });

          return response.text;
        })
      );

      return contextResults;
    } catch (error) {
      console.error("Error generating context overview:", error);
      return "Error generating context overview.";
    }
  }
}
