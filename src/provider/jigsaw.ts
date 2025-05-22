import { JigsawStack } from "jigsawstack";
import "dotenv/config";
import { ResearchSource, WebSearchResult } from "@/types/types";
import { ContentCleaner } from "@utils/utils";
import { retryAsync, createExponetialDelay } from "ts-retry";
import { AIProvider } from "./aiProvider";
import { generateObject, generateText } from "ai";
import z from "zod";
import { PROMPTS } from "@/prompts/prompts";

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

  private async context_generator({queries, sources, topic, aiProvider}: {queries: string[]; sources: WebSearchResult[]; topic: string; aiProvider: AIProvider}) {
    try {
      // Generate context for each query's search results
      const contextResults = await Promise.all(
        queries.map(async (query) => {
          // Extract content from sources for this query
          const querySources = sources.find(source => source.query=== query)?.searchResults.results || [];

          const response = await generateObject({
            model: aiProvider.getDefaultModel(),
            prompt: PROMPTS.contextGeneration({
              topic: topic,
              queries: [query],
              sources: querySources,
            }),
            schema: z.object({
              context: z.string().describe("The context overview"),
              hasContent: z.boolean().describe("If there are contents provided in the sources, if not, return false"),
            }),
          });
          
          return {
            query: query,
            context: response.object.context,
            hasContent: response.object.hasContent
          };
        })
      );
      
      return contextResults;
    } catch (error) {
      console.error("Error generating context overview:", error);
      return "Error generating context overview.";
    }
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
              ai_overview: false,
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
            content: result.content || "",
          };
          const cleaned = ContentCleaner.cleanContent(source);
          return {
            ...cleaned,
            domain: cleaned.domain || "",
            isAcademic: cleaned.isAcademic || false,
          } as ResearchSource;
        });
        return {
          query: query,
          searchResults: {
            results: cleanedResults,
          },
        };
      } catch (error) {
        console.error("Full error details:", error);
        return {
          query: query,
          searchResults: {
            results: [],
          },
        };
      }
    });

    // Execute all searches in parallel
    return Promise.all(searchPromises);
  }
}
