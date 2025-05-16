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
    console.log(`Running research with prompt: ${prompt}`);
    this.topic = prompt;

    while (!this.isComplete && this.iterationCount < this.config.depth?.maxLevel) {
      this.iterationCount++;
      // step 1: generate research plan
      console.log(`[Step 1] Generating research plan...`);
      const { subQueries, plan } = await this.generateResearchPlan();

      this.queries = [...(this.queries || []), ...subQueries];
      this.latestResearchPlan = plan;

      console.log(`Research plan: ${plan}`);
      console.log(`Research queries: ${subQueries.join("\n")}`);

      // step 2: fire web searches
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

      console.log(`After deduplication: ${dedupSourceCount} sources (${uniqueUrls.size} unique URLs)`);

      // step 3: reasoning about the search results
      console.log(`[Step 3] Reasoning about the search results...`);
      const reasoning = await this.reasoningSearchResults();
      console.log(`Reasoning: ${reasoning}`);

      // step 4: decision making
      console.log(`[Step 4] Decision making...`);
      const decisionMaking = await this.decisionMaking({ reasoning });
      console.log(`Decision making: ${decisionMaking}`);

      const { isComplete, reason } = decisionMaking;
      this.isComplete = isComplete;
      this.latestReasoning = reason;
    }

    // step 5: generating report
    console.log(`[Step 5] Generating report...`);

    const reportStartTime = Date.now();

    const finalReport = await this.generateFinalReport();

    const reportDuration = Date.now() - reportStartTime;
    console.log(`Final report generated in ${reportDuration}ms`);

    // Write detailed logs
    this.writeLogs(finalReport);

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
  private async generateFinalReport() {
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

    // Debug: Write the final report system and user prompts to files
    writeDebugFile("final-report", "final-report-system-prompt.md", reportPrompt.systemPrompt);
    writeDebugFile("final-report", "final-report-user-prompt.md", reportPrompt.userPrompt);
    writeDebugFile("final-report", "final-report-config.json", {
      maxOutputTokens: this.config.report.maxOutputTokens,
      targetOutputLength: this.config.report.targetOutputLength,
    });

    let isComplete = false;

    while (!isComplete) {
      const report = await generateText({
        model: this.aiProvider.getOutputModel(),
        prompt: `${reportPrompt.systemPrompt}\n\n${reportPrompt.userPrompt}`,
        maxTokens: this.config.report.maxOutputTokens,
      });

      this.finalReport += report.text;
      this.currentOutputLength += report.text.length;

      isComplete = this.isReportComplete({ report: this.finalReport, continuationMarker: continuationMarker });
    }

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

  public async writeLogs(finalReport?: any) {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync("logs")) {
      fs.mkdirSync("logs", { recursive: true });
    }

    // Write final report
    if (finalReport) {
      fs.writeFileSync("logs/final_report.json", JSON.stringify(finalReport, null, 2));

      if (finalReport.report) {
        fs.writeFileSync("logs/final_report.md", finalReport.report);
      }
    }

    // Log information about the research process
    try {
      // Look for search results data
      const searchResultsPath = "logs/search_results.json";
      if (fs.existsSync(searchResultsPath)) {
        const searchResults = JSON.parse(fs.readFileSync(searchResultsPath, "utf8"));

        // Extract sources from search results
        const sources: ResearchSource[] = [];
        if (Array.isArray(searchResults)) {
          searchResults.forEach((result) => {
            if (result.searchResults && result.searchResults.results) {
              result.searchResults.results.forEach((source: ResearchSource) => {
                // Only add unique s
                if (source.url && !sources.some((s) => s.url === source.url)) {
                  sources.push({
                    url: source.url,
                    title: source.title || "Unknown Title",
                    domain: source.domain || new URL(source.url).hostname,
                    ai_overview: source.ai_overview || "",
                    isAcademic: source.isAcademic,
                  });
                }
              });
            }
          });

          // Write sources to file
          fs.writeFileSync("logs/sources.json", JSON.stringify(sources, null, 2));

          // Create a markdown version of sources for easy reference
          let sourcesMd = "# Research Sources\n\n";
          sourcesMd += `Total sources: ${sources.length}\n\n`;

          sources.forEach((source, index) => {
            sourcesMd += `## [${index + 1}] ${source.title}\n\n`;
            sourcesMd += `- URL: ${source.url}\n`;
            sourcesMd += `- Domain: ${source.domain}\n`;
            sourcesMd += `- Academic: ${source.isAcademic ? "Yes" : "No"}\n\n`;

            if (source.ai_overview) {
              sourcesMd += `### Overview\n\n${source.ai_overview}\n\n`;
            }

            sourcesMd += "---\n\n";
          });

          fs.writeFileSync("logs/sources.md", sourcesMd);
        }
      }

      // Create a research summary
      let summaryMd = "# Research Summary\n\n";

      if (finalReport && finalReport.report) {
        const reportPreview = finalReport.report.substring(0, 500) + "...";
        summaryMd += `## Final Report Preview\n\n${reportPreview}\n\n`;
      }

      // Add information about sources if available
      const sourcesPath = "logs/sources.json";
      if (fs.existsSync(sourcesPath)) {
        const sources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
        summaryMd += `## Sources\n\nTotal sources: ${sources.length}\n\n`;

        // Count domains
        const domains: Record<string, number> = {};
        sources.forEach((source: ResearchSource) => {
          const domain = source.domain || "unknown";
          domains[domain] = (domains[domain] || 0) + 1;
        });

        summaryMd += "### Top Domains\n\n";
        Object.entries(domains)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .forEach(([domain, count]) => {
            summaryMd += `- ${domain}: ${count}\n`;
          });
      }

      // Add detailed stats from research log
      if (fs.existsSync("logs/research_log.json")) {
        const researchLog = JSON.parse(fs.readFileSync("logs/research_log.json", "utf8"));
        if (researchLog.metrics) {
          const metrics = researchLog.metrics;
          const processingTime = metrics.processingTime;

          summaryMd += `\n## Performance Metrics\n\n`;
          summaryMd += `- Total processing time: ${Math.round(processingTime.total / 1000)} seconds\n`;
          summaryMd += `- Iterations: ${metrics.iterations}\n`;
          summaryMd += `- Total queries: ${metrics.totalQueries}\n`;
          summaryMd += `- Sources analyzed: ${metrics.totalSources}\n`;
          summaryMd += `- Unique sources: ${metrics.uniqueSources}\n`;

          // Add detailed breakdown of steps
          if (researchLog.steps && researchLog.steps.length > 0) {
            summaryMd += `\n## Research Process Breakdown\n\n`;

            // Timeline of steps
            summaryMd += `### Timeline\n\n`;
            summaryMd += `| Step | Start Time | Duration |\n`;
            summaryMd += `| ---- | ---------- | -------- |\n`;

            researchLog.steps.forEach((step: ResearchStep, index: number) => {
              const startTime = new Date(step.timestamp);
              let endTime;
              let duration = "N/A";

              if (index < researchLog.steps.length - 1) {
                endTime = new Date(researchLog.steps[index + 1].timestamp);
                const durationMs = endTime.getTime() - startTime.getTime();
                duration = `${Math.round(durationMs / 1000)} seconds`;
              }

              summaryMd += `| ${step.step} | ${startTime.toLocaleTimeString()} | ${duration} |\n`;
            });

            // Query details
            if (researchLog.steps[0]?.details?.queries) {
              summaryMd += `\n### Initial Queries\n\n`;
              researchLog.steps[0].details.queries.forEach((query: string, index: number) => {
                summaryMd += `${index + 1}. ${query}\n`;
              });
            }

            // Iteration details
            const iterativeStep = researchLog.steps.find((s: ResearchStep) => s.step === "Iterative Research");
            if (iterativeStep && iterativeStep.iterations && iterativeStep.iterations.length > 0) {
              summaryMd += `\n### Iterations\n\n`;

              iterativeStep.iterations.forEach((iteration: ResearchIteration) => {
                summaryMd += `#### Iteration ${iteration.iterationNumber}\n\n`;
                summaryMd += `- Timestamp: ${new Date(iteration.timestamp).toLocaleString()}\n`;
                summaryMd += `- Complete: ${iteration.isComplete ? "Yes" : "No"}\n`;
                summaryMd += `- Processing time: ${Math.round(iteration.evaluationTime / 1000)} seconds\n`;

                if (iteration.additionalQueries > 0) {
                  summaryMd += `- Additional queries: ${iteration.additionalQueries}\n`;
                }

                if (iteration.newSearchResults !== undefined) {
                  summaryMd += `- New search results: ${iteration.newSearchResults}\n`;
                  summaryMd += `- New sources: ${iteration.newSources}\n`;
                  summaryMd += `- Search time: ${Math.round((iteration.searchTime || 0) / 1000)} seconds\n`;
                }

                summaryMd += `\n**Reasoning**: ${iteration.reason}\n\n`;
              });
            }

            // Synthesis and final report metrics
            const synthesisStep = researchLog.steps.find((s: ResearchStep) => s.step === "Synthesis");
            if (synthesisStep && synthesisStep.details) {
              summaryMd += `\n### Synthesis\n\n`;
              summaryMd += `- Processing time: ${Math.round(synthesisStep.details.synthesisTime / 1000)} seconds\n`;
              summaryMd += `- Synthesis length: ${synthesisStep.details.synthesisLength} characters\n`;
            }

            const reportStep = researchLog.steps.find((s: ResearchStep) => s.step === "Final Report Generation");
            if (reportStep && reportStep.details) {
              summaryMd += `\n### Final Report\n\n`;
              summaryMd += `- Processing time: ${Math.round(reportStep.details.reportTime / 1000)} seconds\n`;
              summaryMd += `- Report length: ${reportStep.details.reportLength} characters\n`;
            }
          }
        }
      }

      fs.writeFileSync("logs/research_summary.md", summaryMd);

      // Create a separate detailed stats file
      if (fs.existsSync("logs/research_log.json")) {
        const researchLog = JSON.parse(fs.readFileSync("logs/research_log.json", "utf8"));
        const statsOutput = {
          summary: {
            prompt: researchLog.prompt,
            timestamp: researchLog.timestamp,
            totalTime: researchLog.metrics?.processingTime?.total,
            iterations: researchLog.metrics?.iterations,
            totalQueries: researchLog.metrics?.totalQueries,
            totalSources: researchLog.metrics?.totalSources,
          },
          steps: researchLog.steps,
          config: this.config,
        };

        fs.writeFileSync("logs/research_stats.json", JSON.stringify(statsOutput, null, 2));
      }
    } catch (error) {
      console.error("Error generating log files:", error);
    }
  }
}

export function createDeepResearch(config: Partial<typeof DEFAULT_CONFIG>) {
  return new DeepResearch(config);
}

// Default export
export default createDeepResearch;
