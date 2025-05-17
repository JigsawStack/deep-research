import AIProvider from "./provider/aiProvider";
import { ResearchSource, WebSearchResult } from "./types/types";

import { DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_BREADTH_CONFIG, DEFAULT_REPORT_CONFIG } from "./config/defaults";
import "dotenv/config";
import { JigsawProvider } from "./provider/jigsaw";
import fs from "fs";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { PROMPTS } from "./prompts/prompts";

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
  private continuationMarker: string = "[<---- CONTINUE ---->]";

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
    if (config.report && config.report.maxOutputTokens < config.report.targetOutputTokens) {
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

      return {
        subQueries,
        plan: result.object.plan,
      };
    } catch (error: any) {
      console.error(`Error generating research plan: ${error.message || error}`);
      throw new Error(`Research evaluation failed: ${error.message || "Unknown error"}`);
    }
  }

  public async generate(prompt: string) {
    const debugLog: string[] = [];
    debugLog.push(`Running research with prompt: ${prompt}`);
    this.topic = prompt;

    while (!this.isComplete && this.iterationCount < this.config.depth?.maxLevel) {
      this.iterationCount++;
      // step 1: generate research plan
      console.log(`[Step 1] Generating research plan... at ${this.iterationCount}`);
      debugLog.push(`[Step 1] Generating research plan... at ${this.iterationCount}`);
      const { subQueries, plan } = await this.generateResearchPlan();

      this.queries = [...(this.queries || []), ...subQueries];
      this.latestResearchPlan = plan;

      debugLog.push(`Research plan: ${plan}`);
      debugLog.push(`Research queries: ${subQueries.join("\n")}`);

      // step 2: fire web searches
      debugLog.push(`[Step 2] Running initial web searches with ${subQueries.length} queries...`);
      console.log(`[Step 2] Running initial web searches with ${subQueries.length} queries...`);

      const initialSearchResults = await this.jigsaw.fireWebSearches(subQueries);
      console.log(`Received ${initialSearchResults.length} initial search results`);
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
      console.log(`[Step 2.5] Deduplicating search results...`);
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
      console.log(`[Step 3] Reasoning about the search results...`);
      const reasoning = await this.reasoningSearchResults();
      debugLog.push(`Reasoning: ${reasoning}`);

      // step 4: decision making
      debugLog.push(`[Step 4] Decision making...`);
      console.log(`[Step 4] Decision making...`);
      const decisionMaking = await this.decisionMaking({ reasoning });
      debugLog.push(`Decision making: ${decisionMaking.isComplete} ${decisionMaking.reason}`);

      const { isComplete, reason } = decisionMaking;
      this.isComplete = isComplete;
      this.latestReasoning = reason;
    }

    // step 5: generating report
    debugLog.push(`[Step 5] Generating report...`);
    console.log(`[Step 5] Generating report...`);

    const { report, debugLog: finalDebugLog } = await this.generateFinalReport(debugLog);

    // Write debug log to file
    fs.writeFileSync("logs/debug.md", finalDebugLog.join("\n"));
    fs.writeFileSync("logs/finalReport.md", report);

    return report;
  }

  private async decisionMaking({ reasoning }: { reasoning: string }) {
    const decisionMakingPrompt = PROMPTS.decisionMaking({
      reasoning,
      targetOutputTokens: this.config.report.targetOutputTokens,
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

  // ⛏ helper – remove marker and tell the caller if it was present
  private stripMarker(text: string, marker: string): [string, boolean] {
    const idx = text.indexOf(marker);
    if (idx === -1) return [text, false];
    return [text.slice(0, idx).trimEnd(), true];
  }

  private async generateFinalReport(debugLog: string[]) {
    let isComplete = false;

    while (!isComplete) {
      /* build fresh prompt */
      const prompt = PROMPTS.finalReport({
        topic: this.topic,
        latestResearchPlan: this.latestResearchPlan,
        sources: this.sources,
        queries: this.queries,
        latestReasoning: this.latestReasoning,
        maxOutputTokens: this.config.report.maxOutputTokens,
        targetOutputTokens: this.config.report.targetOutputTokens,
        continuationMarker: this.continuationMarker,
        currentReport: this.finalReport,
        currentOutputLength: this.currentOutputLength,
      });

      const messages: Parameters<typeof generateText>[0]["messages"] = [
        { role: "system", content: prompt.systemPrompt },
        { role: "user", content: prompt.userPrompt },
      ];
      if (this.finalReport.trim()) {
        messages.push({ role: "assistant", content: this.finalReport.slice(-4000) });
      }

      /* call model */
      const { text: rawChunk } = await generateText({
        model: this.aiProvider.getOutputModel(),
        maxTokens: this.config.report.maxOutputTokens,
        messages,
      });
      if (!rawChunk.trim()) throw new Error("Empty chunk");

      debugLog.push(`[Step 5] Final report raw chunks: ${this.finalReport.length} ${rawChunk}\n`);

      /* remove marker if present */
      const [chunk, hadMarker] = this.stripMarker(rawChunk, this.continuationMarker);

      this.finalReport += chunk;
      this.currentOutputLength = this.finalReport.length;

      console.log(`[Step 5] Final report chunks: ${this.finalReport.length} ${chunk}\n`);

      /* done when: marker seen & stripped, and length target met or max tokens reached */
      isComplete =
        (!hadMarker && this.finalReport.length >= this.config.report.targetOutputTokens * 5) ||
        this.finalReport.length >= this.config.report.maxOutputTokens;

      debugLog.push(`[Step 5] Final report is complete: ${isComplete}`);
    }

    if (!isComplete) throw new Error("Report hit iteration cap without finishing");

    return { report: this.finalReport, debugLog };
  }
}

export function createDeepResearch(config: Partial<typeof DEFAULT_CONFIG>) {
  return new DeepResearch(config);
}

// Default export
export default createDeepResearch;
