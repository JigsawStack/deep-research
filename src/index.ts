import AIProvider from './provider/aiProvider';
import { DeepResearchConfig, ResearchSource, WebSearchResult } from './types';

import {
  DEFAULT_CONFIG,
  DEFAULT_DEPTH_CONFIG,
  DEFAULT_BREADTH_CONFIG,
} from './config/defaults';
import 'dotenv/config';
import { JigsawProvider } from './provider/jigsaw';
import fs from 'fs';
import { generateObject } from 'ai';
import { z } from 'zod';
import { PROMPTS } from './prompts/prompts';

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
      console.error('Failed to parse JSON from code block:', e);
    }
  }

  // Look for the most promising JSON object in the text
  const potentialObjects: string[] = [];

  // Get text between curly braces, handling nested objects
  let stack = 0;
  let startIdx = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (stack === 0) {
        startIdx = i;
      }
      stack++;
    } else if (text[i] === '}' && stack > 0) {
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
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (e) {
      // Continue to the next candidate
    }
  }

  // If we still couldn't extract JSON, throw an error
  throw new Error('Could not extract valid JSON from response');
}

// Function to create clear prompts with JSON format instructions
function createJsonPrompt(basePrompt: string): string {
  return `${basePrompt}

IMPORTANT INSTRUCTIONS FOR RESPONSE FORMAT:
1. Respond ONLY with a valid JSON object
2. Do NOT include any explanation, thinking, or any text outside the JSON object
3. Do NOT use markdown code blocks - just provide the raw JSON
4. Make sure your response starts with '{' and ends with '}'
5. Ensure all JSON properties are properly quoted

Example of correct response format:
{"property1": "value1", "property2": "value2"}`;
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
    if (
      !this.config.openaiApiKey ||
      !this.config.geminiApiKey ||
      !this.config.deepInfraApiKey
    ) {
      throw new Error(
        'All API keys (openaiApiKey, geminiApiKey, deepInfraApiKey) are required'
      );
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
          if (typeof modelValue !== 'string') {
            // It's a LanguageModelV1 instance, add it as a direct model
            this.aiProvider.addDirectModel(modelType, modelValue);
          }
          // If it's a string, it will be handled by the generateText method
        }
      });
    }
  }

  private validateConfig(
    config: Partial<DeepResearchConfig>
  ): DeepResearchConfig {
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
      depth: config.depth
        ? { ...DEFAULT_DEPTH_CONFIG, ...config.depth }
        : DEFAULT_DEPTH_CONFIG,
      breadth: config.breadth
        ? { ...DEFAULT_BREADTH_CONFIG, ...config.breadth }
        : DEFAULT_BREADTH_CONFIG,
      models: mergedModels,
      jigsawApiKey:
        config.jigsawApiKey ||
        (() => {
          throw new Error('Jigsaw API key must be provided in config');
        })(),
      openaiApiKey:
        config.openaiApiKey ||
        (() => {
          throw new Error('OpenAI API key must be provided in config');
        })(),
      geminiApiKey:
        config.geminiApiKey ||
        (() => {
          throw new Error('Gemini API key must be provided in config');
        })(),
      deepInfraApiKey:
        config.deepInfraApiKey ||
        (() => {
          throw new Error('DeepInfra API key must be provided in config');
        })(),
    };
  }

  // Add this function to the DeepResearch class to summarize search results
  private deduplicateSearchResults(
    results: WebSearchResult[]
  ): WebSearchResult[] {
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
              title: item.title || '',
              domain: item.domain || '',
              ai_overview: item.ai_overview || '',
              // Truncate content to reduce token count
              content: item.content ? item.content.substring(0, 1000) : '',
            };
          }),
        },
      };

      return summarized;
    });
  }

  /**
   * Prepare search results for model evaluation by truncating them to fit within context limits
   * @param results Search results to truncate
   * @returns Truncated search results suitable for model input
   */
  private truncateResultsForModelInput(
    results: WebSearchResult[]
  ): WebSearchResult[] {
    // Limit the number of results to prevent context length issues
    const MAX_RESULTS = 10;
    const MAX_ITEMS_PER_RESULT = 5;
    const MAX_CONTENT_LENGTH = 500;

    // Take only a subset of results
    const truncatedResults = results.slice(0, MAX_RESULTS).map((result) => {
      // Create a copy with truncated content
      return {
        question: result.question,
        searchResults: {
          ai_overview: result.searchResults.ai_overview,
          // Take only a few items from each result and truncate their content
          results: result.searchResults.results
            .slice(0, MAX_ITEMS_PER_RESULT)
            .map((item) => ({
              url: item.url,
              title: item.title || '',
              domain: item.domain || '',
              ai_overview: item.ai_overview
                ? item.ai_overview.substring(0, MAX_CONTENT_LENGTH)
                : '',
              // Severely truncate content to reduce token count
              content: item.content
                ? item.content.substring(0, MAX_CONTENT_LENGTH)
                : '',
            })),
        },
      };
    });

    return truncatedResults;
  }

  /**
   * Generate a research plan with focused search queries for a given topic
   *
   * @param topic The main research topic
   * @param aiProvider The AI provider to use for generation
   * @returns List of search queries
   */
  private async generateResearchPlan(
    topic: string,
    aiProvider: AIProvider,
    maxQueries?: number
  ): Promise<{ queries: string[]; plan: string }> {
    try {
      // Generate the research plan using the AI provider
      const result = await generateObject({
        model: aiProvider.getDefaultModel(),
        output: 'object',
        schema: z.object({
          queries: z
            .array(z.string())
            .describe(
              'A list of search queries to thoroughly research the topic'
            ),
          plan: z
            .string()
            .describe(
              'A detailed plan explaining the research approach and methodology'
            ),
        }),
        prompt: createJsonPrompt(
          `Generate a research plan and focused search queries to thoroughly research the following topic: ${topic}. Include both specific search queries and a detailed explanation of the research approach.`
        ),
      });

      let queries = result.object.queries;

      // Limit queries if maxQueries is specified
      if (maxQueries && maxQueries > 0) {
        queries = queries.slice(0, maxQueries);
      }
      console.log(`Generated ${queries.length} research queries`);

      return {
        queries,
        plan: result.object.plan,
      };
    } catch (error: any) {
      console.error(
        `Error generating research plan: ${error.message || error}`
      );

      // Check if the error has a text property (likely from generateObject)
      if (
        error &&
        typeof error === 'object' &&
        'text' in error &&
        typeof error.text === 'string'
      ) {
        console.warn('Attempting to extract JSON from error response');
        try {
          // Try to extract JSON from the response
          const extracted = extractJSONFromResponse(error.text);
          if (
            extracted &&
            'queries' in extracted &&
            Array.isArray(extracted.queries) &&
            'plan' in extracted &&
            typeof extracted.plan === 'string'
          ) {
            let queries = extracted.queries;
            if (maxQueries && maxQueries > 0) {
              queries = queries.slice(0, maxQueries);
            }
            console.log(
              `Generated ${queries.length} research queries from extracted JSON`
            );
            return {
              queries,
              plan: extracted.plan,
            };
          }
        } catch (extractError) {
          console.error('Failed to extract JSON:', extractError);
        }
      }

      // Fallback response
      const defaultQueries = [
        topic,
        `${topic} research`,
        `${topic} analysis`,
        `${topic} examples`,
        `${topic} implications`,
      ];
      const limitedQueries =
        maxQueries && maxQueries > 0
          ? defaultQueries.slice(0, maxQueries)
          : defaultQueries;

      return {
        queries: limitedQueries, // Return topic and variations as fallback queries
        plan: `Basic research plan: Conduct a thorough search for information about "${topic}" using multiple angles and perspectives.`,
      };
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
      step: 'Research Plan Generation',
      timestamp: new Date().toISOString(),
    });

    const { queries, plan } = await this.generateResearchPlan(
      prompt,
      this.aiProvider,
      this.config.breadth?.maxParallelTopics
    );

    console.log(`Research plan: ${plan}`);
    console.log(`Research queries: ${queries.join('\n')}`);

    researchLog.metrics.totalQueries += queries.length;
    researchLog.steps[researchLog.steps.length - 1].details = {
      queriesGenerated: queries.length,
      queries,
    };

    // step 2: fire web searches
    console.log(
      `[Step 2] Running initial web searches with ${queries.length} queries...`
    );
    researchLog.steps.push({
      step: 'Initial Web Searches',
      timestamp: new Date().toISOString(),
    });

    const jigsaw = JigsawProvider.getInstance(this.config.jigsawApiKey);
    const initialSearchResults = await jigsaw.fireWebSearches(queries);
    console.log(
      `Received ${initialSearchResults.length} initial search results`
    );

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
    const deduplicatedResults =
      this.deduplicateSearchResults(initialSearchResults);

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

    console.log(
      `After deduplication: ${dedupSourceCount} sources (${uniqueUrls.size} unique URLs)`
    );

    researchLog.steps.push({
      step: 'Deduplication',
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
      step: 'Iterative Research',
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

    console.log(
      `Iterative research completed with ${iterativeResult.iterationCount} iterations`
    );
    console.log(`Total queries used: ${iterativeResult.queriesUsed.length}`);
    console.log(
      `Final search results: ${iterativeResult.finalSearchResults.length}`
    );

    researchLog.metrics.iterations = iterativeResult.iterationCount;
    researchLog.metrics.totalQueries = iterativeResult.queriesUsed.length;

    // step 4: synthesize results
    console.log(`[Step 4] Synthesizing results...`);
    researchLog.steps.push({
      step: 'Synthesis',
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
      step: 'Final Report Generation',
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
    researchLog.metrics.processingTime.total =
      researchLog.metrics.processingTime.end -
      researchLog.metrics.processingTime.start;

    researchLog.steps[researchLog.steps.length - 1].details = {
      reportTime: reportDuration,
      reportLength: finalReport.report ? finalReport.report.length : 0,
    };

    // Save the research log
    fs.writeFileSync(
      'logs/research_log.json',
      JSON.stringify(researchLog, null, 2)
    );
    console.log(`Research log saved to logs/research_log.json`);

    // Write detailed logs
    this.writeLogs(finalReport);

    return finalReport;
  }

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
    // Truncate results to fit within model's context length
    const truncatedResults = this.truncateResultsForModelInput(searchResults);

    const reportPrompt = createJsonPrompt(`${PROMPTS.report}

Main Research Topic: ${prompt}

Research Plan:
${researchPlan}

Synthesized Results:
${JSON.stringify(synthesizedResults, null, 2)}

Search Results:
${JSON.stringify(truncatedResults, null, 2)}

Based on the above information, generate a final research report.`);

    try {
      const finalReport = await generateObject({
        model: this.aiProvider.getReasoningModel(),
        output: 'object',
        schema: z.object({
          report: z.string().describe('The final research report'),
        }),
        prompt: reportPrompt,
      });

      return finalReport.object;
    } catch (error: any) {
      console.warn('Error in generateFinalReport:', error.message || error);

      // Check if the error has a text property (likely from generateObject)
      if (
        error &&
        typeof error === 'object' &&
        'text' in error &&
        typeof error.text === 'string'
      ) {
        console.warn('Attempting to extract JSON from error response');
        try {
          // Try to extract JSON from the response
          const extracted = extractJSONFromResponse(error.text);
          if (
            extracted &&
            'report' in extracted &&
            typeof extracted.report === 'string'
          ) {
            return extracted;
          }
        } catch (extractError) {
          console.error('Failed to extract JSON:', extractError);
        }
      }

      // Fallback report when extraction fails
      return {
        report:
          'Unable to generate a complete research report due to a processing error. The research covered the meaning of life in space from philosophical, existential, psychological, and cultural perspectives.',
      };
    }
  }

  /**
   * Evaluate if the current search results are sufficient or if more research is needed
   *
   * @param topic The research topic
   * @param results Current search results
   * @param allQueries List of queries already used
   * @returns List of additional queries needed or empty list if research is complete
   */
  private async evaluateResearchCompleteness(
    prompt: string,
    researchPlan: string,
    results: WebSearchResult[],
    allQueries: string[]
  ) {
    // Truncate results to fit within model's context length
    const truncatedResults = this.truncateResultsForModelInput(results);

    try {
      const parsedEvaluation = await generateObject({
        model: this.aiProvider.getReasoningModel(),
        output: 'object',
        schema: z.object({
          queries: z
            .array(z.string())
            .describe('Additional search queries needed'),
          isComplete: z.boolean().describe('Whether research is complete'),
          reason: z.string().describe('Reasoning for the decision'),
        }),
        prompt: createJsonPrompt(`${PROMPTS.evaluation}

Main Research Topic: ${prompt}

Current Search Results:
${JSON.stringify(truncatedResults, null, 2)}

Previous Search Queries Used:
${allQueries.join('\n')}

Research Plan:
${researchPlan}

Based on the above information, evaluate if we have sufficient research coverage or need additional queries.`),
      });

      return parsedEvaluation.object;
    } catch (error: any) {
      console.warn(
        'Error in evaluateResearchCompleteness:',
        error.message || error
      );

      // Check if the error has a text property (likely from generateObject)
      if (
        error &&
        typeof error === 'object' &&
        'text' in error &&
        typeof error.text === 'string'
      ) {
        console.warn('Attempting to extract JSON from error response');
        try {
          // Try to extract JSON from the response
          const extracted = extractJSONFromResponse(error.text);
          if (
            extracted &&
            'queries' in extracted &&
            'isComplete' in extracted &&
            'reason' in extracted
          ) {
            return extracted;
          }
        } catch (extractError) {
          console.error('Failed to extract JSON:', extractError);
        }
      }

      // Fallback response when extraction fails
      return {
        queries: ['fallback query 1', 'fallback query 2'],
        isComplete: false,
        reason: 'Error parsing model response. Using fallback queries.',
      };
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
      console.log(
        `  [Iteration ${iterationCount}] Evaluating research completeness...`
      );

      const iterationStartTime = Date.now();
      const evaluation = await this.evaluateResearchCompleteness(
        prompt,
        researchPlan,
        searchResults,
        allQueries
      );

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
        const iterativeStep = researchLog.steps.find(
          (s) => s.step === 'Iterative Research'
        );
        if (iterativeStep && iterativeStep.iterations) {
          iterativeStep.iterations.push(iterationLog);
        }
      }

      if (evaluation.isComplete) {
        console.log(
          `  Research evaluation complete (iteration ${iterationCount}): No additional queries needed`
        );
        console.log(`  Reason: ${evaluation.reason}`);
        break;
      }

      const newQueries = evaluation.queries;
      totalNewQueries += newQueries.length;

      console.log(
        `  Adding ${newQueries.length} new queries: ${newQueries.join(', ')}`
      );
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

      console.log(
        `  Retrieved ${newResults.length} new search results with ${newSourceCount} sources in ${searchTime}ms`
      );

      if (researchLog.steps) {
        const iterativeStep = researchLog.steps.find(
          (s) => s.step === 'Iterative Research'
        );
        if (
          iterativeStep &&
          iterativeStep.iterations &&
          iterativeStep.iterations.length > 0
        ) {
          const currentIteration =
            iterativeStep.iterations[iterativeStep.iterations.length - 1];
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

  private async synthesizeResults({
    searchResults,
  }: {
    searchResults: WebSearchResult[];
  }) {
    // Truncate results to fit within model's context length
    const truncatedResults = this.truncateResultsForModelInput(searchResults);

    try {
      const synthesizedResults = await generateObject({
        model: this.aiProvider.getReasoningModel(),
        output: 'object',
        schema: z.object({
          synthesis: z.string().describe('The synthesized results'),
        }),
        prompt: createJsonPrompt(`${PROMPTS.synthesis}

Current Search Results:
${JSON.stringify(truncatedResults, null, 2)}`),
      });

      return synthesizedResults.object.synthesis;
    } catch (error: any) {
      console.warn('Error in synthesizeResults:', error.message || error);

      // Check if the error has a text property (likely from generateObject)
      if (
        error &&
        typeof error === 'object' &&
        'text' in error &&
        typeof error.text === 'string'
      ) {
        console.warn('Attempting to extract JSON from error response');
        try {
          // Try to extract JSON from the response
          const extracted = extractJSONFromResponse(error.text);
          if (
            extracted &&
            'synthesis' in extracted &&
            typeof extracted.synthesis === 'string'
          ) {
            return extracted.synthesis;
          }
        } catch (extractError) {
          console.error('Failed to extract JSON:', extractError);
        }
      }

      // Fallback synthesis message when extraction fails
      return 'No synthesis could be generated due to a processing error. The research results contain information about the meaning of life in space from philosophical, psychological, and cultural perspectives.';
    }
  }

  public async writeLogs(finalReport?: any) {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }

    // Write prompts if available
    if (this.prompts) {
      fs.writeFileSync('logs/prompts.md', this.prompts.join('\n') || '');
    }

    // Write final report
    if (finalReport) {
      fs.writeFileSync(
        'logs/final_report.json',
        JSON.stringify(finalReport, null, 2)
      );

      if (finalReport.report) {
        fs.writeFileSync('logs/final_report.md', finalReport.report);
      }
    }

    // Log information about the research process
    try {
      // Look for search results data
      const searchResultsPath = 'logs/search_results.json';
      if (fs.existsSync(searchResultsPath)) {
        const searchResults = JSON.parse(
          fs.readFileSync(searchResultsPath, 'utf8')
        );

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
                    title: source.title || 'Unknown Title',
                    domain: source.domain || new URL(source.url).hostname,
                    ai_overview: source.ai_overview || '',
                    content: source.content || '',
                    isAcademic: source.isAcademic,
                  });
                }
              });
            }
          });

          // Write sources to file
          fs.writeFileSync(
            'logs/sources.json',
            JSON.stringify(sources, null, 2)
          );

          // Create a markdown version of sources for easy reference
          let sourcesMd = '# Research Sources\n\n';
          sourcesMd += `Total sources: ${sources.length}\n\n`;

          sources.forEach((source, index) => {
            sourcesMd += `## [${index + 1}] ${source.title}\n\n`;
            sourcesMd += `- URL: ${source.url}\n`;
            sourcesMd += `- Domain: ${source.domain}\n`;
            sourcesMd += `- Academic: ${source.isAcademic ? 'Yes' : 'No'}\n\n`;

            if (source.ai_overview) {
              sourcesMd += `### Overview\n\n${source.ai_overview}\n\n`;
            }

            sourcesMd += '---\n\n';
          });

          fs.writeFileSync('logs/sources.md', sourcesMd);
        }
      }

      // Create a research summary
      let summaryMd = '# Research Summary\n\n';

      if (finalReport && finalReport.report) {
        const reportPreview = finalReport.report.substring(0, 500) + '...';
        summaryMd += `## Final Report Preview\n\n${reportPreview}\n\n`;
      }

      // Add information about sources if available
      const sourcesPath = 'logs/sources.json';
      if (fs.existsSync(sourcesPath)) {
        const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
        summaryMd += `## Sources\n\nTotal sources: ${sources.length}\n\n`;

        // Count domains
        const domains: Record<string, number> = {};
        sources.forEach((source: ResearchSource) => {
          const domain = source.domain || 'unknown';
          domains[domain] = (domains[domain] || 0) + 1;
        });

        summaryMd += '### Top Domains\n\n';
        Object.entries(domains)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .forEach(([domain, count]) => {
            summaryMd += `- ${domain}: ${count}\n`;
          });
      }

      // Add detailed stats from research log
      if (fs.existsSync('logs/research_log.json')) {
        const researchLog = JSON.parse(
          fs.readFileSync('logs/research_log.json', 'utf8')
        );
        if (researchLog.metrics) {
          const metrics = researchLog.metrics;
          const processingTime = metrics.processingTime;

          summaryMd += `\n## Performance Metrics\n\n`;
          summaryMd += `- Total processing time: ${Math.round(
            processingTime.total / 1000
          )} seconds\n`;
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
              let duration = 'N/A';

              if (index < researchLog.steps.length - 1) {
                endTime = new Date(researchLog.steps[index + 1].timestamp);
                const durationMs = endTime.getTime() - startTime.getTime();
                duration = `${Math.round(durationMs / 1000)} seconds`;
              }

              summaryMd += `| ${
                step.step
              } | ${startTime.toLocaleTimeString()} | ${duration} |\n`;
            });

            // Query details
            if (researchLog.steps[0]?.details?.queries) {
              summaryMd += `\n### Initial Queries\n\n`;
              researchLog.steps[0].details.queries.forEach(
                (query: string, index: number) => {
                  summaryMd += `${index + 1}. ${query}\n`;
                }
              );
            }

            // Iteration details
            const iterativeStep = researchLog.steps.find(
              (s: ResearchStep) => s.step === 'Iterative Research'
            );
            if (
              iterativeStep &&
              iterativeStep.iterations &&
              iterativeStep.iterations.length > 0
            ) {
              summaryMd += `\n### Iterations\n\n`;

              iterativeStep.iterations.forEach(
                (iteration: ResearchIteration) => {
                  summaryMd += `#### Iteration ${iteration.iterationNumber}\n\n`;
                  summaryMd += `- Timestamp: ${new Date(
                    iteration.timestamp
                  ).toLocaleString()}\n`;
                  summaryMd += `- Complete: ${
                    iteration.isComplete ? 'Yes' : 'No'
                  }\n`;
                  summaryMd += `- Processing time: ${Math.round(
                    iteration.evaluationTime / 1000
                  )} seconds\n`;

                  if (iteration.additionalQueries > 0) {
                    summaryMd += `- Additional queries: ${iteration.additionalQueries}\n`;
                  }

                  if (iteration.newSearchResults !== undefined) {
                    summaryMd += `- New search results: ${iteration.newSearchResults}\n`;
                    summaryMd += `- New sources: ${iteration.newSources}\n`;
                    summaryMd += `- Search time: ${Math.round(
                      (iteration.searchTime || 0) / 1000
                    )} seconds\n`;
                  }

                  summaryMd += `\n**Reasoning**: ${iteration.reason}\n\n`;
                }
              );
            }

            // Synthesis and final report metrics
            const synthesisStep = researchLog.steps.find(
              (s: ResearchStep) => s.step === 'Synthesis'
            );
            if (synthesisStep && synthesisStep.details) {
              summaryMd += `\n### Synthesis\n\n`;
              summaryMd += `- Processing time: ${Math.round(
                synthesisStep.details.synthesisTime / 1000
              )} seconds\n`;
              summaryMd += `- Synthesis length: ${synthesisStep.details.synthesisLength} characters\n`;
            }

            const reportStep = researchLog.steps.find(
              (s: ResearchStep) => s.step === 'Final Report Generation'
            );
            if (reportStep && reportStep.details) {
              summaryMd += `\n### Final Report\n\n`;
              summaryMd += `- Processing time: ${Math.round(
                reportStep.details.reportTime / 1000
              )} seconds\n`;
              summaryMd += `- Report length: ${reportStep.details.reportLength} characters\n`;
            }
          }
        }
      }

      fs.writeFileSync('logs/research_summary.md', summaryMd);

      // Create a separate detailed stats file
      if (fs.existsSync('logs/research_log.json')) {
        const researchLog = JSON.parse(
          fs.readFileSync('logs/research_log.json', 'utf8')
        );
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

        fs.writeFileSync(
          'logs/research_stats.json',
          JSON.stringify(statsOutput, null, 2)
        );
      }
    } catch (error) {
      console.error('Error generating log files:', error);
    }
  }
}

export function createDeepResearch(config: Partial<DeepResearchConfig>) {
  return new DeepResearch(config);
}

// Default export
export default createDeepResearch;
