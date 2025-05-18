import AIProvider from "./provider/aiProvider";
import { ResearchSource, WebSearchResult } from "./types/types";

import { DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_BREADTH_CONFIG, DEFAULT_REPORT_CONFIG } from "./config/defaults";
import "dotenv/config";
import { JigsawProvider } from "./provider/jigsaw";
import fs from "fs";
import { generateObject, generateText, LanguageModelV1 } from "ai";
import { z } from "zod";
import { buildContinuationPrompt, buildInitialPrompt, PROMPTS } from "./prompts/prompts";

// **TODO**
// make everything functional by passing parameters instead of using class variables

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
  private completionMarker: string = "[<---- COMPLETE ---->]";

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
  private deduplicateSearchResults({ sources }: { sources: WebSearchResult[] }): WebSearchResult[] {
    const urlMap = new Map<string, boolean>();

    return sources.map((result) => {
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

  private async generateResearchPlan({
    model,
    topic,
    pastReasoning,
    pastQueries,
    maxDepth,
  }: { model: LanguageModelV1; topic: string; pastReasoning: string; pastQueries: string[]; maxDepth: number }) {
    try {
      // Generate the research plan using the AI provider
      const result = await generateObject({
        model,
        output: "object",
        schema: z.object({
          subQueries: z.array(z.string()).describe("A list of search queries to thoroughly research the topic"),
          plan: z.string().describe("A detailed plan explaining the research approach and methodology"),
        }),

        // **TODO**
        // pass in the past sources as well (TEST IT OUT)
        prompt: PROMPTS.research({
          topic,
          pastReasoning,
          pastQueries,
          maxDepth,
        }),
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

    do {
      this.iterationCount++;
      // step 1: generate research plan
      console.log(`[Step 1] Generating research plan... at ${this.iterationCount}`);
      debugLog.push(`[Step 1] Generating research plan... at ${this.iterationCount}`);
      const { subQueries, plan } = await this.generateResearchPlan({
        model: this.aiProvider.getDefaultModel(),
        topic: this.topic,
        pastReasoning: this.latestReasoning,
        pastQueries: this.queries,
        maxDepth: this.config.depth?.maxLevel,
      });

      this.queries = [...(this.queries || []), ...subQueries];
      this.latestResearchPlan = plan;

      debugLog.push(`Research plan: ${plan}`);
      debugLog.push(`Research queries: ${subQueries.join("\n")}`);

      // step 2: fire web searches
      debugLog.push(`[Step 2] Running initial web searches with ${subQueries.length} queries...`);
      console.log(`[Step 2] Running initial web searches with ${subQueries.length} queries...`);

      const initialSearchResults = await this.jigsaw.fireWebSearches(subQueries);
      console.log(`Received ${initialSearchResults.length} initial search results`);

      // step 2.5: deduplicate results
      debugLog.push(`[Step 2.5] Deduplicating search results...`);
      console.log(`[Step 2.5] Deduplicating search results...`);

      this.sources = [...this.sources, ...initialSearchResults];

      const deduplicatedResults = this.deduplicateSearchResults({ sources: this.sources });

      // save it to the class for later use
      this.sources = deduplicatedResults;

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

      fs.writeFileSync("logs/sources.json", JSON.stringify(this.sources, null, 2));
      fs.writeFileSync("logs/queries.json", JSON.stringify(this.queries, null, 2));
      fs.writeFileSync("logs/reasoning.json", JSON.stringify(reasoning, null, 2));
      fs.writeFileSync("logs/decisionMaking.json", JSON.stringify(decisionMaking, null, 2));
      fs.writeFileSync("logs/researchPlan.json", JSON.stringify(this.latestResearchPlan, null, 2));

      const { isComplete, reason } = decisionMaking;
      this.isComplete = isComplete;
      this.latestReasoning = reason;
    } while (!this.isComplete && this.iterationCount < this.config.depth?.maxLevel);

    // step 5: generating report
    debugLog.push(`[Step 5] Generating report...`);
    console.log(`[Step 5] Generating report...`);

    const { report, debugLog: finalDebugLog } = await this.generateFinalReport({
      sources: this.sources,
      topic: this.topic,
      targetTokens: this.config.report.targetOutputTokens,
      model: this.aiProvider.getOutputModel(),
      continuationMarker: this.continuationMarker,
      completionMarker: this.completionMarker,
      debugLog: debugLog,
      latestReasoning: this.latestReasoning,
      latestResearchPlan: this.latestResearchPlan,
      queries: this.queries,
    });

    // Write debug log to file
    fs.writeFileSync("logs/debug.md", finalDebugLog.join("\n"));
    fs.writeFileSync("logs/finalReport.md", report);

    return report;
  }

  public async testGenerate() {
    // Load data from logs folder
    const sources = JSON.parse(fs.readFileSync("logs/sources.json", "utf-8"));
    const topic = "what is determinism and why is it the best explanation for the universe?";
    const targetTokens = this.config.report.targetOutputTokens;
    const latestResearchPlan = JSON.parse(fs.readFileSync("logs/researchPlan.json", "utf-8"));
    const latestReasoning = JSON.parse(fs.readFileSync("logs/reasoning.json", "utf-8"));
    const queries = JSON.parse(fs.readFileSync("logs/queries.json", "utf-8"));

    // Generate the final report using the loaded data
    const { report, debugLog } = await this.generateFinalReport({
      sources,
      topic,
      targetTokens,
      model: this.aiProvider.getOutputModel(),
      continuationMarker: this.continuationMarker,
      completionMarker: this.completionMarker,
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
      // **TODO** DOUBLE CHECK if the thinking tag is contained in the result check OMIAI
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
  private stripMarker(text: string, marker: string): [string, boolean, boolean] {
    const continueIdx = text.indexOf(marker);
    const completeIdx = text.indexOf(marker.replace("CONTINUE", "COMPLETE"));

    if (completeIdx !== -1) {
      // Report is explicitly marked as complete
      return [text.slice(0, completeIdx).trimEnd(), false, true];
    }

    if (continueIdx !== -1) {
      // Report needs to continue
      return [text.slice(0, continueIdx).trimEnd(), true, false];
    }

    // No markers found
    return [text, false, false];
  }

  private async generateFinalReport({
    sources,
    topic,
    targetTokens,
    model,
    continuationMarker,
    completionMarker,
    debugLog,
    latestReasoning,
    latestResearchPlan,
    queries,
  }: {
    sources: WebSearchResult[];
    topic: string;
    targetTokens: number;
    model: LanguageModelV1;
    continuationMarker: string;
    completionMarker: string;
    debugLog: string[];
    latestReasoning: string;
    latestResearchPlan: string;
    queries: string[];
  }) {
    let draft = "";
    let done = false;
    let iter = 0;

    while (!done && ++iter < 5) {
      // hard cap
      try {
        const base = {
          topic,
          sources,
          targetTokens,
          latestResearchPlan,
          latestReasoning,
          queries: sources.map((s) => s.searchResults.ai_overview).filter(Boolean) as string[],
        };
        const prompt = draft ? buildContinuationPrompt({ ...base, currentReport: draft, currentChars: draft.length }) : buildInitialPrompt(base);
        debugLog.push(`[Step 5] Generating final report... at ${iter}`);
        console.log(`[Step 5] Generating final report... at ${iter}`);

        const { text } = await generateText({
          model,
          system: prompt.system,
          prompt: prompt.user,
          stopSequences: prompt.stopSequences, // ✨ key line
        });

        if (!text.trim()) throw new Error("empty chunk");

        debugLog.push(`[Step 5] System Prompt: ${prompt.system}`);
        debugLog.push(`[Step 5] User Prompt: ${prompt.user}`);
        debugLog.push(`[Step 5] Generated text: ${text}`);
        fs.writeFileSync("logs/debug-log.md", debugLog.join("\n"));

        if (text.includes(completionMarker)) {
          draft += text.replace(completionMarker, "");
          done = true;
        } else if (text.includes(continuationMarker)) {
          draft += text.replace(continuationMarker, "");
        } else {
          // extremely unlikely: model forgot marker → ask again
          draft += text;
        }
      } catch (error: any) {
        console.error("Error in generateFinalReport:", error.message || error);
        debugLog.push(`[Step 5] ERROR: ${error.message || "Unknown error"}`);
        debugLog.push(`[Step 5] Error details: ${JSON.stringify(error)}`);
        fs.writeFileSync("debug-log.md", debugLog.join("\n"));
        throw error; // Re-throw to stop execution
      }
    }

    if (!done) throw new Error("iteration cap without DONE marker");

    fs.writeFileSync("final-report.md", draft.trim());
    return { report: draft, debugLog };
  }
}

export function createDeepResearch(config: Partial<typeof DEFAULT_CONFIG>) {
  return new DeepResearch(config);
}

// Default export
export default createDeepResearch;

//**TODO**
// return json
// text instead of report
// follow the standard
