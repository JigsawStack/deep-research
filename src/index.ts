import AIProvider from './provider/aiProvider';
import {
  DeepResearchConfig,
  DeepResearchInstance,
  DeepResearchResponse,
  ResearchSource,
  WebSearchResultItem,
} from './types';
import { generateFollowupQuestions } from './generators/followupQuestionGenerator';
import { generateSubQuestions } from './generators/subQuestionGenerator';
import {
  synthesize,
  generateReport,
  hasSufficientInformation,
} from './synthesis/synthesizer';

import {
  DEFAULT_CONFIG,
  DEFAULT_DEPTH_CONFIG,
  DEFAULT_BREADTH_CONFIG,
  DEFAULT_SYNTHESIS_CONFIG,
} from './config/defaults';
import { SubQuestionGeneratorResult } from './types/generators';
import { WebSearchResult } from './types';
import 'dotenv/config';
import { JigsawProvider } from './provider/jigsaw';
import { SynthesisOutput, ReportOutput } from './types/synthesis';
import fs from 'fs';
import { generateObject } from 'ai';
import { z } from 'zod';
import { PROMPTS } from './prompts';
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
      depth: { ...DEFAULT_DEPTH_CONFIG, ...config.depth },
      breadth: { ...DEFAULT_BREADTH_CONFIG, ...config.breadth },
      synthesis: { ...DEFAULT_SYNTHESIS_CONFIG, ...config.synthesis },
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

  public async generateLogs(finalReport?: ReportOutput) {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }

    // Write config
    fs.writeFileSync('logs/config.json', JSON.stringify(this.config, null, 2));

    // Write prompts
    fs.writeFileSync('logs/prompts.md', this.prompts?.join('\n') || '');

    // Write synthesis map with detailed information
    const synthesisMap: Record<number, SynthesisOutput[]> = {};
    this.depthSynthesis.forEach((value, key) => {
      synthesisMap[key] = value;
    });
    fs.writeFileSync(
      'logs/synthesis_by_depth.json',
      JSON.stringify(synthesisMap, null, 2)
    );

    // Write all syntheses flattened
    const allSyntheses: SynthesisOutput[] = [];
    this.depthSynthesis.forEach((syntheses) => {
      allSyntheses.push(...syntheses);
    });
    fs.writeFileSync(
      'logs/all_syntheses.json',
      JSON.stringify(allSyntheses, null, 2)
    );

    // Create a more detailed synthesis map with key information and previews
    const detailedSynthesisMap: Record<string, any> = {};
    this.depthSynthesis.forEach((syntheses, depth) => {
      detailedSynthesisMap[`depth_${depth}`] = syntheses.map(
        (synthesis, index) => ({
          index,
          depth,
          confidence: synthesis.confidence,
          key_themes: synthesis.keyThemes,
          insights_count: synthesis.insights.length,
          knowledge_gaps_count: synthesis.knowledgeGaps.length,
          analysis_preview: synthesis.analysis.substring(0, 150) + '...',
        })
      );
    });
    fs.writeFileSync(
      'logs/detailed_synthesis_map.json',
      JSON.stringify(detailedSynthesisMap, null, 2)
    );

    // Write a markdown log of all syntheses
    let synthesisMd = '# All Research Syntheses\n\n';

    if (allSyntheses.length === 0) {
      synthesisMd +=
        '**No syntheses were generated during this research run**\n\n';
      synthesisMd +=
        'This could be due to an early termination or insufficient information.\n';
    } else {
      this.depthSynthesis.forEach((syntheses, depth) => {
        synthesisMd += `## Depth Level ${depth}\n\n`;

        syntheses.forEach((synthesis, index) => {
          synthesisMd += `### Synthesis ${depth}.${index + 1}\n\n`;
          synthesisMd += `- **Confidence:** ${synthesis.confidence}\n`;
          synthesisMd += `- **Key Themes:** ${synthesis.keyThemes.join(
            ', '
          )}\n\n`;

          synthesisMd += `#### Insights\n\n`;
          synthesis.insights.forEach((insight) => {
            synthesisMd += `- ${insight}\n`;
          });
          synthesisMd += '\n';

          synthesisMd += `#### Knowledge Gaps\n\n`;
          synthesis.knowledgeGaps.forEach((gap) => {
            synthesisMd += `- ${gap}\n`;
          });
          synthesisMd += '\n';

          synthesisMd += `#### Analysis\n\n`;
          synthesisMd += `${synthesis.analysis.substring(0, 800)}...\n\n`;
          synthesisMd += '---\n\n';
        });
      });
    }

    fs.writeFileSync('logs/all_syntheses.md', synthesisMd);

    // Create source reference file to help match references in final report
    try {
      const sourcesPath = 'logs/sources.json';
      if (fs.existsSync(sourcesPath)) {
        const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));

        if (Array.isArray(sources) && sources.length > 0) {
          // Check if the final report has proper citation mapping
          const citationMapping: Record<string, string> = {};
          if (finalReport && finalReport.citationMapping) {
            // Convert number keys to strings for safer access
            Object.entries(finalReport.citationMapping).forEach(
              ([key, value]) => {
                citationMapping[key] = value as string;
              }
            );
            console.log('Using citation mapping from final report');
          }

          // Generate source reference lookup
          const sourcesLookup = sources.map((source, index) => {
            const refNum = index + 1;
            const refKey = refNum.toString();
            return {
              reference_number: refNum,
              url: source.url,
              title: source.title || 'Unknown Title',
              domain: source.domain || new URL(source.url).hostname,
              citation_key: citationMapping[refKey] ? `[${refNum}]` : null,
            };
          });

          fs.writeFileSync(
            'logs/source_references.json',
            JSON.stringify(sourcesLookup, null, 2)
          );

          // Create a markdown version of source references for easy lookup
          let sourcesMd = '# Source References\n\n';
          sourcesMd +=
            'This file provides a mapping between reference numbers in the final report and their corresponding sources.\n\n';

          sourcesLookup.forEach((source) => {
            const citationTag = source.citation_key
              ? ` ${source.citation_key}`
              : '';
            sourcesMd += `## [${source.reference_number}]${citationTag} ${source.title}\n\n`;
            sourcesMd += `- URL: ${source.url}\n`;
            sourcesMd += `- Domain: ${source.domain}\n\n`;
          });

          fs.writeFileSync('logs/source_references.md', sourcesMd);

          console.log(
            `Generated source reference files to help match references in the final report`
          );
        }
      }
    } catch (error) {
      console.error('Error generating source reference files:', error);
    }
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

  public async runResearch(prompt: string) {
    console.log(`Running research with prompt: ${prompt}`);

    // step 1: generate research plan
    const { queries, plan } = await this.generateResearchPlan(
      prompt,
      this.aiProvider
    );

    console.log(`Research plan: ${plan}`);
    console.log(`Research queries: ${queries.join('\n')}`);

    // step 2: fire web searches
    const jigsaw = JigsawProvider.getInstance(this.config.jigsawApiKey);
    const initialSearchResults = await jigsaw.fireWebSearches(queries);
    console.log(
      `Received ${initialSearchResults.length} initial search results`
    );

    // step 3: iteratively search until we have enough results
    const iterativeResult = await this.performIterativeResearch({
      prompt,
      researchPlan: plan,
      initialResults: initialSearchResults,
      allQueries: queries,
    });

    // step 4: synthesize results
    const synthesizedResults = await this.synthesizeResults({
      searchResults: iterativeResult.finalSearchResults,
    });

    // step 5: generate a final report
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
    synthesizedResults: SynthesisOutput;
  }) {}
  public async generate(prompt: string[]): Promise<DeepResearchResponse> {
    if (!prompt || !Array.isArray(prompt) || prompt.length === 0) {
      throw new Error('Prompt must be provided as a non-empty array');
    }

    // Store the prompt in the class property
    this.prompts = prompt;

    // Generate sub-questions directly using the imported function
    const subQuestions = await generateSubQuestions({
      mainPrompt: this.prompts,
      breadthConfig: {
        ...DEFAULT_BREADTH_CONFIG,
        ...this.config.breadth,
      },
      provider: this.aiProvider,
      generationModel: this.config.models?.default as string,
      relevanceCheckModel: this.config.models?.reasoning as string,
    });
    console.log(`Generated ${subQuestions.questions.length} sub-questions`);

    // Fire web searches directly
    const jigsaw = JigsawProvider.getInstance(this.config.jigsawApiKey);
    const initialSearch = await jigsaw.fireWebSearches(subQuestions);
    console.log(`Received ${initialSearch.length} initial search results`);

    // Perform recursive research
    const recursiveResult = await this.performRecursiveResearch(initialSearch);
    console.log(
      `Recursive research completed with reason: ${recursiveResult.reason}`
    );

    // Store the synthesis from the recursive result if available
    if (recursiveResult.synthesis) {
      const depth = recursiveResult.synthesis.depth || 1;
      console.log(`Storing synthesis from recursive result at depth ${depth}`);

      if (!this.depthSynthesis.has(depth)) {
        this.depthSynthesis.set(depth, []);
      }
      this.depthSynthesis.get(depth)?.push(recursiveResult.synthesis);
    }

    // Get all the syntheses
    const allDepthSynthesis = this.getSynthesis();
    console.log(
      `Synthesis map contains ${allDepthSynthesis.size} depth levels`
    );

    // Generate the final synthesis
    const allSyntheses: SynthesisOutput[] = [];
    this.depthSynthesis.forEach((syntheses) => {
      allSyntheses.push(...syntheses);
    });

    // Collect sources from all search results
    const sources: ResearchSource[] = [];

    // Extract unique sources from initial search results
    initialSearch.forEach((result) => {
      if (result.searchResults && result.searchResults.results) {
        result.searchResults.results.forEach((source) => {
          // Only add unique URLs
          if (source.url && !sources.some((s) => s.url === source.url)) {
            // Create a source object with only properties from the ResearchSource interface
            const researchSource: ResearchSource = {
              url: source.url,
              content: source.content || '',
              ai_overview: source.ai_overview || '',
              title: source.title || 'Unknown Title',
              domain: source.domain || '',
              isAcademic: source.isAcademic,
            };

            // Add domain if not present but URL is valid
            if (!researchSource.domain && researchSource.url) {
              try {
                researchSource.domain = new URL(researchSource.url).hostname;
              } catch (e) {
                // Invalid URL, keep domain empty
              }
            }

            sources.push(researchSource);
          }
        });
      }
    });

    // Generate the final report with collected sources
    const finalReport = await generateReport(
      {
        mainPrompt: this.prompts,
        allSyntheses: allSyntheses,
      },
      {
        maxOutputTokens: this.config.synthesis?.maxOutputTokens,
        targetOutputLength:
          this.config.synthesis?.targetOutputLength ?? 'standard',
        formatAsMarkdown: true,
      },
      this.aiProvider,
      // Convert ResearchSource[] to the expected format
      sources.map((source) => ({
        url: source.url,
        title: source.title || 'Unknown Title',
        domain: source.domain || '',
        ai_overview: source.ai_overview || '',
        isAcademic: source.isAcademic,
      }))
    );

    console.log(
      `Final research report generated with ${
        finalReport.analysis ? finalReport.analysis.length : 0
      } characters`
    );

    console.log(`\n===== FINAL REPORT DEBUG =====`);
    console.log(`Report object keys: ${Object.keys(finalReport).join(', ')}`);
    console.log(`Report analysis exists: ${!!finalReport.analysis}`);
    console.log(`Report analysis type: ${typeof finalReport.analysis}`);
    console.log(
      `Report analysis length: ${
        finalReport.analysis ? finalReport.analysis.length : 0
      }`
    );
    console.log(
      `Report analysis preview: ${
        finalReport.analysis
          ? finalReport.analysis.substring(0, 200)
          : 'No analysis'
      }`
    );

    if (!finalReport.analysis || finalReport.analysis.length === 0) {
      console.error(`WARNING: Final report analysis is empty or undefined!`);
    }

    // Calculate token usage (placeholder values - implement actual counting)
    const inputTokens = 256; // Estimate based on prompt length
    const outputTokens = 500; // Rough estimate
    const inferenceTimeTokens = 975; // Placeholder
    const totalTokens = inputTokens + outputTokens + inferenceTimeTokens;

    // Ensure we have a valid research output
    let research = finalReport.analysis || 'No research results available.';

    console.log(`\n===== FINAL RESEARCH SUMMARY =====`);
    console.log(
      `Research completed with ${this.depthSynthesis.size} depth levels`
    );
    console.log(`Final report length: ${research.length} characters`);
    console.log(`Key themes identified: ${finalReport.keyThemes.join(', ')}`);
    console.log(`Sources collected: ${sources.length}`);

    // Generate comprehensive test files with all the data
    await this.generateLogs(finalReport);

    // Write final report to output files
    fs.writeFileSync(
      'logs/final_report.json',
      JSON.stringify(finalReport, null, 2)
    );

    fs.writeFileSync(
      'logs/final_report.md',
      finalReport.analysis || 'No analysis available'
    );
    fs.writeFileSync('logs/sources.json', JSON.stringify(sources, null, 2));

    return {
      success: true,
      research: research,
      _usage: {
        input_tokens: Math.round(inputTokens),
        output_tokens: Math.round(outputTokens),
        inference_time_tokens: inferenceTimeTokens,
        total_tokens: Math.round(totalTokens),
      },
      sources: sources,
    };
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
    // Format results into a string representation
    const formattedResults = results.map((r) => ({
      question: r.question.question,
      overview: r.searchResults.ai_overview,
      sources: r.searchResults.results,
    }));

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
${JSON.stringify(formattedResults, null, 2)}

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
    for (let i = 0; i < this.config.depth?.level; i++) {
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
    searchResults: WebSearchResultItem[];
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

    return synthesizedResults.object;
  }
}

export function createDeepResearch(
  config: Partial<DeepResearchConfig>
): DeepResearchInstance {
  return new DeepResearch(config);
}

// Default export
export default createDeepResearch;
