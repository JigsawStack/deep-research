import AIProvider from "./provider/aiProvider";
import { ResearchSource, WebSearchResult } from "./types/types";

import { DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_BREADTH_CONFIG, DEFAULT_REPORT_CONFIG } from "./config/defaults";
import "dotenv/config";
import { JigsawProvider } from "./provider/jigsaw";
import fs from "fs";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { PROMPTS } from "./prompts/prompts";

// Add debug logging functions
/**
 * Helper function to write debug output to a file
 * @param stage The stage of the pipeline
 * @param filename The filename to write to
 * @param content The content to write
 */
function writeDebugFile(stage: string, filename: string, content: any) {
  // Create debug directory if it doesn't exist
  const debugDir = "debug";
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir);
  }

  // Create stage directory if it doesn't exist
  const stageDir = `${debugDir}/${stage}`;
  if (!fs.existsSync(stageDir)) {
    fs.mkdirSync(stageDir);
  }

  // Write the content to the file
  if (typeof content === "object") {
    fs.writeFileSync(`${stageDir}/${filename}`, JSON.stringify(content, null, 2));
  } else {
    fs.writeFileSync(`${stageDir}/${filename}`, content);
  }

  console.log(`Debug file written: ${stageDir}/${filename}`);
}

/**
 * Helper function to safely extract JSON from a potentially contaminated response
 * Handles cases where the model returns thinking or other content with the JSON
 */
function extractJSONFromResponse(text: string) {
  // Look for JSON code blocks (most reliable method)
  const jsonCodeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonCodeBlockMatch && jsonCodeBlockMatch[1]) {
    try {
      return JSON.parse(jsonCodeBlockMatch[1]);
    } catch (e) {
      console.error("Failed to parse JSON from code block:", e);
    }
  }

  // Look for the most promising JSON object in the text
  const potentialObjects: string[] = [];

  // Get text between curly braces, handling nested objects
  let stack = 0;
  let startIdx = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (stack === 0) {
        startIdx = i;
      }
      stack++;
    } else if (text[i] === "}" && stack > 0) {
      stack--;
      if (stack === 0 && startIdx !== -1) {
        potentialObjects.push(text.substring(startIdx, i + 1));
      }
    }
  }

  // Try to parse each potential object in order of length (longest first)
  // This prioritizes complete objects over small fragments
  for (const objText of potentialObjects.sort((a, b) => b.length - a.length)) {
    try {
      const parsed = JSON.parse(objText);
      // Validate the object has the expected structure
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (e) {
      // Continue to the next candidate
    }
  }

  // If we still couldn't extract JSON, throw an error
  throw new Error("Could not extract valid JSON from response");
}

// Type definitions for the research log
interface ResearchStep {
  step: string;
  timestamp: string;
  details?: any;
  iterations?: ResearchIteration[];
}

interface ResearchIteration {
  iterationNumber: number;
  timestamp: string;
  isComplete: boolean;
  reason: string;
  additionalQueries: number;
  evaluationTime: number;
  newSearchResults?: number;
  newSources?: number;
  searchTime?: number;
}

interface ResearchLog {
  timestamp: string;
  prompt: string;
  steps: ResearchStep[];
  metrics: {
    totalQueries: number;
    iterations: number;
    totalSources: number;
    uniqueSources: number;
    processingTime: {
      start: number;
      end: number;
      total: number;
    };
  };
}

export class DeepResearch {
  public config: typeof DEFAULT_CONFIG;
  public topic: string = "";
  public finalReport: string = "";

  public latestResearchPlan: string = "";
  public queries: string[] = [];

  public sources: WebSearchResult[] = [];

  private aiProvider: AIProvider;
  private jigsaw: JigsawProvider;
  private isComplete: boolean = false;
  private iterationCount: number = 0;
  private latestReasoning: string = "";
  private currentOutputLength: number = 0;

  constructor(config: Partial<typeof DEFAULT_CONFIG>) {
    this.config = this.validateConfig(config);

    // Initialize AIProvider with API keys from config
    this.jigsaw = JigsawProvider.getInstance(this.config.jigsawApiKey);
    this.aiProvider = new AIProvider({
      openaiApiKey: this.config.openaiApiKey,
      geminiApiKey: this.config.geminiApiKey,
      deepInfraApiKey: this.config.deepInfraApiKey,
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

  public validateConfig(config: Partial<typeof DEFAULT_CONFIG>) {
    // maxOutputTokens must be greater than targetOutputLength
    if (config.report && config.report.maxOutputTokens < config.report.targetOutputLength) {
      throw new Error("maxOutputTokens must be greater than targetOutputLength");
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
      jigsawApiKey:
        config.jigsawApiKey ||
        (() => {
          throw new Error("Jigsaw API key must be provided in config");
        })(),
      openaiApiKey:
        config.openaiApiKey ||
        (() => {
          throw new Error("OpenAI API key must be provided in config");
        })(),
      geminiApiKey:
        config.geminiApiKey ||
        (() => {
          throw new Error("Gemini API key must be provided in config");
        })(),
      deepInfraApiKey:
        config.deepInfraApiKey ||
        (() => {
          throw new Error("DeepInfra API key must be provided in config");
        })(),
    };
  }

  // Add this function to the DeepResearch class to summarize search results
  private deduplicateSearchResults(results: WebSearchResult[]): WebSearchResult[] {
    const urlMap = new Map<string, boolean>();

    return results.map((result) => {
      return {
        question: result.question,
        searchResults: {
          ai_overview: result.searchResults.ai_overview,
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
                ai_overview: item.ai_overview || "",
              };
            }),
        },
      };
    });
  }

  // Add debug logging to generateResearchPlan method
  private async generateResearchPlan() {
    try {
      // Generate the research plan using the AI provider
      const result = await generateObject({
        model: this.aiProvider.getDefaultModel(),
        output: "object",
        schema: z.object({
          subQueries: z.array(z.string()).describe("A list of search queries to thoroughly research the topic"),
          plan: z.string().describe("A detailed plan explaining the research approach and methodology"),
        }),
        prompt: PROMPTS.research({ topic: this.topic, pastReasoning: this.latestReasoning, pastQueries: this.queries }),
      });

      let subQueries = result.object.subQueries;

      // Limit queries if maxQueries is specified
      if (this.config.breadth?.maxParallelTopics && this.config.breadth?.maxParallelTopics > 0) {
        subQueries = subQueries.slice(0, this.config.breadth?.maxParallelTopics);
      }

      console.log(`Generated ${subQueries.length} research queries`);

      // Debug: Write the research plan to a file
      writeDebugFile("research-plan", "research-plan.json", result.object);
      writeDebugFile(
        "research-plan",
        "research-plan.md",
        `# Research Plan\n\n## Topic\n${this.topic}\n\n## 
        Plan\n${result.object.plan}\n\n## Queries\n${result.object.subQueries.map((q: string, i: number) => `${i + 1}. ${q}`).join("\n")}`
      );

      return {
        subQueries,
        plan: result.object.plan,
      };
    } catch (error: any) {
      console.error(`Error generating research plan: ${error.message || error}`);

      // Check if the error has a text property (likely from generateObject)
      if (error && typeof error === "object" && "text" in error && typeof error.text === "string") {
        console.warn("Attempting to extract JSON from error response");
        try {
          // Try to extract JSON from the response
          const extracted = extractJSONFromResponse(error.text);
          if (
            extracted &&
            "subQueries" in extracted &&
            Array.isArray(extracted.subQueries) &&
            "plan" in extracted &&
            typeof extracted.plan === "string"
          ) {
            let subQueries = extracted.subQueries;
            if (this.config.breadth?.maxParallelTopics && this.config.breadth?.maxParallelTopics > 0) {
              subQueries = subQueries.slice(0, this.config.breadth?.maxParallelTopics);
            }
            console.log(`Generated ${subQueries.length} research queries from extracted JSON`);
            // Debug: Write the extracted research plan to a file
            writeDebugFile("research-plan", "research-plan-extracted.json", extracted);
            writeDebugFile(
              "research-plan",
              "research-plan-extracted.md",
              `# Extracted Research Plan\n\n## Topic\n${this.topic}\n\n## Plan\n${extracted.plan}\n\n## Queries\n${extracted.queries
                .map((q: string, i: number) => `${i + 1}. ${q}`)
                .join("\n")}`
            );
            return {
              subQueries,
              plan: extracted.plan,
            };
          }
        } catch (extractError) {
          console.error("Failed to extract JSON:", extractError);
        }
      }

      // Fallback response
      const defaultQueries = [this.topic, `${this.topic} research`, `${this.topic} analysis`, `${this.topic} examples`, `${this.topic} implications`];
      const limitedQueries =
        this.config.breadth?.maxParallelTopics && this.config.breadth?.maxParallelTopics > 0
          ? defaultQueries.slice(0, this.config.breadth?.maxParallelTopics)
          : defaultQueries;

      // Debug: Write the fallback research plan to a file
      writeDebugFile("research-plan", "research-plan-fallback.json", {
        topic: this.topic,
        defaultQueries: limitedQueries,
        plan: `Basic research plan: Conduct a thorough search for information about "${this.topic}" using multiple angles and perspectives.`,
      });
      writeDebugFile(
        "research-plan",
        "research-plan-fallback.md",
        `# Fallback Research Plan\n\n## Topic\n${this.topic}\n\n## Plan\nBasic research plan: Conduct a thorough search for information about "${this.topic}" using multiple angles and perspectives.\n\n## Queries\n${limitedQueries
          .map((q, i) => `${i + 1}. ${q}`)
          .join("\n")}`
      );

      return {
        subQueries: limitedQueries, // Return topic and variations as fallback queries
        plan: `Basic research plan: Conduct a thorough search for information about "${this.topic}" using multiple angles and perspectives.`,
      };
    }
  }

  public async generate(prompt: string) {
    const debugLog: string[] = [];
    debugLog.push(`Running research with prompt: ${prompt}`);
    this.topic = prompt;

    while (!this.isComplete && this.iterationCount < this.config.depth?.maxLevel) {
      this.iterationCount++;
      // step 1: generate research plan
      debugLog.push(`[Step 1] Generating research plan... at ${this.iterationCount}`);
      const { subQueries, plan } = await this.generateResearchPlan();

      this.queries = [...(this.queries || []), ...subQueries];
      this.latestResearchPlan = plan;

      debugLog.push(`Research plan: ${plan}`);
      debugLog.push(`Research queries: ${subQueries.join("\n")}`);

      // step 2: fire web searches
      debugLog.push(`[Step 2] Running initial web searches with ${subQueries.length} queries...`);

      const initialSearchResults = await this.jigsaw.fireWebSearches(subQueries);
      debugLog.push(`Received ${initialSearchResults.length} initial search results`);

      // Count sources from initial results
      // logging
      let initialSourceCount = 0;
      let uniqueUrls = new Set();
      initialSearchResults.forEach((result) => {
        if (result.searchResults && result.searchResults.results) {
          initialSourceCount += result.searchResults.results.length;
          result.searchResults.results.forEach((item) => {
            if (item.url) uniqueUrls.add(item.url);
          });
        }
      });

      // step 2.5: deduplicate results
      debugLog.push(`[Step 2.5] Deduplicating search results...`);
      const deduplicatedResults = this.deduplicateSearchResults(initialSearchResults);

      // save it to the class for later use
      this.sources = deduplicatedResults;

      // logging
      // Count sources after deduplication
      let dedupSourceCount = 0;
      uniqueUrls = new Set();
      deduplicatedResults.forEach((result) => {
        if (result.searchResults && result.searchResults.results) {
          dedupSourceCount += result.searchResults.results.length;
          result.searchResults.results.forEach((item) => {
            if (item.url) uniqueUrls.add(item.url);
          });
        }
      });

      debugLog.push(`After deduplication: ${dedupSourceCount} sources (${uniqueUrls.size} unique URLs)`);

      // step 3: reasoning about the search results
      debugLog.push(`[Step 3] Reasoning about the search results...`);
      const reasoning = await this.reasoningSearchResults();
      debugLog.push(`Reasoning: ${reasoning}`);

      // step 4: decision making
      debugLog.push(`[Step 4] Decision making...`);
      const decisionMaking = await this.decisionMaking({ reasoning });
      debugLog.push(`Decision making: ${decisionMaking.isComplete} ${decisionMaking.reason}`);

      const { isComplete, reason } = decisionMaking;
      this.isComplete = isComplete;
      this.latestReasoning = reason;
    }

    // step 5: generating report
    debugLog.push(`[Step 5] Generating report...`);

    const finalReport = await this.generateFinalReport(debugLog);

    // Write debug log to file
    fs.writeFileSync("logs/debug.md", debugLog.join("\n"));

    return finalReport;
  }

  private async decisionMaking({ reasoning }: { reasoning: string }) {
    const decisionMakingPrompt = PROMPTS.decisionMaking({
      reasoning,
      totalOutputLength: this.config.report.targetOutputLength,
    });

    const decisionMakingResponse = await generateObject({
      model: this.aiProvider.getDefaultModel(),
      output: "object",
      schema: z.object({
        isComplete: z.boolean().describe("Whether the research is complete"),
        reason: z.string().describe("The reason for the decision"),
      }),
      prompt: decisionMakingPrompt,
    });

    return decisionMakingResponse.object;
  }

  private async reasoningSearchResults() {
    try {
      const reasoningPrompt = PROMPTS.reasoningSearchResults({
        topic: this.topic || "",
        researchPlan: this.latestResearchPlan || "",
        searchResults: this.sources,
        allQueries: this.queries || [],
      });

      const reasoningResponse = await generateText({
        model: this.aiProvider.getReasoningModel(),
        prompt: reasoningPrompt,
      });

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

  // Add debug logging to generateFinalReport method
  private async generateFinalReport(debugLog: string[]) {
    const continuationMarker = "[###CONTINUE###]";
    const reportPrompt = PROMPTS.finalReport({
      topic: this.topic,
      latestResearchPlan: this.latestResearchPlan,
      sources: this.sources,
      queries: this.queries,
      latestReasoning: this.latestReasoning,
      maxOutputTokens: this.config.report.maxOutputTokens,
      targetOutputLength: this.config.report.targetOutputLength,
      continuationMarker: continuationMarker,
      currentReport: this.finalReport,
      currentOutputLength: this.currentOutputLength,
    });

    debugLog.push(`Final report system prompt: ${reportPrompt.systemPrompt}`);
    debugLog.push(`Final report user prompt: ${reportPrompt.userPrompt}`);

    let isComplete = false;

    while (!isComplete) {
      const report = await generateText({
        model: this.aiProvider.getOutputModel(),
        prompt: `${reportPrompt.systemPrompt}\n\n${reportPrompt.userPrompt}`,
        maxTokens: this.config.report.maxOutputTokens,
      });

      this.finalReport += report.text;
      this.currentOutputLength += report.text.length;

      debugLog.push(`Final report: ${report.text}`);
      debugLog.push(`Current output length: ${this.currentOutputLength}`);

      isComplete = this.isReportComplete({ report: this.finalReport, continuationMarker: continuationMarker });

      debugLog.push(`Is complete: ${isComplete}`);
    }

    fs.writeFileSync("logs/final-report.md", this.finalReport);

    return this.finalReport;
  }

  // Helper to check if the report seems complete based on content
  private isReportComplete({ report, continuationMarker }: { report: string; continuationMarker: string }): boolean {
    // If report contains continuation marker, it's definitely not complete
    if (report.includes(continuationMarker)) {
      return false;
    }

    // check if the report reaches the target output length
    if (this.config.report.targetOutputLength && this.finalReport.length <= this.config.report.targetOutputLength) {
      return false;
    }

    // check if the report reaches the max output tokens
    if (this.config.report.maxOutputTokens && this.finalReport.length >= this.config.report.maxOutputTokens) {
      return true;
    }

    return true;
  }
}

export function createDeepResearch(config: Partial<typeof DEFAULT_CONFIG>) {
  return new DeepResearch(config);
}

// Default export
export default createDeepResearch;
