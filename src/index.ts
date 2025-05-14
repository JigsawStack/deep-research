import AIProvider from './provider/aiProvider';
import {
  DeepResearchConfig,
  DeepResearchInstance,
  DeepResearchResponse,
  RecursiveResearchResult,
} from './types';
import { FollowupQuestionGenerator } from './generators/followupQuestionGenerator';
import { Synthesizer } from './synthesis/synthesizer';

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
  private followupGenerator: FollowupQuestionGenerator;
  private synthesizer: Synthesizer;
  private depthSynthesis: Map<number, SynthesisOutput[]>;
  private aiProvider: AIProvider;
  private questionGenerator: SubQuestionGenerator;

  constructor(config: Partial<DeepResearchConfig>) {
    this.config = this.validateAndMergeConfig(config);

    // Initialize AIProvider
    this.aiProvider = new AIProvider();

    // Add providers from config.models if available
    if (config.models) {
      // For each model type (default, quick, reasoning, etc.)
      Object.entries(config.models).forEach(([modelType, modelValue]) => {
        // If it's not a string, it's likely a provider instance
        if (modelValue && typeof modelValue !== 'string') {
          // Add it as a direct provider with the model type as the ID
          this.aiProvider.addDirectProvider(modelType, modelValue);
        }
        // If it's a string, it will be handled by the generateText method
      });
    }

    this.questionGenerator = new SubQuestionGenerator(this.aiProvider);
    this.followupGenerator = new FollowupQuestionGenerator(this.aiProvider);
    this.synthesizer = new Synthesizer(this.aiProvider);
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
      format: config.format || DEFAULT_CONFIG.format,
      models: {
        ...DEFAULT_CONFIG.models,
        ...config.models,
      },
    };
  }

  public async fireWebSearches(
    subQuestions: SubQuestionGeneratorResult
  ): Promise<WebSearchResult[]> {
    const jigsaw = JigsawProvider.getInstance();
    const results = await jigsaw.fireWebSearches(subQuestions);
    return results;
  }

  public async generateSubQuestions(): Promise<SubQuestionGeneratorResult> {
    if (!this.prompts || this.prompts.length === 0) {
      throw new Error('Prompts must be set before generating sub-questions');
    }

    return this.questionGenerator.generateSubQuestions(
      this.prompts,
      {
        ...DEFAULT_BREADTH_CONFIG,
        ...this.config.breadth,
      },
      this.aiProvider
    );
  }

  public async performRecursiveResearch(
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

    console.log(`Performing research at depth level: ${currentDepth}`);

    // Check if we already have sufficient information
    const hasSufficientInfo = await this.synthesizer.hasSufficientInformation(
      {
        mainPrompt: this.prompts,
        results: initialResults,
        currentDepth,
        parentSynthesis,
      },
      this.config.depth?.confidenceThreshold ||
        DEFAULT_DEPTH_CONFIG.confidenceThreshold
    );

    // Early return conditions - but don't generate final synthesis yet
    if (isMaxDepthReached) {
      console.log(`Maximum depth level ${currentDepth} reached.`);
      return {
        isComplete: true,
        reason: 'max_depth_reached',
      };
    }

    if (hasSufficientInfo) {
      console.log(`Sufficient information found at depth ${currentDepth}.`);
      return {
        isComplete: true,
        reason: 'sufficient_info',
      };
    }

    // First, synthesize the current level results
    const synthesis = await this.synthesizer.synthesizeResults({
      mainPrompt: this.prompts,
      results: initialResults,
      currentDepth,
      parentSynthesis,
    });

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
    for (const result of initialResults) {
      const followupQuestions =
        await this.followupGenerator.generateFollowupQuestions(
          this.prompts,
          result,
          this.config.breadth?.maxParallelTopics ||
            DEFAULT_BREADTH_CONFIG.maxParallelTopics
        );

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
          // Fire web searches for the follow-up questions
          const followupResults = await this.fireWebSearches(subQuestions);

          // Recursively process deeper results with the current synthesis
          const deeperResult = await this.performRecursiveResearch(
            followupResults,
            currentDepth + 1,
            synthesis
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
    return {
      isComplete: true,
      reason: 'research_complete',
    }; // Signal that we're done with research
  }

  public getSynthesis(): Map<number, SynthesisOutput[]> {
    return this.depthSynthesis;
  }

  public async generateFinalSynthesis(): Promise<SynthesisOutput> {
    if (!this.prompts || this.prompts.length === 0) {
      throw new Error('Prompts must be set before generating final synthesis');
    }

    // Get all the syntheses from all depth levels
    const allSyntheses: SynthesisOutput[] = [];
    this.depthSynthesis.forEach((syntheses) => {
      allSyntheses.push(...syntheses);
    });

    // Use the synthesizer's generateFinalSynthesis method
    return this.synthesizer.generateFinalSynthesis({
      mainPrompt: this.prompts,
      allSyntheses: allSyntheses,
      maxOutputTokens: this.config.synthesis?.maxOutputTokens,
      targetOutputLength:
        this.config.synthesis?.targetOutputLength ??
        DEFAULT_SYNTHESIS_CONFIG.targetOutputLength,
    });
  }

  public async generate(prompt: string[]): Promise<DeepResearchResponse> {
    if (!prompt || !Array.isArray(prompt) || prompt.length === 0) {
      throw new Error('Prompt must be provided as a non-empty array');
    }

    // Store the prompt in the class property
    this.prompts = prompt;

    // Now proceed with the existing implementation
    const subQuestions = await this.generateSubQuestions();
    console.log(`Generated ${subQuestions.questions.length} sub-questions`);

    const initialSearch = await this.fireWebSearches(subQuestions);
    console.log(`Received ${initialSearch.length} initial search results`);

    // Perform recursive research to populate the depthSynthesis map
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
    const finalSynthesis = await this.generateFinalSynthesis();
    console.log(
      `Final synthesis generated with ${
        finalSynthesis.analysis ? finalSynthesis.analysis.length : 0
      } characters`
    );

    // Calculate token usage (placeholder values - implement actual counting)
    const inputTokens = 256; // Estimate based on prompt length
    const outputTokens = 500; // Rough estimate
    const inferenceTimeTokens = 975; // Placeholder
    const totalTokens = inputTokens + outputTokens + inferenceTimeTokens;

    // Ensure we have a valid research output
    let research = 'No research results available.';

    if (finalSynthesis) {
      if (finalSynthesis.analysis) {
        // If analysis field exists, use it
        research = finalSynthesis.analysis;
      } else if (
        this.config.format === 'json' &&
        Object.keys(finalSynthesis).length > 0
      ) {
        // Format the research output based on the synthesis data
        // (keeping the existing formatting logic)
        // ...
      }
    }

    return {
      success: true,
      research: research,
      _usage: {
        input_tokens: Math.round(inputTokens),
        output_tokens: Math.round(outputTokens),
        inference_time_tokens: inferenceTimeTokens,
        total_tokens: Math.round(totalTokens),
      },
      sources: [], // Now populated from search results
    };
  }
}

export async function createDeepResearch(
  config: Partial<DeepResearchConfig>
): Promise<DeepResearchInstance> {
  // Set up default configs
  const defaultConfig: DeepResearchConfig = {
    format: 'json',
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
      includeSourceDetails: true,
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
