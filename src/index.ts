import AIProvider from "./provider/aiProvider";
import { DeepResearchConfig, ResearchSource, WebSearchResult } from "./types/types";

import { DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_BREADTH_CONFIG, DEFAULT_SYNTHESIS_CONFIG } from "./config/defaults";
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
  public config: DeepResearchConfig;
  public prompts?: string;
  public topic?: string;
  private sources: WebSearchResult[] = [];
  private aiProvider: AIProvider;
  private jigsaw: JigsawProvider;

  constructor(config: Partial<DeepResearchConfig>) {
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

  public validateConfig(config: Partial<DeepResearchConfig>): DeepResearchConfig {
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
      synthesis: {
        ...DEFAULT_SYNTHESIS_CONFIG,
        ...(config.synthesis || {}),
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
  private async generateResearchPlan(topic: string, aiProvider: AIProvider, maxQueries?: number): Promise<{ queries: string[]; plan: string }> {
    try {
      // Generate the research plan using the AI provider
      const result = await generateObject({
        model: aiProvider.getDefaultModel(),
        output: "object",
        schema: z.object({
          queries: z.array(z.string()).describe("A list of search queries to thoroughly research the topic"),
          plan: z.string().describe("A detailed plan explaining the research approach and methodology"),
        }),
        prompt: PROMPTS.research({ topic }),
      });

      let queries = result.object.queries;

      // Limit queries if maxQueries is specified
      if (maxQueries && maxQueries > 0) {
        queries = queries.slice(0, maxQueries);
      }
      console.log(`Generated ${queries.length} research queries`);

      // Debug: Write the research plan to a file
      writeDebugFile("research-plan", "research-plan.json", result.object);
      writeDebugFile(
        "research-plan",
        "research-plan.md",
        `# Research Plan\n\n## Topic\n${topic}\n\n## Plan\n${result.object.plan}\n\n## Queries\n${result.object.queries
          .map((q: string, i: number) => `${i + 1}. ${q}`)
          .join("\n")}`
      );

      return {
        queries,
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
          if (extracted && "queries" in extracted && Array.isArray(extracted.queries) && "plan" in extracted && typeof extracted.plan === "string") {
            let queries = extracted.queries;
            if (maxQueries && maxQueries > 0) {
              queries = queries.slice(0, maxQueries);
            }
            console.log(`Generated ${queries.length} research queries from extracted JSON`);
            // Debug: Write the extracted research plan to a file
            writeDebugFile("research-plan", "research-plan-extracted.json", extracted);
            writeDebugFile(
              "research-plan",
              "research-plan-extracted.md",
              `# Extracted Research Plan\n\n## Topic\n${topic}\n\n## Plan\n${extracted.plan}\n\n## Queries\n${extracted.queries
                .map((q: string, i: number) => `${i + 1}. ${q}`)
                .join("\n")}`
            );
            return {
              queries,
              plan: extracted.plan,
            };
          }
        } catch (extractError) {
          console.error("Failed to extract JSON:", extractError);
        }
      }

      // Fallback response
      const defaultQueries = [topic, `${topic} research`, `${topic} analysis`, `${topic} examples`, `${topic} implications`];
      const limitedQueries = maxQueries && maxQueries > 0 ? defaultQueries.slice(0, maxQueries) : defaultQueries;

      // Debug: Write the fallback research plan to a file
      writeDebugFile("research-plan", "research-plan-fallback.json", {
        topic,
        defaultQueries: limitedQueries,
        plan: `Basic research plan: Conduct a thorough search for information about "${topic}" using multiple angles and perspectives.`,
      });
      writeDebugFile(
        "research-plan",
        "research-plan-fallback.md",
        `# Fallback Research Plan\n\n## Topic\n${topic}\n\n## Plan\nBasic research plan: Conduct a thorough search for information about "${topic}" using multiple angles and perspectives.\n\n## Queries\n${limitedQueries
          .map((q, i) => `${i + 1}. ${q}`)
          .join("\n")}`
      );

      return {
        queries: limitedQueries, // Return topic and variations as fallback queries
        plan: `Basic research plan: Conduct a thorough search for information about "${topic}" using multiple angles and perspectives.`,
      };
    }
  }

  public async generate(prompt: string) {
    console.log(`Running research with prompt: ${prompt}`);
    this.topic = prompt;
    this.prompts = prompt;

    // step 1: generate research plan
    console.log(`[Step 1] Generating research plan...`);
    const { queries, plan } = await this.generateResearchPlan(prompt, this.aiProvider, this.config.breadth?.maxParallelTopics);

    console.log(`Research plan: ${plan}`);
    console.log(`Research queries: ${queries.join("\n")}`);

    // step 2: fire web searches
    console.log(`[Step 2] Running initial web searches with ${queries.length} queries...`);

    const jigsaw = JigsawProvider.getInstance(this.config.jigsawApiKey);
    const initialSearchResults = await jigsaw.fireWebSearches(queries);
    console.log(`Received ${initialSearchResults.length} initial search results`);

    // Count sources from initial results
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

    // step 3: iteratively search until we have enough results
    console.log(`[Step 3] Starting iterative research...`);
    const iterativeResult = await this.performIterativeResearch({
      prompt,
      researchPlan: plan,
      initialResults: deduplicatedResults,
      allQueries: queries,
    });

    console.log(`Iterative research completed with ${iterativeResult.iterationCount} iterations`);
    console.log(`Total queries used: ${iterativeResult.queriesUsed.length}`);
    console.log(`Final search results: ${iterativeResult.finalSearchResults.length}`);

    // step 4: synthesize results
    console.log(`[Step 4] Synthesizing results...`);

    const synthesisStartTime = Date.now();
    const synthesizedResults = await this.synthesizeResults({
      searchResults: iterativeResult.finalSearchResults,
    });

    const synthesisDuration = Date.now() - synthesisStartTime;
    console.log(`Synthesis completed in ${synthesisDuration}ms`);

    // step 5: generate a final report
    console.log(`[Step 5] Generating final report...`);

    const reportStartTime = Date.now();

    const finalReport = await this.generateFinalReport({
      prompt,
      researchPlan: plan,
      searchResults: iterativeResult.finalSearchResults,
      synthesizedResults,
    });

    const reportDuration = Date.now() - reportStartTime;
    console.log(`Final report generated in ${reportDuration}ms`);

    // Write detailed logs
    this.writeLogs(finalReport);

    return finalReport;
  }

  // Add debug logging to evaluateResearchCompleteness method
  private async evaluateResearchCompleteness(prompt: string, researchPlan: string, results: WebSearchResult[], allQueries: string[]) {
    try {
      console.log(`  Starting research completeness evaluation...`);
      // Create a simplified summary of the search results
      const topicsCovered = new Set<string>();
      const domains = new Set<string>();
      let totalSources = 0;

      // Extract key information
      results.forEach((result) => {
        if (result.searchResults && result.searchResults.ai_overview) {
          topicsCovered.add(result.question);
        }

        if (result.searchResults && result.searchResults.results) {
          totalSources += result.searchResults.results.length;

          result.searchResults.results.forEach((item) => {
            if (item.domain) domains.add(item.domain);
          });
        }
      });

      // Create a summary
      const resultsSummary = `
- Total queries completed: ${results.length}
- Total sources found: ${totalSources}
- Unique domains: ${domains.size}
- Topics covered: ${Array.from(topicsCovered).join(", ")}

Topics addressed in search:
${Array.from(topicsCovered)
  .map((topic) => `- ${topic}`)
  .join("\n")}
      `;

      console.log(`  Generated research summary with ${totalSources} sources from ${domains.size} domains`);

      // Generate evaluation with clear instructions for formatting
      console.log(`  Generating evaluation...`);
      const evaluationPrompt = PROMPTS.evaluation({
        prompt,
        researchPlan,
        allQueries,
        resultsSummary,
      });

      // Debug: Write the evaluation prompt to a file
      writeDebugFile("evaluation", `evaluation-prompt-${Date.now()}.md`, evaluationPrompt);

      const evaluationResponse = await generateText({
        model: this.aiProvider.getReasoningModel(),
        prompt: evaluationPrompt,
      });

      // Debug: Write the evaluation response to a file
      writeDebugFile("evaluation", `evaluation-response-${Date.now()}.md`, evaluationResponse.text);

      // Access the content, handling both text property and reasoning if available
      let evaluationText = evaluationResponse.text;

      // Log reasoning if it exists (some models provide this)
      if (evaluationResponse.reasoning) {
        console.log(`  Model reasoning (not used in final output): ${evaluationResponse.reasoning.substring(0, 100)}...`);
      }

      // Clean up the response: remove thinking/reasoning tags and other markup
      evaluationText = evaluationText
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/g, "")
        .replace(/<[^>]*>/g, "")
        .trim();

      console.log(`  Received clean evaluation text (${evaluationText.length} chars)`);
      console.log(`  Evaluation preview: ${evaluationText.substring(0, 150)}...`);

      // Extract the formatted response using regex
      const isCompleteMatch = evaluationText.match(/IS_COMPLETE:\s*(true|false)/i);
      const isComplete = isCompleteMatch ? isCompleteMatch[1].toLowerCase() === "true" : false;

      // Extract reason
      const reasonMatch = evaluationText.match(/REASON:\s*(.*?)(?=QUERIES:|$)/s);
      const reason = reasonMatch ? reasonMatch[1].trim() : "";

      // Extract queries array
      const queriesMatch = evaluationText.match(/QUERIES:\s*(\[.*?\])/s);
      let queries = [];

      if (queriesMatch) {
        try {
          // Try to parse the JSON array
          queries = JSON.parse(queriesMatch[1]);
        } catch (e: any) {
          console.error(`  Error parsing queries JSON: ${e.message}`);
          // Fallback to regex extraction of quoted strings
          const quotedStrings = queriesMatch[1].match(/"([^"]*)"/g);
          if (quotedStrings) {
            queries = quotedStrings.map((str) => str.replace(/"/g, ""));
          }
        }
      }

      const result = {
        isComplete,
        reason,
        queries: Array.isArray(queries) ? queries : [],
      };

      // Debug: Write the parsed evaluation result to a file
      writeDebugFile("evaluation", `evaluation-result-${Date.now()}.json`, result);

      console.log(`  Parsed evaluation result: isComplete=${result.isComplete}, queries=${result.queries.length}`);
      return result;
    } catch (error: any) {
      console.error("Fatal error in evaluateResearchCompleteness:", error.message || error);
      console.error(`  Error details:`, error);

      // Throw the error to terminate program execution
      throw new Error(`Research evaluation failed: ${error.message || "Unknown error"}`);
    }
  }

  private async performIterativeResearch({
    prompt,
    researchPlan,
    initialResults,
    allQueries,
  }: {
    prompt: string;
    researchPlan: string;
    initialResults: WebSearchResult[];
    allQueries: string[];
  }) {
    let searchResults = initialResults;
    let iterationCount = 0;
    let totalNewQueries = 0;

    for (let i = 0; i < (this.config.depth?.maxLevel || 3); i++) {
      iterationCount++;
      console.log(`  [Iteration ${iterationCount}] Evaluating research completeness...`);

      const evaluation = await this.evaluateResearchCompleteness(prompt, researchPlan, searchResults, allQueries);

      if (evaluation.isComplete) {
        console.log(`  Research evaluation complete (iteration ${iterationCount}): No additional queries needed`);
        console.log(`  Reason: ${evaluation.reason}`);
        break;
      }

      const newQueries = evaluation.queries;
      totalNewQueries += newQueries.length;

      console.log(`  Adding ${newQueries.length} new queries: ${newQueries.join(", ")}`);
      console.log(`  Executing additional searches...`);

      const searchStartTime = Date.now();
      const newResults = await this.jigsaw.fireWebSearches(newQueries);
      const searchTime = Date.now() - searchStartTime;

      // Count new sources
      let newSourceCount = 0;
      let uniqueUrls = new Set();
      newResults.forEach((result) => {
        if (result.searchResults && result.searchResults.results) {
          newSourceCount += result.searchResults.results.length;
          result.searchResults.results.forEach((item) => {
            if (item.url) uniqueUrls.add(item.url);
          });
        }
      });

      console.log(`  Retrieved ${newResults.length} new search results with ${newSourceCount} sources in ${searchTime}ms`);

      searchResults = [...searchResults, ...newResults];
      allQueries = [...allQueries, ...newQueries];
    }

    return {
      finalSearchResults: searchResults,
      queriesUsed: allQueries,
      iterationCount,
    };
  }

  // Add debug logging to synthesizeResults method
  private async synthesizeResults({
    searchResults,
  }: {
    searchResults: WebSearchResult[];
  }) {
    // Truncate results to fit within model's context length
    // const summary = await this.summarizeResultsForSynthesis(searchResults);

    try {
      console.log(`  Starting research synthesis...`);

      if (!this.prompts) {
        throw new Error("No prompts provided");
      }

      const synthesisPrompt = PROMPTS.synthesis({
        topic: this.prompts,
        searchResults,
      });

      // Debug: Write the synthesis prompt to a file
      writeDebugFile("synthesis", "synthesis-prompt.md", synthesisPrompt);

      const synthesisResponse = await generateText({
        model: this.aiProvider.getReasoningModel(),
        prompt: synthesisPrompt,
      });

      // Debug: Write the raw synthesis response to a file
      writeDebugFile("synthesis", "synthesis-raw-response.md", synthesisResponse.text);

      // Access the content, handling both text property
      let synthesisText = synthesisResponse.text;

      // Log reasoning if it exists (some models provide this)
      if (synthesisResponse.reasoning) {
        console.log(`  Model reasoning (not used in final output): ${synthesisResponse.reasoning.substring(0, 100)}...`);
      }

      // Clean up the response: remove thinking/reasoning tags and other markup
      synthesisText = synthesisText
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/g, "")
        .replace(/<[^>]*>/g, "")
        .trim();

      console.log(`  Synthesis complete (${synthesisText.length} chars)`);
      console.log(`  Synthesis preview: ${synthesisText.substring(0, 150)}...`);

      // Debug: Write the cleaned synthesis to a file
      writeDebugFile("synthesis", "synthesis-cleaned.md", synthesisText);

      return synthesisText;
    } catch (error: any) {
      console.error("Fatal error in synthesizeResults:", error.message || error);
      console.error(`  Error details:`, error);

      // Throw the error to terminate program execution
      throw new Error(`Research synthesis failed: ${error.message || "Unknown error"}`);
    }
  }

  // Add debug logging to generateFinalReport method
  private async generateFinalReport({
    prompt,
    researchPlan,
    searchResults,
    synthesizedResults,
  }: {
    prompt: string;
    researchPlan: string;
    searchResults: WebSearchResult[];
    synthesizedResults: string;
  }) {
    // Use researchPlan in debug output to avoid "declared but never read" warning
    writeDebugFile("final-report", "research-plan.md", researchPlan);

    const reportPrompt = PROMPTS.finalReport({
      topic: prompt,
      searchResults,
      synthesis: synthesizedResults,
      maxOutputTokens: this.config.synthesis?.maxOutputTokens,
      targetOutputLength: this.config.synthesis?.targetOutputLength,
    });

    // Debug: Write the final report system and user prompts to files
    writeDebugFile("final-report", "final-report-system-prompt.md", reportPrompt.systemPrompt);
    writeDebugFile("final-report", "final-report-user-prompt.md", reportPrompt.userPrompt);
    writeDebugFile("final-report", "final-report-config.json", {
      maxOutputTokens: this.config.synthesis?.maxOutputTokens,
      targetOutputLength: this.config.synthesis?.targetOutputLength,
    });

    try {
      // Use the streaming continuation approach
      const fullReport = await this.generateReportWithContinuation({
        systemPrompt: reportPrompt.systemPrompt,
        userPrompt: reportPrompt.userPrompt,
        maxTokensPerRequest: 7000, // Safe limit for most models
      });

      // Debug: Write the final report raw response to a file
      writeDebugFile("final-report", "final-report-raw-response.md", fullReport);
      writeDebugFile("final-report", "final-report-token-count.json", {
        responseTextLength: fullReport.length,
        estimatedTokens: Math.round(fullReport.length / 4), // Rough estimate of tokens
      });

      return { report: fullReport };
    } catch (error: any) {
      console.warn("Error in generateFinalReport:", error.message || error);

      // Fallback report when generation fails
      return {
        report:
          "Unable to generate a complete research report due to a processing error. The research covered the meaning of life in space from philosophical, existential, psychological, and cultural perspectives.",
      };
    }
  }

  // Helper method to generate a long report with continuation markers
  private async generateReportWithContinuation({
    systemPrompt,
    userPrompt,
    maxTokensPerRequest = 7000,
    continuationMarker = "[###CONTINUE###]",
  }: {
    systemPrompt: string;
    userPrompt: string;
    maxTokensPerRequest?: number;
    continuationMarker?: string;
  }): Promise<string> {
    let fullReport = "";
    let isComplete = false;
    let partCount = 0;

    console.log("Generating report with continuation approach...");

    // Add continuation instructions to initial prompt
    const initialPrompt = `${userPrompt}
    
IMPORTANT: If you cannot complete the entire report within the token limit, end your response with ${continuationMarker} to indicate that continuation is needed. Do not write partial sentences - stop at a logical breaking point.`;

    while (!isComplete && partCount < 10) {
      partCount++;
      console.log(`Generating report part ${partCount}...`);

      // Choose the appropriate prompt based on whether this is the first part
      const currentPrompt =
        partCount === 1
          ? initialPrompt
          : `
This is a continuation of a research report. The previous content ends with:

${this.getLastContentForContinuation(fullReport, 1000)}

Please continue the report from this point. Maintain the same style, tone, and formatting as before. 
Do not repeat information already covered. Do not start with phrases like "Continuing from" or acknowledgments that this is a continuation.
If you're in the middle of a section, continue with that section. If you're at a logical breaking point, proceed to the next appropriate section.

IMPORTANT: If you cannot complete the entire report within the token limit, end your response with ${continuationMarker} to indicate that continuation is needed.`;

      // Generate the next part
      const reportPart = await generateText({
        model: this.aiProvider.getOutputModel(),
        prompt: `${systemPrompt}\n\n${currentPrompt}`,
        maxTokens: maxTokensPerRequest,
      });

      // Debug: Write the part to a file
      writeDebugFile("final-report", `final-report-part-${partCount}.md`, reportPart.text);

      // Add to the full report
      let partText = reportPart.text;

      // Check if this part contains a continuation marker
      if (partText.includes(continuationMarker)) {
        // Remove the marker and everything after it
        partText = partText.split(continuationMarker)[0].trim();
        isComplete = false;
      } else {
        // Only mark as complete if target length is reached or report structure indicates completion
        isComplete = fullReport.length + partText.length >= (this.config.synthesis?.targetOutputLength || 30000);
      }

      fullReport += partText;

      // Check if structural indicators suggest the report is complete
      const structurallyComplete = this.isReportComplete({ report: fullReport, continuationMarker });

      // Only stop if we've reached the target length or the report is structurally complete
      isComplete = isComplete || structurallyComplete;

      console.log(`Part ${partCount} generated (${partText.length} chars), cumulative length: ${fullReport.length}`);
    }

    console.log(`Report generation complete with ${partCount} parts, total length: ${fullReport.length} characters`);
    return fullReport;
  }

  // Helper method to extract the last N characters of content for continuation context
  private getLastContentForContinuation(text: string, length: number): string {
    if (text.length <= length) return text;

    const excerpt = text.slice(text.length - length);
    // Find the first paragraph or sentence break to make a clean cut
    const breakMatches = excerpt.match(/(\n\n|\.\s+)/);
    if (breakMatches && breakMatches.index) {
      // Start from the next character after the break
      return excerpt.slice(breakMatches.index + breakMatches[0].length);
    }
    return excerpt;
  }

  // Helper to check if the report seems complete based on content
  private isReportComplete({ report, continuationMarker }: { report: string; continuationMarker: string }): boolean {
    // If report contains continuation marker, it's definitely not complete
    if (report.includes(continuationMarker)) {
      return false;
    }

    // Check for length-based completion first - this is the primary goal
    if (this.config.synthesis?.targetOutputLength && report.length >= this.config.synthesis.targetOutputLength) {
      return true;
    }

    // Only check for structural completion if we're at least 80% of the target length
    // This prevents early termination when sections appear too soon
    const minAcceptableLength = (this.config.synthesis?.targetOutputLength || 30000) * 0.8;
    if (report.length < minAcceptableLength) {
      return false;
    }

    // Now check if the report contains concluding sections or phrases
    const completionIndicators = ["Conclusion", "References", "Bibliography", "In conclusion"];

    // Look for completion indicators in the last 20% of the document
    const lastSection = report.slice(report.length * 0.8);
    return completionIndicators.some(
      (indicator) =>
        lastSection.includes(`## ${indicator}`) || lastSection.includes(`# ${indicator}`) || lastSection.match(new RegExp(`\\d+\\.\\s+${indicator}`))
    );
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

export function createDeepResearch(config: Partial<DeepResearchConfig>) {
  return new DeepResearch(config);
}

// Default export
export default createDeepResearch;
