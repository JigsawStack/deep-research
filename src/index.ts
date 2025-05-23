// **Feature**
// byo_urls user bring their own urls to do the websearch

// **Feature**
// byo_pdfs as content

import AIProvider from "@provider/aiProvider";
import { WebSearchResult } from "@/types/types";

import { DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_BREADTH_CONFIG, DEFAULT_REPORT_CONFIG } from "./config/defaults";
import "dotenv/config";
import { JigsawProvider } from "./provider/jigsaw";
import fs from "fs";
import { generateObject, generateText, LanguageModelV1 } from "ai";
import { z } from "zod";
import { PROMPTS } from "./prompts/prompts";

/**
 * Decision making
 * 
 * @param reasoning - The reasoning for the decision
 * @param aiProvider - The AI provider
 * @returns The decision whether to continue with more research or to start generating the final report
 */
export async function decisionMaking({
  reasoning,
  aiProvider,
}: { reasoning: string; aiProvider: AIProvider }) {
  const decisionMakingPrompt = PROMPTS.decisionMaking({
    reasoning,
  });

  const decisionMakingResponse = await generateObject({
    model: aiProvider.getDefaultModel(),
    output: "object",
    schema: z.object({
      isComplete: z.boolean().describe("Whether the research is complete"),
      reason: z.string().describe("The reason for the decision"),
      
    }),
    prompt: decisionMakingPrompt,
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

    const reasoningResponse = await generateText({
      model: aiProvider.getReasoningModel(),
      prompt: reasoningPrompt,
    });

    // Create logs directory if it doesn't exist
    if (!fs.existsSync("logs")) {
      fs.mkdirSync("logs", { recursive: true });
    }
    fs.writeFileSync("logs/reasoningPrompt.md", reasoningPrompt);
    fs.writeFileSync("logs/reasoningTest.md", reasoningResponse.text);

    // Option 1: Return reasoning property if available
    if (reasoningResponse.reasoning) {
      return reasoningResponse.reasoning;
    }

    // Option 2: Extract content between <think> or <thinking> tags
    const thinkingMatch = reasoningResponse.text.match(/<think>([\s\S]*?)<\/think>|<thinking>([\s\S]*?)<\/thinking>/);
    if (thinkingMatch) {
      return thinkingMatch[1] || thinkingMatch[2]; // Return the content of whichever group matched
    }

    // Option 3: If no structured reasoning available, return the full text
    return reasoningResponse.text;
  } catch (error: any) {
    console.error("Fatal error in reasoningSearchResults:", error.message || error);
    console.error(`  Error details:`, error);

    // Throw the error to terminate program execution
    throw new Error(`Research evaluation failed: ${error.message || "Unknown error"}`);
  }
}

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
  
  console.log(`Reference map size: ${referenceMap.size}`);
  
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
      console.log(`No source found for citation [${refNum}]`);
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
        console.log(`No source found for citation part ${refNum}`);
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
  
  console.log(`Generating bibliography with ${sortedReferences.length} entries`);
  
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
 * @param sources - The search results (url, title, domain, ai_overview.) from JigsawStack
 * @param topic - The topic of the research
 * @param targetOutputTokens - The target output tokens
 * @param aiProvider - The AI provider
 * @param debugLog - The debug log
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
  debugLog,
  latestReasoning,
  latestResearchPlan,
  queries,
}: {
  sources: WebSearchResult[];
  topic: string;
  targetOutputTokens?: number;
  aiProvider: AIProvider;
  debugLog: string[];
  latestReasoning: string;
  latestResearchPlan: string;
  queries: string[];
}) {
  let draft = "";
  let iter = 0;
  // track which prompt we're on
  let phase: "initial" | "continuation" | "done" = "initial";

  do {
    console.log(`[Iteration ${iter}] phase=${phase}`);

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


    debugLog.push(`\n[Iteration ${iter}] phase=${phase}`);
    debugLog.push("SYSTEM PROMPT:\n" + finalReportPrompt.system);
    debugLog.push("USER PROMPT:\n" + finalReportPrompt.user);

    // call the model
    const response = await generateObject({
      model: aiProvider.getOutputModel(),
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

    debugLog.push("MODEL OUTPUT:\n" + response.object.text);
    debugLog.push("PHASE==============================:\n" + response.object.phase);

    fs.writeFileSync("logs/debug.md", debugLog.join("\n"));

    if (phase === "continuation") {
      const targetChars = targetOutputTokens ? targetOutputTokens * 4 : undefined;
      if (targetChars && draft.length >= targetChars) {
        phase = "done";
      }
    }

    // persist debug log each loop
    fs.writeFileSync("logs/report-log.md", debugLog.join("\n"));

    iter++;
  } while (phase !== "done");

  // process the report for sources 
  const {reportWithSources, bibliography} = await processReportForSources({
    report: draft,
    sources,
  });

  console.log("Done processing report for sources");

  return { report: reportWithSources, bibliography, debugLog };
}

/**
 * Generate a research plan
 * 
 * @param aiProvider - The AI provider
 * @param topic - The topic of the research
 * @param pastReasoning - The past reasoning
 * @param pastQueries - The past queries
 * @param config - The configuration for the DeepResearch instance
 * @param maxDepth - The maximum depth of the research
 */
export async function generateResearchPlan({
  aiProvider,
  topic,
  pastReasoning,
  pastQueries,
  pastSources,
}: { aiProvider: AIProvider; topic: string; pastReasoning: string; pastQueries: string[]; pastSources: WebSearchResult[]; config: typeof DEFAULT_CONFIG; maxDepth: number; maxBreadth: number; targetOutputTokens?: number }) {
  try {
    // Generate the research plan using the AI provider
    const result = await generateObject({
      model: aiProvider.getDefaultModel(),
      output: "object",
      schema: z.object({
        subQueries: z.array(z.string()).describe("A list of search queries to thoroughly research the topic"),
        plan: z.string().describe("A detailed plan explaining the research approach and methodology"),
        depth: z.number().describe("a number representing the depth of the research"),
        breadth: z.number().describe("a number representing the breadth of the research"),
      }),

      prompt: PROMPTS.research({
        topic,
        pastReasoning,
        pastQueries,
        pastSources,
      }),
    });

    return {
      subQueries: result.object.subQueries,
      plan: result.object.plan,
      suggestedDepth: result.object.depth,
      suggestedBreadth: result.object.breadth,
    };
  } catch (error: any) {
    console.error(`Error generating research plan: ${error.message || error}`);
    throw new Error(`Research evaluation failed: ${error.message || "Unknown error"}`);
  }
}

export function deduplicateSearchResults({ sources }: { sources: WebSearchResult[] }): WebSearchResult[] {
  const urlMap = new Map<string, boolean>();

  return sources.map((result) => {
    return {
      query: result.query,
      context: result.context || "",
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
            // Keep only essential information
            return {
              url: item.url,
              title: item.title || "",
              domain: item.domain || "",
              content: item.content || "",
            };
          }),
      },
    };
  });
}

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
            title: item.title || "",
            domain: item.domain || "",
            referenceNumber: urlMap.get(item.url) || 0,
            content: item.content || "",
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
export function createDeepResearch(config: Partial<typeof DEFAULT_CONFIG>) {
  return new DeepResearch(config);
}


/**
 * The DeepResearch class
 */
export class DeepResearch {
  public config: typeof DEFAULT_CONFIG;
  public topic: string = "";
  public finalReport: string = "";

  public latestResearchPlan: string = "";
  public latestReasoning: string = "";
  public latestDecisionMaking: string = "";


  public queries: string[] = [];

  public sources: WebSearchResult[] = [];

  public aiProvider: AIProvider;
  private jigsaw: JigsawProvider;
  private isComplete: boolean = false;
  private iterationCount: number = 0;

  constructor(config: Partial<typeof DEFAULT_CONFIG>) {
    this.config = this.validateConfig(config);

    // Initialize AIProvider with API keys from config
    this.jigsaw = JigsawProvider.getInstance(this.config.JIGSAW_API_KEY);
    this.aiProvider = new AIProvider({
      OPENAI_API_KEY: this.config.OPENAI_API_KEY,
      GEMINI_API_KEY: this.config.GEMINI_API_KEY,
      DEEPINFRA_API_KEY: this.config.DEEPINFRA_API_KEY,
      defaultModel: this.config.models.default as LanguageModelV1,
      reasoningModel: this.config.models.reasoning as LanguageModelV1,
      outputModel: this.config.models.output as LanguageModelV1,
    });

    this.initModels();
  }

  private initModels() {
    // Add models from config.models if available
    if (this.config.models) {
      // For each model type (default, quick, reasoning, etc.)
      Object.entries(this.config.models).forEach(([modelType, modelValue]) => {
        if (modelValue) {
          if (typeof modelValue !== "string") {
            // It's a LanguageModelV1 instance, add it as a direct model
            this.aiProvider.addDirectModel(modelType, modelValue);
          }
          // If it's a string, it will be handled by the generateText method
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
  public validateConfig(config: Partial<typeof DEFAULT_CONFIG>) {
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
    };
  }

  public async generate(topic: string) {
    const debugLog: string[] = [];
    debugLog.push(`Running research with topic: ${topic}`);
    this.topic = topic;
    let iteration = 0;

    do {
      iteration++;

      console.log(`[Step 1] Generating research plan... at ${iteration}`);
      debugLog.push(`[Step 1] Generating research plan... at ${iteration}`);

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
        maxDepth: this.config.depth?.maxDepth,
        maxBreadth: this.config.breadth?.maxBreadth,
      });

      if (suggestedBreadth && suggestedBreadth > 0 && suggestedBreadth < this.config.breadth?.maxBreadth) {
        this.config.breadth.maxBreadth = suggestedBreadth;
      }
  
      if (suggestedDepth && suggestedDepth > 0 && suggestedDepth < this.config.depth?.maxDepth) {
        this.config.depth.maxDepth = suggestedDepth;
      }
  
      // // limit the subqueries to the breadth
      const limitedQueries = subQueries.slice(0, this.config.breadth?.maxBreadth);
      
      this.queries = [...(this.queries || []), ...limitedQueries];
      this.latestResearchPlan = plan;

      debugLog.push(`Research plan: ${plan}`);
      debugLog.push(`Research queries: ${limitedQueries.join("\n")}`);

      // step 2: fire web searches
      debugLog.push(`[Step 2] Running initial web searches with ${limitedQueries.length} queries...`);
      console.log(`[Step 2] Running initial web searches with ${limitedQueries.length} queries...`);

      const initialSearchResults = await this.jigsaw.searchAndGenerateContext(limitedQueries, this.topic, this.aiProvider);
      console.log(`Received ${initialSearchResults.length} initial search results`);

      // step 2.5: deduplicate results
      debugLog.push(`[Step 2.5] Deduplicating search results...`);
      console.log(`[Step 2.5] Deduplicating search results...`);

      this.sources = [...this.sources, ...initialSearchResults];

      const deduplicatedResults = deduplicateSearchResults({ sources: this.sources });

      // save it to the class for later use
      this.sources = deduplicatedResults;

      // step 3: reasoning about the search results
      debugLog.push(`[Step 3] Reasoning about the search results...`);
      console.log(`[Step 3] Reasoning about the search results...`);
      const reasoning = await reasoningSearchResults({
        topic: this.topic,
        latestResearchPlan: this.latestResearchPlan,
        sources: this.sources,
        queries: this.queries,
        aiProvider: this.aiProvider,
      });
      this.latestReasoning = reasoning;

      debugLog.push(`Reasoning: ${reasoning}`);

      // step 4: decision making
      debugLog.push(`[Step 4] Decision making...`);
      console.log(`[Step 4] Decision making...`);
      const deciding = await decisionMaking({
        reasoning,
        aiProvider: this.aiProvider,
      });

      this.latestDecisionMaking = deciding.reason;
      debugLog.push(`Decision making: ${deciding.isComplete} ${deciding.reason}`);


      const { isComplete, reason } = deciding;
      this.isComplete = isComplete;
      this.latestReasoning = reason;
    } while (!this.isComplete && iteration < this.config.depth?.maxDepth);

    // map the sources to numbers for sources
    this.sources = mapSearchResultsToNumbers({ sources: this.sources });

    // step 5: generating report
    debugLog.push(`[Step 5] Generating report...`);
    console.log(`[Step 5] Generating report...`);

    const { report, bibliography, debugLog: finalDebugLog } = await generateFinalReport({
      sources: this.sources,
      topic: this.topic,
      targetOutputTokens: this.config.report.targetOutputTokens,
      aiProvider: this.aiProvider,
      debugLog: debugLog,
      latestReasoning: this.latestReasoning,
      latestResearchPlan: this.latestResearchPlan,
      queries: this.queries,
    });

    fs.writeFileSync("logs/finalReport.md", report);
    fs.writeFileSync("logs/bibliography.md", bibliography);

    return {
      status: "success",
      data: {
        text: report,
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

  public async testFinalReportGeneration({topic}: {topic: string}) {
    // Load data from logs folder
    const sources = JSON.parse(fs.readFileSync("logs/sources.json", "utf-8"));
    const targetOutputTokens = this.config.report.targetOutputTokens;
    const latestResearchPlan = JSON.parse(fs.readFileSync("logs/researchPlan.json", "utf-8"));
    const latestReasoning = JSON.parse(fs.readFileSync("logs/reasoning.json", "utf-8"));
    const queries = JSON.parse(fs.readFileSync("logs/queries.json", "utf-8"));

    // Generate the final report using the loaded data
    const { report, debugLog } = await generateFinalReport({
      sources,
      topic,
      targetOutputTokens,
      aiProvider: this.aiProvider,
      debugLog: [],
      latestResearchPlan,
      latestReasoning,
      queries,
    });

    // Write the report to file
    fs.writeFileSync("logs/testReport.md", report);
    fs.writeFileSync("logs/testDebugLog.md", debugLog.join("\n"));

    return report;
  }
}

// Default export
export default createDeepResearch;
