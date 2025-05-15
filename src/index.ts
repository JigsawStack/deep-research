import AIProvider from "./provider/aiProvider";
import { DeepResearchConfig, ResearchSource, WebSearchResult } from "./types";

import { DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_BREADTH_CONFIG } from "./config/defaults";
import "dotenv/config";
import { JigsawProvider } from "./provider/jigsaw";
import fs from "fs";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { FINAL_REPORT_PROMPT, PROMPTS } from "./prompts/prompts";

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
  public prompts?: string[];
  private aiProvider: AIProvider;
  private jigsaw: JigsawProvider;

  constructor(config: Partial<DeepResearchConfig>) {
    this.config = this.validateConfig(config);
    this.jigsaw = JigsawProvider.getInstance(this.config.jigsawApiKey);
    // Check if required API keys are provided
    if (!this.config.openaiApiKey || !this.config.geminiApiKey || !this.config.deepInfraApiKey) {
      throw new Error("All API keys (openaiApiKey, geminiApiKey, deepInfraApiKey) are required");
    }

    // Initialize AIProvider with API keys from config
    this.aiProvider = new AIProvider({
      openaiApiKey: this.config.openaiApiKey,
      geminiApiKey: this.config.geminiApiKey,
      deepInfraApiKey: this.config.deepInfraApiKey,
    });

    // Add models from config.models if available
    if (config.models) {
      // For each model type (default, quick, reasoning, etc.)
      Object.entries(config.models).forEach(([modelType, modelValue]) => {
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

  private validateConfig(config: Partial<DeepResearchConfig>): DeepResearchConfig {
    // Merge models carefully to handle both string and LanguageModelV1 instances
    const mergedModels = { ...DEFAULT_CONFIG.models };

    if (config.models) {
      Object.entries(config.models).forEach(([key, value]) => {
        if (value !== undefined) {
          mergedModels[key] = value;
        }
      });
    }

    return {
      depth: config.depth ? { ...DEFAULT_DEPTH_CONFIG, ...config.depth } : DEFAULT_DEPTH_CONFIG,
      breadth: config.breadth ? { ...DEFAULT_BREADTH_CONFIG, ...config.breadth } : DEFAULT_BREADTH_CONFIG,
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
    // Create a map to deduplicate by URL
    const urlMap = new Map<string, boolean>();

    // Create a summarized version of the results
    return results.map((result) => {
      // Keep the question and ai_overview
      const summarized = {
        question: result.question,
        searchResults: {
          ai_overview: result.searchResults.ai_overview,
          results: result.searchResults.results.filter((item) => {
            // Skip if we've seen this URL before
            if (urlMap.has(item.url)) {
              return false;
            }

            // Mark this URL as seen
            urlMap.set(item.url, true);

            // Keep only essential information
            return {
              url: item.url,
              title: item.title || "",
              domain: item.domain || "",
              ai_overview: item.ai_overview || "",
              // Truncate content to reduce token count
              // content: item.content ? item.content.substring(0, 1000) : '',
            };
          }),
        },
      };

      return summarized;
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
        prompt: `Generate a research plan and focused search queries to thoroughly research the following topic: ${topic}. Include both specific search queries and a detailed explanation of the research approach.`,
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

  // Add debug logging to summarizeResultsForSynthesis method
  private async summarizeResultsForSynthesis(results: WebSearchResult[]): Promise<string> {
    // Group results by related topics and extract key themes
    console.log(`  Creating intelligent summary of search results...`);

    try {
      const summarizationResponse = await generateText({
        model: this.aiProvider.getOutputModel(),
        prompt: `Summarize the following search results for research synthesis.
  Focus on extracting:
  1. Key themes and concepts
  2. Important sources with citations
  3. Main findings and consensus points
  4. Areas of disagreement
  5. Most reliable information
  
  Search Results:
  ${JSON.stringify(results, null, 2)}
  
  Your summary should preserve the most important information while reducing the token count.
  Include source URLs when mentioning specific facts or claims to maintain traceability.`,
      });

      console.log(`  Intelligent summary created (${summarizationResponse.text.length} chars)`);

      // Debug: Write the search results and summary to files
      writeDebugFile("search-results", "search-results.json", results);
      // Create markdown version of search results
      let searchResultsMd = `# Search Results\n\n`;
      results.forEach((result, idx) => {
        searchResultsMd += `## Query ${idx + 1}: ${result.question}\n\n`;
        if (result.searchResults && result.searchResults.ai_overview) {
          searchResultsMd += `### Overview\n\n${result.searchResults.ai_overview}\n\n`;
        }
        if (result.searchResults && result.searchResults.results) {
          searchResultsMd += `### Results\n\n`;
          result.searchResults.results.forEach((item, i) => {
            searchResultsMd += `#### [${i + 1}] ${item.title || "Untitled"}\n\n`;
            searchResultsMd += `- URL: ${item.url}\n`;
            if (item.domain) searchResultsMd += `- Domain: ${item.domain}\n`;
            if (item.ai_overview) searchResultsMd += `\n${item.ai_overview}\n\n`;
            searchResultsMd += `\n---\n\n`;
          });
        }
        searchResultsMd += `\n\n`;
      });
      writeDebugFile("search-results", "search-results.md", searchResultsMd);

      return summarizationResponse.text;
    } catch (error: any) {
      console.error(`  Error creating intelligent summary: ${error.message || error}`);

      // Fallback to simpler approach if the summary generation fails
      const simpleTopicList = results.map((r) => r.question).join(", ");
      const domainsList = new Set<string>();

      results.forEach((result) => {
        if (result.searchResults?.results) {
          result.searchResults.results.forEach((item) => {
            if (item.domain) domainsList.add(item.domain);
          });
        }
      });

      // Debug: Write the fallback summary to a file
      writeDebugFile("search-results", "search-results-fallback.json", {
        topic: results.map((r) => r.question),
        fallbackSummary: `Search results summary (fallback mode):
  - Topics researched: ${simpleTopicList}
  - Sources from domains: ${Array.from(domainsList).join(", ")}
  - Total search results: ${results.length}`,
      });
      writeDebugFile(
        "search-results",
        "search-results-fallback.md",
        `# Fallback Search Results Summary\n\n## Topic\n${results
          .map((r) => r.question)
          .join(", ")}\n\n## Summary\nSearch results summary (fallback mode):
  - Topics researched: ${simpleTopicList}
  - Sources from domains: ${Array.from(domainsList).join(", ")}
  - Total search results: ${results.length}`
      );

      return `Search results summary (fallback mode):
  - Topics researched: ${simpleTopicList}
  - Sources from domains: ${Array.from(domainsList).join(", ")}
  - Total search results: ${results.length}`;
    }
  }

  public async generate(prompt: string) {
    console.log(`Running research with prompt: ${prompt}`);

    // Initialize research log
    const researchLog: ResearchLog = {
      timestamp: new Date().toISOString(),
      prompt,
      steps: [],
      metrics: {
        totalQueries: 0,
        iterations: 0,
        totalSources: 0,
        uniqueSources: 0,
        processingTime: {
          start: Date.now(),
          end: 0,
          total: 0,
        },
      },
    };

    // step 1: generate research plan
    console.log(`[Step 1] Generating research plan...`);
    researchLog.steps.push({
      step: "Research Plan Generation",
      timestamp: new Date().toISOString(),
    });

    const { queries, plan } = await this.generateResearchPlan(prompt, this.aiProvider, this.config.breadth?.maxParallelTopics);

    console.log(`Research plan: ${plan}`);
    console.log(`Research queries: ${queries.join("\n")}`);

    researchLog.metrics.totalQueries += queries.length;
    researchLog.steps[researchLog.steps.length - 1].details = {
      queriesGenerated: queries.length,
      queries,
    };

    // step 2: fire web searches
    console.log(`[Step 2] Running initial web searches with ${queries.length} queries...`);
    researchLog.steps.push({
      step: "Initial Web Searches",
      timestamp: new Date().toISOString(),
    });

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

    researchLog.steps[researchLog.steps.length - 1].details = {
      resultsReceived: initialSearchResults.length,
      sourcesFound: initialSourceCount,
      uniqueSources: uniqueUrls.size,
    };

    researchLog.metrics.totalSources += initialSourceCount;
    researchLog.metrics.uniqueSources = uniqueUrls.size;

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

    researchLog.steps.push({
      step: "Deduplication",
      timestamp: new Date().toISOString(),
      details: {
        sourcesBefore: initialSourceCount,
        sourcesAfter: dedupSourceCount,
        uniqueSourcesAfter: uniqueUrls.size,
      },
    });

    // step 3: iteratively search until we have enough results
    console.log(`[Step 3] Starting iterative research...`);
    researchLog.steps.push({
      step: "Iterative Research",
      timestamp: new Date().toISOString(),
      iterations: [],
    });

    const iterativeResult = await this.performIterativeResearch({
      prompt,
      researchPlan: plan,
      initialResults: deduplicatedResults,
      allQueries: queries,
      researchLog: researchLog,
    });

    console.log(`Iterative research completed with ${iterativeResult.iterationCount} iterations`);
    console.log(`Total queries used: ${iterativeResult.queriesUsed.length}`);
    console.log(`Final search results: ${iterativeResult.finalSearchResults.length}`);

    researchLog.metrics.iterations = iterativeResult.iterationCount;
    researchLog.metrics.totalQueries = iterativeResult.queriesUsed.length;

    // step 4: synthesize results
    console.log(`[Step 4] Synthesizing results...`);
    researchLog.steps.push({
      step: "Synthesis",
      timestamp: new Date().toISOString(),
    });

    const synthesisStartTime = Date.now();
    const synthesizedResults = await this.synthesizeResults({
      searchResults: iterativeResult.finalSearchResults,
    });

    const synthesisDuration = Date.now() - synthesisStartTime;
    console.log(`Synthesis completed in ${synthesisDuration}ms`);

    researchLog.steps[researchLog.steps.length - 1].details = {
      synthesisTime: synthesisDuration,
      synthesisLength: synthesizedResults.length,
    };

    // step 5: generate a final report
    console.log(`[Step 5] Generating final report...`);
    researchLog.steps.push({
      step: "Final Report Generation",
      timestamp: new Date().toISOString(),
    });

    const reportStartTime = Date.now();
    const finalReport = await this.generateFinalReport({
      prompt,
      researchPlan: plan,
      searchResults: iterativeResult.finalSearchResults,
      synthesizedResults,
    });

    const reportDuration = Date.now() - reportStartTime;
    console.log(`Final report generated in ${reportDuration}ms`);

    // Complete metrics
    researchLog.metrics.processingTime.end = Date.now();
    researchLog.metrics.processingTime.total = researchLog.metrics.processingTime.end - researchLog.metrics.processingTime.start;

    researchLog.steps[researchLog.steps.length - 1].details = {
      reportTime: reportDuration,
      reportLength: finalReport.report ? finalReport.report : 0,
    };

    // Save the research log
    fs.writeFileSync("logs/research_log.json", JSON.stringify(researchLog, null, 2));
    console.log(`Research log saved to logs/research_log.json`);

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
      const evaluationPrompt = `${PROMPTS.evaluation}

<Research Topic>${prompt}</Research Topic>

<Research Plan>${researchPlan}</Research Plan>

<Search Queries Used>${allQueries.join(", ")}</Search Queries Used>

<Current Search Results Summary>${resultsSummary}</Current Search Results Summary>

Based on the above information, evaluate if we have sufficient research coverage or need additional queries.
Identify which aspects of the research plan have been covered and which areas still need investigation.

Your response MUST be formatted exactly as follows:

IS_COMPLETE: [true or false]
REASON: [Your detailed reasoning for why the research is complete or not]
QUERIES: [If IS_COMPLETE is false, provide a JSON array of additional search queries like ["query1", "query2"]. If complete, use empty array []]

Please ensure there are no thinking tags, reasoning sections, or other markup in your response.`;

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
    researchLog,
  }: {
    prompt: string;
    researchPlan: string;
    initialResults: WebSearchResult[];
    allQueries: string[];
    researchLog: ResearchLog;
  }) {
    let searchResults = initialResults;
    let iterationCount = 0;
    let totalNewQueries = 0;

    for (let i = 0; i < (this.config.depth?.maxLevel || 3); i++) {
      iterationCount++;
      console.log(`  [Iteration ${iterationCount}] Evaluating research completeness...`);

      const iterationStartTime = Date.now();
      const evaluation = await this.evaluateResearchCompleteness(prompt, researchPlan, searchResults, allQueries);

      // Log iteration details
      const iterationLog = {
        iterationNumber: iterationCount,
        timestamp: new Date().toISOString(),
        isComplete: evaluation.isComplete,
        reason: evaluation.reason,
        additionalQueries: evaluation.queries.length,
        evaluationTime: Date.now() - iterationStartTime,
      };

      if (researchLog.steps) {
        const iterativeStep = researchLog.steps.find((s) => s.step === "Iterative Research");
        if (iterativeStep && iterativeStep.iterations) {
          iterativeStep.iterations.push(iterationLog);
        }
      }

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

      if (researchLog.steps) {
        const iterativeStep = researchLog.steps.find((s) => s.step === "Iterative Research");
        if (iterativeStep && iterativeStep.iterations && iterativeStep.iterations.length > 0) {
          const currentIteration = iterativeStep.iterations[iterativeStep.iterations.length - 1];
          currentIteration.newSearchResults = newResults.length;
          currentIteration.newSources = newSourceCount;
          currentIteration.searchTime = searchTime;
        }
      }

      searchResults = [...searchResults, ...newResults];
      allQueries = [...allQueries, ...newQueries];

      // Update research log metrics
      if (researchLog.metrics) {
        researchLog.metrics.totalSources += newSourceCount;
      }
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
    const summary = await this.summarizeResultsForSynthesis(searchResults);

    try {
      console.log(`  Starting research synthesis...`);

      const synthesisPrompt = `${PROMPTS.synthesis}

Current Search Results:
${summary}

Synthesize the key findings from these search results into a comprehensive summary.
Focus on the most important and reliable information.
Highlight areas of consensus and note any significant disagreements.

Your response should be formatted as a clear, well-structured synthesis without any thinking tags, 
reasoning sections, or other markup in your response.`;

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

    const reportPrompt = FINAL_REPORT_PROMPT({
      mainPrompt: [prompt],
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
      const report = await generateText({
        model: this.aiProvider.getOutputModel(),
        // Convert the reportPrompt object to a string by merging system and user prompts
        prompt: `${reportPrompt.systemPrompt}\n\n${reportPrompt.userPrompt}`,
        maxTokens: this.config.synthesis?.maxOutputTokens,
        experimental_continueSteps: true,
      });

      // Debug: Write the final report raw response to a file
      writeDebugFile("final-report", "final-report-raw-response.md", report.text);
      writeDebugFile("final-report", "final-report-token-count.json", {
        responseTextLength: report.text.length,
        estimatedTokens: Math.round(report.text.length / 4), // Rough estimate of tokens
      });

      return { report: report.text };
    } catch (error: any) {
      console.warn("Error in generateFinalReport:", error.message || error);

      // Fallback report when generation fails
      return {
        report:
          "Unable to generate a complete research report due to a processing error. The research covered the meaning of life in space from philosophical, existential, psychological, and cultural perspectives.",
      };
    }
  }

  public async writeLogs(finalReport?: any) {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync("logs")) {
      fs.mkdirSync("logs");
    }

    // Write prompts if available
    if (this.prompts) {
      fs.writeFileSync("logs/prompts.md", this.prompts.join("\n") || "");
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
                // Only add unique URLs
                if (source.url && !sources.some((s) => s.url === source.url)) {
                  sources.push({
                    url: source.url,
                    title: source.title || "Unknown Title",
                    domain: source.domain || new URL(source.url).hostname,
                    ai_overview: source.ai_overview || "",
                    content: source.content || "",
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
