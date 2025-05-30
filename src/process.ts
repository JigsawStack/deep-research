import { DeepResearchConfig, WebSearchResult } from "@/types/types";
import AIProvider from "@provider/aiProvider";
import { generateObject, generateText } from "ai";
import { PROMPTS } from "./prompts/prompts";
import { logger } from "./utils/logger";

/**
 * Decision making
 *
 * @param reasoning - The reasoning for the decision
 * @param aiProvider - The AI provider
 * @param prompt - The prompt to research
 * @returns The decision whether to continue with more research or to start generating the final report
 */
export const decisionMaking = async ({
  reasoning,
  prompt,
  aiProvider,
  queries,
  sources,
  researchPlan,
}: { reasoning: string; prompt: string; aiProvider: AIProvider; queries: string[]; sources: WebSearchResult[]; researchPlan: string }) => {
  const decisionMakingPrompt = PROMPTS.decisionMaking({
    reasoning: reasoning,
    prompt: prompt,
    queries: queries,
    sources: sources,
    researchPlan: researchPlan,
  });

  const decisionMakingResponse = await generateObject({
    model: aiProvider.getModel("default"),
    output: "object",
    system: decisionMakingPrompt.system,
    prompt: decisionMakingPrompt.user,
    schema: decisionMakingPrompt.schema,
    temperature: 0,
  });

  return { decision: decisionMakingResponse, usage: decisionMakingResponse.usage };
};

/**
 * Reasoning about the search results
 *
 * @param prompt - The prompt to research
 * @param researchPlan - The research plan
 * @param sources - The search results (url, title, domain, ai_overview.) from JigsawStack
 * @param queries - The queries used to get the search results
 * @param aiProvider - The AI provider
 * @returns The reasoning / thinking output evaluating the search results
 **/
export const reasoningSearchResults = async ({
  prompt,
  researchPlan,
  sources,
  queries,
  aiProvider,
}: { prompt: string; researchPlan: string; sources: WebSearchResult[]; queries: string[]; aiProvider: AIProvider }) => {
  try {
    const reasoningPrompt = PROMPTS.reasoningSearchResults({
      prompt: prompt,
      researchPlan: researchPlan,
      sources: sources,
      queries: queries,
    });

    logger.log("REASONING WITH", reasoningPrompt);

    const reasoningResponse = await generateText({
      model: aiProvider.getModel("reasoning"),
      prompt: reasoningPrompt.user,
    });

    // Option 1: Return reasoning property if available
    if (reasoningResponse.reasoning) {
      return { reasoning: reasoningResponse.reasoning, usage: reasoningResponse.usage };
    }

    // Option 2: Extract content between <think> or <thinking> tags (deepseek-r1 uses this)
    const thinkingMatch = reasoningResponse.text.match(/<think>([\s\S]*?)<\/think>|<thinking>([\s\S]*?)<\/thinking>/);
    if (thinkingMatch) {
      return { reasoning: thinkingMatch[1] || thinkingMatch[2], usage: reasoningResponse.usage }; // Return the content of whichever group matched
    }

    // Option 3: If no structured reasoning available, return the full text
    return { reasoning: reasoningResponse.text, usage: reasoningResponse.usage };
  } catch (error: any) {
    logger.error("Fatal error in reasoningSearchResults:", error.message || error);
    logger.error(`  Error details:`, error);

    // Throw the error to terminate program execution
    throw new Error(`Research evaluation failed: ${error.message || "Unknown error"}`);
  }
};

/**
 * Process the report for sources
 *
 * @param report - The report to process
 * @param sources - The search results (url, query, context, etc) from JigsawStack
 * @returns The report with sources
 */
export const processReportForSources = async ({
  report,
  sources,
}: {
  report: string;
  sources: WebSearchResult[];
}) => {
  // Create a lookup map for reference numbers to source info
  const referenceMap = new Map<number, any>();

  // Populate the map with reference numbers and their corresponding source info

  sources.forEach((source) => {
    if (source.searchResults && Array.isArray(source.searchResults.results)) {
      source.searchResults.results.forEach((result) => {
        if (result.referenceNumber) {
          referenceMap.set(result.referenceNumber, result);
        }
      });
    }
  });

  logger.log(`Reference map size: ${referenceMap.size}`);

  // Enhanced regex to find both single sources [1] and multiple sources [1, 2, 3]
  // This matches either:
  // 1. [number] - A single source
  // 2. [number, number, ...] - Multiple comma-separated sources
  const sourceRegex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

  // Replace each citation with markdown links
  const reportWithSources = report.replace(sourceRegex, (match, referenceString) => {
    // Split the reference string by commas if it contains multiple references
    const referenceNumbers = referenceString.split(",").map((ref) => parseInt(ref.trim(), 10));

    // If it's a single reference number
    if (referenceNumbers.length === 1) {
      const refNum = referenceNumbers[0];
      const source = referenceMap.get(refNum);

      if (source) {
        // Create markdown link with the citation number pointing to the source URL
        return `[[${refNum}](${source.url})]`;
      }

      // If no matching source found, keep the original citation
      logger.log(`No source found for citation [${refNum}]`);
      return match;
    }
    // If it's multiple reference numbers
    else {
      // Create an array to hold the links
      const links = referenceNumbers.map((refNum) => {
        const source = referenceMap.get(refNum);

        if (source) {
          // Create markdown link with the citation number pointing to the source URL
          return `[${refNum}](${source.url})`;
        }

        // If no matching source found, just return the number
        logger.log(`No source found for citation part ${refNum}`);
        return `${refNum}`;
      });

      // Join the links with commas
      return `[${links.join(", ")}]`;
    }
  });

  // Generate bibliography section
  let bibliography = "\n\n## References\n\n";

  // Sort by reference number for a well-ordered bibliography
  const sortedReferences = Array.from(referenceMap.entries()).sort((a, b) => a[0] - b[0]);

  logger.log(`Generating bibliography with ${sortedReferences.length} entries`);

  // Create bibliography entries
  sortedReferences.forEach(([number, source]) => {
    const title = source.title || "No title";

    bibliography += `${number}. [${title}](${source.url})\n`;
  });

  return { reportWithSources, bibliography };
};

/**
 * Generate the final report
 *
 * @param sources - The search results (url, query, context, etc) from JigsawStack
 * @param prompt - The prompt to research
 * @param targetOutputTokens - The target output tokens
 * @param aiProvider - The AI provider
 * @param reasoning - The reasoning
 * @param researchPlan - The research plan
 * @param queries - The queries used to get the search results
 * @returns The final report
 */
export const generateFinalReport = async ({
  sources,
  prompt,
  targetOutputTokens,
  aiProvider,
  reasoning,
  researchPlan,
  queries,
}: {
  sources: WebSearchResult[];
  prompt: string;
  targetOutputTokens?: number;
  aiProvider: AIProvider;
  reasoning: string;
  researchPlan: string;
  queries: string[];
}) => {
  let draft = "";
  let iter = 0;
  // track which prompt we're on
  let phase: "initial" | "continuation" | "done" = "initial";
  let tokenUsage = 0;

  do {
    logger.log(`[Iteration ${iter}] phase=${phase}`);

    const reportPrompt = PROMPTS.finalReport({
      currentReport: draft,
      prompt,
      sources,
      targetOutputTokens,
      researchPlan,
      reasoning,
      queries,
      phase,
    });

    logger.log(`\n[Iteration ${iter}] phase=${phase}`);
    logger.log("SYSTEM PROMPT:\n" + reportPrompt.system);
    logger.log("USER PROMPT:\n" + reportPrompt.user);

    // call the model
    const response = await generateObject({
      model: aiProvider.getModel("output"),
      system: reportPrompt.system,
      prompt: reportPrompt.user,
      schema: reportPrompt.schema,
      experimental_repairText: async ({ text, error }) => {
        // Simple repair attempt for unclosed JSON strings
        if (error && error.message && error.message.includes("Unterminated string")) {
          return text + '"}';
        }
        return text;
      },
    });

    phase = response.object.phase;
    draft += response.object.text;

    logger.log("PHASE==============================:\n" + response.object.phase);
    logger.log("MODEL OUTPUT:\n" + response.object.text);

    if (phase === "continuation") {
      const targetChars = targetOutputTokens ? targetOutputTokens * 4 : undefined;
      if (targetChars && draft.length >= targetChars) {
        phase = "done";
      }
    }

    iter++;
    tokenUsage += response.usage.totalTokens;
  } while (phase !== "done");

  // process the report for sources
  const { reportWithSources, bibliography } = await processReportForSources({
    report: draft,
    sources,
  });

  logger.log("Done processing report for sources");

  return { report: reportWithSources, bibliography, tokenUsage };
};

/**
 * Generate a research plan
 *
 * @param aiProvider - The AI provider
 * @param prompt - The prompt to research
 * @param reasoning - The reasoning
 * @param queries - The queries
 * @param sources - The sources
 */
export const generateResearchPlan = async ({
  aiProvider,
  prompt,
  reasoning,
  queries,
  sources,
  config,
}: { aiProvider: AIProvider; prompt: string; reasoning: string; queries: string[]; sources: WebSearchResult[]; config: DeepResearchConfig }) => {
  try {
    const researchPlanPrompt = PROMPTS.research({
      prompt,
      reasoning: reasoning,
      queries: queries,
      sources: sources,
      config,
    });

    // Generate the research plan using the AI provider
    const result = await generateObject({
      model: aiProvider.getModel("default"),
      system: researchPlanPrompt.system,
      prompt: researchPlanPrompt.user,
      schema: researchPlanPrompt.schema,
      mode: 'json'
    });

    logger.log(
      "Research Prompts",
      PROMPTS.research({
        prompt,
        reasoning: reasoning,
        queries: queries,
        sources: sources,
        config,
      })
    );

    return {
      subQueries: result.object.subQueries,
      researchPlan: result.object.researchPlan,
      depth: result.object.depth,
      breadth: result.object.breadth,
      tokenUsage: result.usage,
    };
  } catch (error: any) {
    logger.error(`Error generating research plan: ${error.message || error}`);
    throw new Error(`Research evaluation failed: ${error.message || "Unknown error"}`);
  }
};

/**
 * Deduplicate search results
 *
 * @param sources - The search results (url, query, context, etc) from JigsawStack
 * @returns The deduplicated search results
 */
export const deduplicateSearchResults = ({ sources }: { sources: WebSearchResult[] }): WebSearchResult[] => {
  const urlMap = new Map<string, boolean>();

  return sources.map((result) => {
    return {
      query: result.query,
      context: result.context,
      searchResults: {
        results: result.searchResults.results
          .filter((item) => {
            // Skip if we've seen this URL before
            if (urlMap.has(item.url)) {
              return false;
            }
            // Mark this URL as seen
            urlMap.set(item.url, true);
            return true;
          })
          .map((item) => {
            return {
              url: item.url,
              title: item.title,
              domain: item.domain,
              content: item.content,
              snippets: item.snippets,
            };
          }),
      },
    };
  });
};

/**
 * Map search results to numbers
 *
 * @param sources - The search results (url, query, context, etc) from JigsawStack
 * @returns The search results with numbers
 */
export const mapSearchResultsToNumbers = ({ sources }: { sources: WebSearchResult[] }): WebSearchResult[] => {
  const urlMap = new Map<string, number>();
  let currentNumber = 1;

  return sources.map((result) => {
    return {
      query: result.query,
      context: result.context || "",
      searchResults: {
        // ai_overview: result.searchResults.ai_overview,
        results: result.searchResults.results.map((item) => {
          // If URL hasn't been seen before, assign it a new number
          if (!urlMap.has(item.url)) {
            urlMap.set(item.url, currentNumber++);
          }

          return {
            url: item.url,
            title: item.title,
            domain: item.domain,
            referenceNumber: urlMap.get(item.url) || 0,
            content: item.content,
            snippets: item.snippets,
          };
        }),
      },
    };
  });
};
