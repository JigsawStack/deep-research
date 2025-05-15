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
        prompt: `Generate a research plan and focused search queries to thoroughly research the following topic: ${topic}. Include both specific search queries and a detailed explanation of the research approach.`,
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
    } catch (error) {
      console.error(`Error generating research plan: ${error}`);
      return {
        queries: [topic], // Return just the topic as a fallback query
        plan: `Basic research plan: Search directly for information about "${topic}"`,
      };
    }
  }

  public async generate(prompt: string) {
    console.log(`Running research with prompt: ${prompt}`);

    // step 1: generate research plan
    const { queries, plan } = await this.generateResearchPlan(
      prompt,
      this.aiProvider,
      this.config.breadth?.maxParallelTopics
    );

    console.log(`Research plan: ${plan}`);
    console.log(`Research queries: ${queries.join('\n')}`);

    // step 2: fire web searches
    const jigsaw = JigsawProvider.getInstance(this.config.jigsawApiKey);
    const initialSearchResults = await jigsaw.fireWebSearches(queries);
    console.log(
      `Received ${initialSearchResults.length} initial search results`
    );

    // step 2.5: deduplicate results
    const deduplicatedResults =
      this.deduplicateSearchResults(initialSearchResults);

    // step 3: iteratively search until we have enough results
    const iterativeResult = await this.performIterativeResearch({
      prompt,
      researchPlan: plan,
      initialResults: deduplicatedResults,
      allQueries: queries,
    });

    // step 4: synthesize results
    const synthesizedResults = await this.synthesizeResults({
      searchResults: iterativeResult.finalSearchResults,
    });

    // step 5: generate a final report
    const finalReport = await this.generateFinalReport({
      prompt,
      researchPlan: plan,
      searchResults: iterativeResult.finalSearchResults,
      synthesizedResults,
    });

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
    const reportPrompt = `${PROMPTS.report}

Main Research Topic: ${prompt}

Research Plan:
${researchPlan}

Synthesized Results:
${JSON.stringify(synthesizedResults, null, 2)}

Search Results:
${JSON.stringify(searchResults, null, 2)}

Based on the above information, generate a final research report.`;

    const finalReport = await generateObject({
      model: this.aiProvider.getReasoningModel(),
      output: 'object',
      schema: z.object({
        report: z.string().describe('The final research report'),
      }),
      prompt: reportPrompt,
    });

    return finalReport.object;
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
      prompt: `${PROMPTS.evaluation}

Main Research Topic: ${prompt}

Current Search Results:
${JSON.stringify(results, null, 2)}

Previous Search Queries Used:
${allQueries.join('\n')}

Research Plan:
${researchPlan}

Based on the above information, evaluate if we have sufficient research coverage or need additional queries.`,
    });

    return parsedEvaluation.object;
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
    for (let i = 0; i < (this.config.depth?.maxLevel || 3); i++) {
      const evaluation = await this.evaluateResearchCompleteness(
        prompt,
        researchPlan,
        searchResults,
        allQueries
      );

      if (evaluation.isComplete) {
        break;
      }

      const newQueries = evaluation.queries;
      const newResults = await this.jigsaw.fireWebSearches(newQueries);

      searchResults = [...searchResults, ...newResults];
      allQueries = [...allQueries, ...newQueries];
    }

    return {
      finalSearchResults: searchResults,
      queriesUsed: allQueries,
    };
  }

  private async synthesizeResults({
    searchResults,
  }: {
    searchResults: WebSearchResult[];
  }) {
    const synthesizedResults = await generateObject({
      model: this.aiProvider.getReasoningModel(),
      output: 'object',
      schema: z.object({
        synthesis: z.string().describe('The synthesized results'),
      }),
      prompt: `${PROMPTS.synthesis}

Current Search Results:
${JSON.stringify(searchResults, null, 2)}`,
    });

    return synthesizedResults.object.synthesis;
  }

  public async writeLogs(finalReport?: any) {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }

    // Write config
    fs.writeFileSync('logs/config.json', JSON.stringify(this.config, null, 2));

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

      fs.writeFileSync('logs/research_summary.md', summaryMd);
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
