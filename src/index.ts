import AIProvider from "@provider/aiProvider";
import { WebSearchResult } from "@/types/types";
import { DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_BREADTH_CONFIG, DEFAULT_REPORT_CONFIG, DeepResearchConfig } from "./config/defaults";
import "dotenv/config";
import { JigsawProvider } from "./provider/jigsaw";
import { generateObject, generateText, LanguageModelV1 } from "ai";
import { z } from "zod";
import { PROMPTS } from "./prompts/prompts";
import { Logger, logger } from "./utils/logger";

/**
 * Decision making
 * 
 * @param reasoning - The reasoning for the decision
 * @param aiProvider - The AI provider
 * @param topic - The topic of the research
 * @returns The decision whether to continue with more research or to start generating the final report
 */
export async function decisionMaking({
  reasoning,
  topic,
  aiProvider,
}: { reasoning: string; topic: string; aiProvider: AIProvider }) {
  const decisionMakingPrompt = PROMPTS.decisionMaking({
    reasoning,
    topic,
  });

  const decisionMakingResponse = await generateObject({
    model: aiProvider.getModel("default"),
    output: "object",
    schema: z.object({
      isComplete: z.boolean().describe("If the reasoning is sufficient to answer the main topic set to true."),
      reason: z.string().describe("The reason for the decision"),
    }),
    system: decisionMakingPrompt.system,
    prompt: decisionMakingPrompt.user,
    temperature: 0,
  });

  return decisionMakingResponse.object;
}

/**
 * Reasoning about the search results
 * 
 * @param topic - The topic of the research
 * @param latestResearchPlan - The latest research plan
 * @param sources - The search results (url, title, domain, ai_overview.) from JigsawStack
 * @param queries - The queries used to get the search results
 * @param aiProvider - The AI provider
 * @returns The reasoning / thinking output evaluating the search results
**/
export async function reasoningSearchResults({
  topic,
  latestResearchPlan,
  sources,
  queries,
  aiProvider,
}: { topic: string; latestResearchPlan: string; sources: WebSearchResult[]; queries: string[]; aiProvider: AIProvider }) {
  try {
    const reasoningPrompt = PROMPTS.reasoningSearchResults({
      topic,
      researchPlan: latestResearchPlan,
      sources: sources,
      queries: queries,
    });

    logger.log("REASONING WITH", reasoningPrompt);

    const reasoningResponse = await generateText({
      model: aiProvider.getModel("reasoning"),
      // system: reasoningPrompt.system,
      prompt: reasoningPrompt.user,
    });
    
    // Option 1: Return reasoning property if available
    if (reasoningResponse.reasoning) {
      return reasoningResponse.reasoning;
    }

    // Option 2: Extract content between <think> or <thinking> tags (deepseek-r1 uses this)
    const thinkingMatch = reasoningResponse.text.match(/<think>([\s\S]*?)<\/think>|<thinking>([\s\S]*?)<\/thinking>/);
    if (thinkingMatch) {
      return thinkingMatch[1] || thinkingMatch[2]; // Return the content of whichever group matched
    }

    // Option 3: If no structured reasoning available, return the full text
    return reasoningResponse.text;
  } catch (error: any) {
    logger.error("Fatal error in reasoningSearchResults:", error.message || error);
    logger.error(`  Error details:`, error);

    // Throw the error to terminate program execution
    throw new Error(`Research evaluation failed: ${error.message || "Unknown error"}`);
  }
}

/**
 * Process the report for sources
 * 
 * @param report - The report to process
 * @param sources - The search results (url, query, context, etc) from JigsawStack
 * @returns The report with sources
 */
export async function processReportForSources({
  report,
  sources,
}: {
  report: string;
  sources: WebSearchResult[];
}) {
  // Create a lookup map for reference numbers to source info
  const referenceMap = new Map<number, any>();
  
  // Populate the map with reference numbers and their corresponding source info
  
  sources.forEach(source => {
    if (source.searchResults && Array.isArray(source.searchResults.results)) {
      source.searchResults.results.forEach(result => {
        
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
    const referenceNumbers = referenceString.split(',').map(ref => parseInt(ref.trim(), 10));
    
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
      const links = referenceNumbers.map(refNum => {
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
      return `[${links.join(', ')}]`;
    }
  });
  
  // Generate bibliography section
  let bibliography = "\n\n## References\n\n";
  
  // Sort by reference number for a well-ordered bibliography
  const sortedReferences = Array.from(referenceMap.entries())
    .sort((a, b) => a[0] - b[0]);
  
  logger.log(`Generating bibliography with ${sortedReferences.length} entries`);
  
  // Create bibliography entries
  sortedReferences.forEach(([number, source]) => {
    const title = source.title || "No title";
    
    bibliography += `${number}. [${title}](${source.url})\n`;
  });

  return {reportWithSources, bibliography};
}

/**
 * Generate the final report
 * 
 * @param sources - The search results (url, query, context, etc) from JigsawStack
 * @param topic - The topic of the research
 * @param targetOutputTokens - The target output tokens
 * @param aiProvider - The AI provider
 * @param latestReasoning - The latest reasoning
 * @param latestResearchPlan - The latest research plan
 * @param queries - The queries used to get the search results
 * @returns The final report
 */
export async function generateFinalReport({
  sources,
  topic,
  targetOutputTokens,
  aiProvider,
  latestReasoning,
  latestResearchPlan,
  queries,
}: {
  sources: WebSearchResult[];
  topic: string;
  targetOutputTokens?: number;
  aiProvider: AIProvider;
  latestReasoning: string;
  latestResearchPlan: string;
  queries: string[];
}) {
  let draft = "";
  let iter = 0;
  // track which prompt we're on
  let phase: "initial" | "continuation" | "done" = "initial";

  do {
    logger.log(`[Iteration ${iter}] phase=${phase}`);

    const finalReportPrompt = PROMPTS.finalReport({
      currentReport: draft,
      topic,
      sources,
      targetOutputTokens,
      latestResearchPlan,
      latestReasoning,
      queries,
      phase,
    });


    logger.log(`\n[Iteration ${iter}] phase=${phase}`);
    logger.log("SYSTEM PROMPT:\n" + finalReportPrompt.system);
    logger.log("USER PROMPT:\n" + finalReportPrompt.user);

    // call the model
    const response = await generateObject({
      model: aiProvider.getModel("output"),
      system: finalReportPrompt.system,
      prompt: finalReportPrompt.user,
      schema: z.object({
        text: z.string().describe("The final report"),
        phase: z.enum(["initial", "continuation", "done"]).describe("The phase of the report"),
      }),
      experimental_repairText: async ({ text, error }) => {
        // Simple repair attempt for unclosed JSON strings
        if (error && error.message && error.message.includes('Unterminated string')) {
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
  } while (phase !== "done");

  // process the report for sources 
  const {reportWithSources, bibliography} = await processReportForSources({
    report: draft,
    sources,
  });

  logger.log("Done processing report for sources");

  return { report: reportWithSources, bibliography };
}

/**
 * Generate a research plan
 * 
 * @param aiProvider - The AI provider
 * @param topic - The topic of the research
 * @param pastReasoning - The past reasoning
 * @param pastQueries - The past queries
 * @param pastSources - The past sources
 */
export async function generateResearchPlan({
  aiProvider,
  topic,
  pastReasoning,
  pastQueries,
  pastSources,
  config,
}: { aiProvider: AIProvider; topic: string; pastReasoning: string; pastQueries: string[]; pastSources: WebSearchResult[]; config: DeepResearchConfig;}) {
  try {
    const researchPlanPrompt = PROMPTS.research({
      topic,
      reasoning: pastReasoning,
      queries: pastQueries,
      sources: pastSources,
    });
    
    // Generate the research plan using the AI provider
    const result = await generateObject({
      model: aiProvider.getModel("default"),
      system: researchPlanPrompt.system,
      prompt: researchPlanPrompt.user,
      schema: z.object({
        subQueries: z.array(z.string()).min(1).max(config.breadth.maxBreadth).describe("A list of search queries to thoroughly research the topic"),
        plan: z.string().describe("A detailed plan explaining the research approach and methodology"),
        depth: z.number().min(1).max(config.depth.maxDepth).describe("A number representing the depth of the research"),
        breadth: z.number().min(1).max(config.breadth.maxBreadth).describe("A number representing the breadth of the research"),
      }),
    });

    logger.log("Research Prompts", PROMPTS.research({
      topic,
      reasoning: pastReasoning,
      queries: pastQueries,
      sources: pastSources,
    }));

    return {
      subQueries: result.object.subQueries,
      plan: result.object.plan,
      suggestedDepth: result.object.depth,
      suggestedBreadth: result.object.breadth,
    };
  } catch (error: any) {
    logger.error(`Error generating research plan: ${error.message || error}`);
    throw new Error(`Research evaluation failed: ${error.message || "Unknown error"}`);
  }
}

/**
 * Deduplicate search results
 * 
 * @param sources - The search results (url, query, context, etc) from JigsawStack
 * @returns The deduplicated search results
 */
function deduplicateSearchResults({ sources }: { sources: WebSearchResult[] }): WebSearchResult[] {
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
}

/**
 * Map search results to numbers
 * 
 * @param sources - The search results (url, query, context, etc) from JigsawStack
 * @returns The search results with numbers
 */
function mapSearchResultsToNumbers({ sources }: { sources: WebSearchResult[] }): WebSearchResult[] {
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
}

/**
 * Create a new DeepResearch instance
 * 
 * @param config - The configuration for the DeepResearch instance
 * @returns A new DeepResearch instance
 */
export function createDeepResearch(config: Partial<DeepResearchConfig>) {
  return new DeepResearch(config);
}

/**
 * The DeepResearch class
 */
export class DeepResearch {
  public config: DeepResearchConfig;
  public topic: string = "";
  public finalReport: string = "";

  public latestResearchPlan: string = "";
  public latestReasoning: string = "";
  public latestDecisionMakingReason: string = "";
  public logger = Logger.getInstance();


  public queries: string[] = [];
  public sources: WebSearchResult[] = [];
  public aiProvider: AIProvider;
  private jigsaw: JigsawProvider;
  private isComplete: boolean = false;
  private iterationCount: number = 0;

  constructor(config: Partial<DeepResearchConfig>) {
    this.config = this.validateConfig(config);

    if (this.config.logging && this.config.logging.enabled !== undefined) {
      this.logger.setEnabled(this.config.logging.enabled);
    }

    const openaiApiKey = this.config?.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const geminiApiKey = this.config?.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    const deepInfraApiKey = this.config?.DEEPINFRA_API_KEY || process.env.DEEPINFRA_API_KEY;
    const jigsawApiKey = this.config?.JIGSAW_API_KEY || process.env.JIGSAW_API_KEY;

    if (!openaiApiKey || !geminiApiKey || !deepInfraApiKey || !jigsawApiKey) {
      throw new Error("API keys are not set");
    }

    // Initialize AIProvider with API keys from config
    this.jigsaw = JigsawProvider.getInstance(jigsawApiKey);
    this.aiProvider = new AIProvider({
      OPENAI_API_KEY: openaiApiKey,
      GEMINI_API_KEY: geminiApiKey,
      DEEPINFRA_API_KEY: deepInfraApiKey,
      defaultModel: this.config.models.default,
      reasoningModel: this.config.models.reasoning,
      outputModel: this.config.models.output,
    });

    this.initModels();
  }

  private initModels() {
    // Add models from config.models if available
    if (this.config.models) {
      Object.entries(this.config.models).forEach(([modelType, modelValue]) => {
        if (modelValue) {
          this.aiProvider.setModel(modelType, modelValue);
        }
      });
    }
  }

  /**
   * Validate the configuration
   * 
   * @param config - The configuration for the DeepResearch instance
   * @returns The validated configuration (merged with defaults)
   */
  public validateConfig(config: Partial<DeepResearchConfig>) {
    // maxOutputTokens must be greater than targetOutputLength
    if (config.report && config.report.maxOutputTokens && config.report.targetOutputTokens && config.report.maxOutputTokens < config.report.targetOutputTokens) {
      throw new Error("maxOutputChars must be greater than targetOutputChars");
    }

    // Merge models carefully to handle both string and LanguageModelV1 instances
    const mergedModels = { ...DEFAULT_CONFIG.models, ...(config.models || {}) };

    if (config.models) {
      Object.entries(config.models).forEach(([key, value]) => {
        if (value !== undefined) {
          mergedModels[key] = value;
        }
      });
    }

    return {
      depth: {
        ...DEFAULT_DEPTH_CONFIG,
        ...(config.depth || {}),
      },
      breadth: {
        ...DEFAULT_BREADTH_CONFIG,
        ...(config.breadth || {}),
      },
      report: {
        ...DEFAULT_REPORT_CONFIG,
        ...(config.report || {}),
      },
      models: mergedModels,
      JIGSAW_API_KEY:
        config.JIGSAW_API_KEY ||
        (() => {
          throw new Error("JIGSAW_API_KEY must be provided in config");
        })(),
      OPENAI_API_KEY:
        config.OPENAI_API_KEY ||
        (() => {
          throw new Error("OpenAI API key must be provided in config");
        })(),
      GEMINI_API_KEY:
        config.GEMINI_API_KEY ||
        (() => {
          throw new Error("Gemini API key must be provided in config");
        })(),
      DEEPINFRA_API_KEY:
        config.DEEPINFRA_API_KEY ||
        (() => {
          throw new Error("DeepInfra API key must be provided in config");
        })(),
      logging: {
        ...DEFAULT_CONFIG.logging,
        ...(config.logging || {}),
      },
    };
  }

  /**
   * Generate a research report
   * 
   * @param topic - The topic of the research
   * @returns The research report
   */
  public async generate(topic: string) {
    logger.log(`Running research with topic: ${topic}`);
    this.topic = topic;
    let iteration = 0;

    do {
      iteration++;

      logger.log(`[Step 1] Generating research plan... at ${iteration}`);

      const {
        subQueries,
        plan,
        suggestedDepth,
        suggestedBreadth,
      } = await generateResearchPlan({
        aiProvider: this.aiProvider,
        topic: this.topic,
        pastReasoning: this.latestReasoning,
        pastQueries: this.queries,
        pastSources: this.sources,
        config: this.config,
      });
  
      this.queries = [...(this.queries || []), ...subQueries];
      this.latestResearchPlan = plan;

      logger.log(`Research plan: ${this.latestResearchPlan}`);
      logger.log(`Research queries: ${this.queries.join("\n")}`);
      logger.log(`Research depth and breadth: ${this.config.depth.maxDepth} ${this.config.breadth.maxBreadth}`);

      // step 2: fire web searches
      logger.log(`[Step 2] Running initial web searches with ${this.queries.length} queries...`);

      const initialSearchResults = await this.jigsaw.searchAndGenerateContext(this.queries, this.topic, this.aiProvider);
      
      // step 2.5: deduplicate results
      logger.log(`Received ${initialSearchResults.length} initial search results`);
      logger.log(`[Step 2.5] Deduplicating search results...`);

      this.sources = [...this.sources, ...initialSearchResults];

      const deduplicatedResults = deduplicateSearchResults({ sources: this.sources });

      // save it to the class for later use
      this.sources = deduplicatedResults;
      logger.log("DEDUPLICATED RESULTS", deduplicatedResults);

      // step 3: reasoning about the search results
      logger.log(`[Step 3] Reasoning about the search results...`);
      const reasoning = await reasoningSearchResults({
        topic: this.topic,
        latestResearchPlan: this.latestResearchPlan,
        sources: this.sources,
        queries: this.queries,
        aiProvider: this.aiProvider,
      });
      this.latestReasoning = reasoning;

      logger.log(`Reasoning: ${reasoning}`);

      // step 4: decision making
      logger.log(`[Step 4] Decision making...`);
      const deciding = await decisionMaking({
        reasoning,
        topic: this.topic,
        aiProvider: this.aiProvider,
      });

      this.latestDecisionMakingReason = deciding.reason;
      logger.log(`Decision making: ${deciding.isComplete} ${deciding.reason}`);


      const { isComplete, reason } = deciding;
      this.isComplete = isComplete;
      this.latestReasoning = reason;
    } while (!this.isComplete && iteration < this.config.depth.maxDepth);

    // map the sources to numbers for sources
    this.sources = mapSearchResultsToNumbers({ sources: this.sources });

    // step 5: generating report
    logger.log(`[Step 5] Generating report...`);

    const { report, bibliography } = await generateFinalReport({
      sources: this.sources,
      topic: this.topic,
      targetOutputTokens: this.config.report.targetOutputTokens,
      aiProvider: this.aiProvider,
      latestReasoning: this.latestReasoning,
      latestResearchPlan: this.latestResearchPlan,
      queries: this.queries,
    });


    return {
      status: "success",
      data: {
        text: report + "\n\n" + bibliography,
        metadata: {
          topic: this.topic,
          iterationCount: this.iterationCount,
          completionStatus: this.isComplete,
          reasoning: this.latestReasoning,
          researchPlan: this.latestResearchPlan,
          queries: this.queries,
          sources: this.sources,
        },
      },
    };
  }
}

// Default export
export default createDeepResearch;
