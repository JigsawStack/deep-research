import AIProvider from "./provider/aiProvider";
import { WebSearchResult } from "./types/types";

import { DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_BREADTH_CONFIG, DEFAULT_REPORT_CONFIG } from "./config/defaults";
import "dotenv/config";
import { JigsawProvider } from "./provider/jigsaw";
import fs from "fs";
import { generateObject, generateText, LanguageModelV1 } from "ai";
import { z } from "zod";
import { CONT, DONE, PROMPTS, REPORT_DONE } from "./prompts/prompts";

export async function decisionMaking({
  reasoning,
  aiProvider,
  targetOutputTokens,
}: { reasoning: string; aiProvider: AIProvider; targetOutputTokens: number }) {
  const decisionMakingPrompt = PROMPTS.decisionMaking({
    reasoning,
    targetOutputTokens,
  });

  const decisionMakingResponse = await generateObject({
    model: aiProvider.getDefaultModel(),
    output: "object",
    schema: z.object({
      isComplete: z.boolean().describe("Whether the research is complete"),
      reason: z.string().describe("The reason for the decision"),
    }),
    prompt: decisionMakingPrompt,
  });

  return decisionMakingResponse.object;
}
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
      searchResults: sources,
      allQueries: queries,
    });

    const reasoningResponse = await generateText({
      model: aiProvider.getReasoningModel(),
      prompt: reasoningPrompt,
    });

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

export async function generateFinalReport({
  sources,
  topic,
  targetTokens,
  aiProvider,
  debugLog,
  latestReasoning,
  latestResearchPlan,
  queries,
}: {
  sources: WebSearchResult[];
  topic: string;
  targetTokens: number;
  aiProvider: AIProvider;
  debugLog: string[];
  latestReasoning: string;
  latestResearchPlan: string;
  queries: string[];
}) {
  let draft = "";
  let done = false;
  let iter = 0;
  // track which prompt we’re on
  let phase: "initial" | "continuation" | "citation" = "initial";

  do {
    console.log(`[Iteration ${iter}] phase=${phase}`);
    // build the shared base
    const base = {
      topic,
      sources,
      targetTokens,
      latestResearchPlan,
      latestReasoning,
      queries,
    };

    // pick the right prompt
    let promptConfig: {
      system: string;
      user: string;
      // stopSequences: string[];
    };

    if (phase === "initial") {
      promptConfig = PROMPTS.initFinalReport(base);
    } else if (phase === "continuation") {
      promptConfig = PROMPTS.continueFinalReport({
        ...base,
        currentReport: draft,
        currentOutputLength: draft.length,
      });
    } else {
      // bibliography-only pass
      promptConfig = PROMPTS.citation({ currentReport: draft });
    }

    debugLog.push(`\n[Iteration ${iter}] phase=${phase}`);
    debugLog.push("SYSTEM PROMPT:\n" + promptConfig.system);
    debugLog.push("USER PROMPT:\n" + promptConfig.user);

    // call the model
    const { text, finishReason } = await generateText({
      model: aiProvider.getOutputModel(),
      system: promptConfig.system,
      prompt: promptConfig.user,
      // stopSequences: promptConfig.stopSequences,
    });

    debugLog.push("MODEL OUTPUT:\n" + text);
    debugLog.push("FINISH REASON:\n" + finishReason);
    debugLog.push("PHASE==============================:\n" + phase);

    fs.writeFileSync("logs/debug-log.md", debugLog.join("\n"));

    if (phase !== "citation") {
      // look for our two markers
      if (text.includes(CONT)) {
        // still more body to come
        draft += text.replace(CONT, "");
        // after first initial chunk, always switch to continuation
        if (phase === "initial") phase = "continuation";
      } else if (text.includes(REPORT_DONE)) {
        // finished body + conclusion/biblio → move to citation pass
        draft += text.replace(REPORT_DONE, "");
        phase = "citation";
      } else {
        // no marker (should be rare) – just append
        draft += text;
      }
    } else {
      // citation pass: consume final DONE marker if present
      if (text.includes(DONE)) {
        draft += text.replace(DONE, "");
      } else {
        draft += text;
      }
      done = true;
    }

    // persist debug log each loop
    fs.writeFileSync("logs/debug-log.md", debugLog.join("\n"));

    iter++;
  } while (!done);

  // write out the final report
  fs.writeFileSync("logs/final-report.md", draft.trim());
  if (!done) throw new Error("Iteration cap reached without final completionMarker");

  return { report: draft, debugLog };
}

export function createDeepResearch(config: Partial<typeof DEFAULT_CONFIG>) {
  return new DeepResearch(config);
}

export async function generateResearchPlan({
  aiProvider,
  topic,
  pastReasoning,
  pastQueries,
  config,
  maxDepth,
}: { aiProvider: AIProvider; topic: string; pastReasoning: string; pastQueries: string[]; config: typeof DEFAULT_CONFIG; maxDepth: number }) {
  try {
    // Generate the research plan using the AI provider
    const result = await generateObject({
      model: aiProvider.getDefaultModel(),
      output: "object",
      schema: z.object({
        subQueries: z.array(z.string()).describe("A list of search queries to thoroughly research the topic"),
        plan: z.string().describe("A detailed plan explaining the research approach and methodology"),
        depth: z.number().describe("A number between 1-5, where 1 is surface-level and 5 is extremely thorough"),
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
    if (config.breadth?.maxParallelTopics && config.breadth?.maxParallelTopics > 0) {
      subQueries = subQueries.slice(0, config.breadth?.maxParallelTopics);
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

export function deduplicateSearchResults({ sources }: { sources: WebSearchResult[] }): WebSearchResult[] {
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
            };
          }),
      },
    };
  });
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

  public async generate(prompt: string) {
    const debugLog: string[] = [];
    debugLog.push(`Running research with prompt: ${prompt}`);
    this.topic = prompt;

    do {
      this.iterationCount++;
      // step 1: generate research plan
      console.log(`[Step 1] Generating research plan... at ${this.iterationCount}`);
      debugLog.push(`[Step 1] Generating research plan... at ${this.iterationCount}`);
      const { subQueries, plan } = await generateResearchPlan({
        aiProvider: this.aiProvider,
        topic: this.topic,
        pastReasoning: this.latestReasoning,
        pastQueries: this.queries,
        config: this.config,
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

      debugLog.push(`Reasoning: ${reasoning}`);

      // step 4: decision making
      debugLog.push(`[Step 4] Decision making...`);
      console.log(`[Step 4] Decision making...`);
      const deciding = await decisionMaking({
        reasoning,
        aiProvider: this.aiProvider,
        targetOutputTokens: this.config.report.targetOutputTokens,
      });
      debugLog.push(`Decision making: ${deciding.isComplete} ${deciding.reason}`);

      fs.writeFileSync("logs/sources.json", JSON.stringify(this.sources, null, 2));
      fs.writeFileSync("logs/queries.json", JSON.stringify(this.queries, null, 2));
      fs.writeFileSync("logs/reasoning.json", JSON.stringify(reasoning, null, 2));
      fs.writeFileSync("logs/decisionMaking.json", JSON.stringify(deciding, null, 2));
      fs.writeFileSync("logs/researchPlan.json", JSON.stringify(this.latestResearchPlan, null, 2));

      const { isComplete, reason } = deciding;
      this.isComplete = isComplete;
      this.latestReasoning = reason;
    } while (!this.isComplete && this.iterationCount < this.config.depth?.maxLevel);

    // step 5: generating report
    debugLog.push(`[Step 5] Generating report...`);
    console.log(`[Step 5] Generating report...`);

    const { report, debugLog: finalDebugLog } = await generateFinalReport({
      sources: this.sources,
      topic: this.topic,
      targetTokens: this.config.report.targetOutputTokens,
      aiProvider: this.aiProvider,
      debugLog: debugLog,
      latestReasoning: this.latestReasoning,
      latestResearchPlan: this.latestResearchPlan,
      queries: this.queries,
    });

    fs.writeFileSync("logs/debug.md", finalDebugLog.join("\n"));
    fs.writeFileSync("logs/finalReport.md", report);

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

  public async testFinalReportGeneration() {
    // Load data from logs folder
    const sources = JSON.parse(fs.readFileSync("logs/sources.json", "utf-8"));
    const topic = "what is determinism and why is it the best explanation for the universe?";
    const targetTokens = this.config.report.targetOutputTokens;
    const latestResearchPlan = JSON.parse(fs.readFileSync("logs/researchPlan.json", "utf-8"));
    const latestReasoning = JSON.parse(fs.readFileSync("logs/reasoning.json", "utf-8"));
    const queries = JSON.parse(fs.readFileSync("logs/queries.json", "utf-8"));

    // Generate the final report using the loaded data
    const { report, debugLog } = await generateFinalReport({
      sources,
      topic,
      targetTokens,
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
