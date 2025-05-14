import AIProvider from './provider/aiProvider';
import {
  DeepResearchConfig,
  DeepResearchInstance,
  DeepResearchResponse,
  RecursiveResearchResult,
  ResearchSource,
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
import { SynthesisOutput } from './types/synthesis';

export class DeepResearch implements DeepResearchInstance {
  public config: DeepResearchConfig;
  public prompts?: string[];
  private depthSynthesis: Map<number, SynthesisOutput[]>;
  private aiProvider: AIProvider;

  constructor(config: Partial<DeepResearchConfig>) {
    this.config = this.validateAndMergeConfig(config);

    // Initialize AIProvider
    this.aiProvider = new AIProvider();

    // Add providers from config.models if available
    if (config.models) {
      // For each model type (default, quick, reasoning, etc.)
      Object.entries(config.models).forEach(([modelType, modelValue]) => {
        if (modelValue) {
          if (typeof modelValue !== 'string') {
            // Check if it's a LanguageModelV1 or a ProviderV1
            if ('languageModel' in modelValue) {
              // It's a ProviderV1, add it as a provider
              this.aiProvider.addProvider(modelType, modelValue);
            } else {
              // It's likely a LanguageModelV1, add it as a direct model
              this.aiProvider.addDirectProvider(modelType, modelValue);
            }
          }
          // If it's a string, it will be handled by the generateText method
        }
      });
    }

    this.depthSynthesis = new Map();
  }

  private validateAndMergeConfig(
    config: Partial<DeepResearchConfig>
  ): DeepResearchConfig {
    // No need to validate prompt anymore
    return {
      depth: {
        ...DEFAULT_DEPTH_CONFIG,
        ...config.depth,
      },
      breadth: {
        ...DEFAULT_BREADTH_CONFIG,
        ...config.breadth,
      },
      synthesis: {
        ...DEFAULT_SYNTHESIS_CONFIG,
        ...config.synthesis,
      },
      models: {
        ...DEFAULT_CONFIG.models,
        ...config.models,
      },
      jigsawApiKey:
        config.jigsawApiKey ||
        (() => {
          throw new Error('Jigsaw API key must be provided in config');
        })(),
    };
  }

  public getSynthesis(): Map<number, SynthesisOutput[]> {
    return this.depthSynthesis;
  }

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
      this.config.models?.reasoning as string
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

    console.log(`\n===== FINAL RESEARCH SUMMARY =====`);
    console.log(
      `Research completed with ${this.depthSynthesis.size} depth levels`
    );
    console.log(`Final report length: ${research.length} characters`);
    console.log(`Key themes identified: ${finalReport.keyThemes.join(', ')}`);
    console.log(`Sources collected: ${sources.length}`);

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

  // We still need the recursive research method since it's complex and has internal state
  private async performRecursiveResearch(
    initialResults: WebSearchResult[],
    currentDepth: number = 1,
    parentSynthesis?: SynthesisOutput
  ): Promise<RecursiveResearchResult> {
    if (!this.prompts || this.prompts.length === 0) {
      throw new Error('Prompts must be set before performing research');
    }

    // Store conditions in variables
    const isMaxDepthReached =
      currentDepth >= (this.config.depth?.level ?? DEFAULT_DEPTH_CONFIG.level);

    console.log(`\n===== DEPTH LEVEL ${currentDepth} =====`);
    console.log(`Initial web search results: ${initialResults.length}`);

    // Check if we already have sufficient information
    console.log(
      `Checking if we have sufficient information at depth ${currentDepth}...`
    );
    const hasSufficientInfo = await hasSufficientInformation(
      {
        mainPrompt: this.prompts,
        results: initialResults,
        currentDepth,
        parentSynthesis,
      },
      this.config.depth?.confidenceThreshold ||
        DEFAULT_DEPTH_CONFIG.confidenceThreshold
    );
    console.log(`Sufficient information check result: ${hasSufficientInfo}`);

    // Early return conditions - but don't generate final synthesis yet
    if (isMaxDepthReached) {
      console.log(`\n===== DEPTH ${currentDepth} SUMMARY =====`);
      console.log(`Maximum depth level ${currentDepth} reached.`);
      console.log(`Early termination due to max depth reached.`);
      return {
        isComplete: true,
        reason: 'max_depth_reached',
      };
    }

    if (hasSufficientInfo) {
      console.log(`\n===== DEPTH ${currentDepth} SUMMARY =====`);
      console.log(`Sufficient information found at depth ${currentDepth}.`);
      console.log(`Early termination due to sufficient information.`);
      return {
        isComplete: true,
        reason: 'sufficient_info',
      };
    }

    // First, synthesize the current level results
    console.log(
      `Starting synthesis at depth ${currentDepth} with ${initialResults.length} results...`
    );
    const synthesis = await synthesize(
      {
        mainPrompt: this.prompts,
        results: initialResults,
        currentDepth,
        parentSynthesis,
      },
      this.aiProvider,
      this.config.models?.default as string
    );
    console.log(`Synthesis at depth ${currentDepth} completed`);

    // Store the synthesis for this depth level
    if (!this.depthSynthesis.has(currentDepth)) {
      this.depthSynthesis.set(currentDepth, []);
    }
    this.depthSynthesis.get(currentDepth)?.push(synthesis);

    console.log(`Synthesis at depth ${currentDepth}:`, {
      analysis: synthesis.analysis.substring(0, 100) + '...',
      keyThemes: synthesis.keyThemes,
      confidence: synthesis.confidence,
    });

    // For each search result, generate follow-up questions
    let totalFollowUpQuestions = 0;
    let totalWebSearches = 0;

    console.log(
      `\nProcessing ${initialResults.length} search results for follow-up questions at depth ${currentDepth}...`
    );

    for (const result of initialResults) {
      console.log(
        `Generating follow-up questions for result: "${result.question.question.substring(
          0,
          50
        )}..."`
      );
      // Use the function directly
      const followupQuestions = await generateFollowupQuestions(
        this.prompts,
        result,
        this.config.breadth?.maxParallelTopics ||
          DEFAULT_BREADTH_CONFIG.maxParallelTopics,
        this.aiProvider,
        (this.config.models?.default as string) || 'gemini-2.0-flash'
      );
      console.log(`Generated ${followupQuestions.length} follow-up questions`);
      totalFollowUpQuestions += followupQuestions.length;

      if (followupQuestions.length > 0) {
        // Convert follow-up questions to SubQuestionGeneratorResult format
        const subQuestions: SubQuestionGeneratorResult = {
          questions: followupQuestions.map((question, index) => ({
            id: `followup-${currentDepth}-${result.question.id}-${index}`,
            question,
            relevanceScore: 0.9, // Assuming high relevance for follow-up questions
            parentTopicId: result.question.id,
          })),
          metadata: {
            totalGenerated: followupQuestions.length,
            averageRelevanceScore: 0.9,
            generationTimestamp: new Date().toISOString(),
          },
        };

        try {
          // Fire web searches directly
          console.log(
            `Firing web searches for ${subQuestions.questions.length} follow-up questions...`
          );
          const jigsaw = JigsawProvider.getInstance(this.config.jigsawApiKey);
          const followupResults = await jigsaw.fireWebSearches(subQuestions);
          console.log(
            `Received ${followupResults.length} web search results for follow-up questions`
          );
          totalWebSearches += followupResults.length;

          // Recursively process deeper results with the current synthesis
          console.log(
            `Starting recursive research at depth ${currentDepth + 1}...`
          );
          const deeperResult = await this.performRecursiveResearch(
            followupResults,
            currentDepth + 1,
            synthesis
          );
          console.log(
            `Returned from recursive research at depth ${currentDepth + 1}`
          );

          // If we got a result from deeper level (null means we should stop), return it
          if (deeperResult !== null) {
            return deeperResult;
          }
          // Otherwise we continue with the next result
        } catch (error) {
          console.error(
            `Error processing follow-up at depth ${currentDepth}:`,
            error
          );
          // If we encounter an error, we can still continue with other results
        }
      }
    }

    // If we get here, we've completed this depth but haven't triggered early termination
    console.log(`\n===== DEPTH ${currentDepth} SUMMARY =====`);
    console.log(
      `Total follow-up questions generated: ${totalFollowUpQuestions}`
    );
    console.log(`Total web searches performed: ${totalWebSearches}`);
    console.log(`Research at depth ${currentDepth} completed\n`);

    return {
      isComplete: true,
      reason: 'research_complete',
    }; // Signal that we're done with research
  }
}

export async function createDeepResearch(
  config: Partial<DeepResearchConfig>
): Promise<DeepResearchInstance> {
  // Set up default configs
  const defaultConfig: DeepResearchConfig = {
    depth: {
      level: 3,
      maxTokensPerAnalysis: 4000,
      includeReferences: true,
      confidenceThreshold: 0.7,
    },
    breadth: {
      level: 2,
      maxParallelTopics: 3,
      includeRelatedTopics: true,
      minRelevanceScore: 0.8,
    },
    synthesis: {
      maxOutputTokens: 8000,
      targetOutputLength: 5000,
      formatAsMarkdown: true,
    },
  };

  // Merge provided config with defaults
  const mergedConfig = {
    ...defaultConfig,
    ...config,
    depth: { ...defaultConfig.depth, ...config.depth },
    breadth: { ...defaultConfig.breadth, ...config.breadth },
    synthesis: { ...defaultConfig.synthesis, ...config.synthesis },
  };

  // Return new instance with merged config
  return new DeepResearch(mergedConfig);
}

// Default export
export default createDeepResearch;
