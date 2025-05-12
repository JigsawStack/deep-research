import { DeepResearchConfig, DeepResearchInstance } from './types';
import { FollowupQuestionGenerator } from './generators/followupQuestionGenerator';
import { Synthesizer } from './synthesis/synthesizer';

import {
  DEFAULT_CONFIG,
  DEFAULT_DEPTH_CONFIG,
  DEFAULT_BREADTH_CONFIG,
} from './config/defaults';
import { SubQuestionGenerator } from './generators/subQuestionGenerator';
import { SubQuestionGeneratorResult } from './types/generators';
import { WebSearchResult } from './types';
import 'dotenv/config';
import { JigsawProvider } from './provider/jigsaw';
import { SynthesisOutput } from './types/synthesis';

export class DeepResearch implements DeepResearchInstance {
  public config: DeepResearchConfig;
  private questionGenerator: SubQuestionGenerator;
  private followupGenerator: FollowupQuestionGenerator;
  private synthesizer: Synthesizer;
  private depthSynthesis: Map<number, SynthesisOutput[]>;

  constructor(config: Partial<DeepResearchConfig>) {
    this.config = this.validateAndMergeConfig(config);
    this.questionGenerator = new SubQuestionGenerator();
    this.followupGenerator = new FollowupQuestionGenerator();
    this.synthesizer = new Synthesizer();
    this.depthSynthesis = new Map();
  }

  private validateAndMergeConfig(
    config: Partial<DeepResearchConfig>
  ): DeepResearchConfig {
    if (!config.prompt || !Array.isArray(config.prompt)) {
      throw new Error('Prompt must be provided as an array');
    }

    return {
      prompt: config.prompt,
      depth: {
        ...DEFAULT_DEPTH_CONFIG,
        ...config.depth,
      },
      breadth: {
        ...DEFAULT_BREADTH_CONFIG,
        ...config.breadth,
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
    return this.questionGenerator.generateSubQuestions(this.config.prompt, {
      ...DEFAULT_BREADTH_CONFIG,
      ...this.config.breadth,
    });
  }

  public async performRecursiveResearch(
    initialResults: WebSearchResult[],
    currentDepth: number = 1,
    parentSynthesis?: SynthesisOutput
  ): Promise<WebSearchResult[]> {
    // If we've reached the max depth level, return the current results
    if (
      currentDepth >= (this.config.depth?.level ?? DEFAULT_DEPTH_CONFIG.level)
    ) {
      return initialResults;
    }

    console.log(`Performing research at depth level: ${currentDepth}`);
    let allResults = [...initialResults];

    // First, synthesize the current level results
    const synthesis = await this.synthesizer.synthesizeResults({
      mainPrompt: this.config.prompt,
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
      summary: synthesis.summary,
      keyThemes: synthesis.keyThemes,
      confidence: synthesis.confidence,
    });

    // For each search result, generate follow-up questions
    for (const result of initialResults) {
      const followupQuestions =
        await this.followupGenerator.generateFollowupQuestions(
          this.config.prompt,
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

        // Fire web searches for the follow-up questions
        const followupResults = await this.fireWebSearches(subQuestions);

        // Recursively get deeper results, passing the current synthesis
        const deeperResults = await this.performRecursiveResearch(
          followupResults,
          currentDepth + 1,
          synthesis
        );

        // Add all results to our collection
        allResults = [...allResults, ...deeperResults];
      }
    }

    return allResults;
  }

  public getSynthesis(): Map<number, SynthesisOutput[]> {
    return this.depthSynthesis;
  }

  public async generateFinalSynthesis(): Promise<SynthesisOutput> {
    // Get all the syntheses from all depth levels
    const allSyntheses: SynthesisOutput[] = [];
    this.depthSynthesis.forEach((syntheses) => {
      allSyntheses.push(...syntheses);
    });

    // Create a combined synthesis of all depth levels
    const finalSynthesis = await this.synthesizer.synthesizeResults({
      mainPrompt: this.config.prompt,
      results: [], // No direct results, using syntheses instead
      currentDepth: 0, // 0 indicates final synthesis
      parentSynthesis: undefined,
    });

    return finalSynthesis;
  }
}

export async function createDeepResearch(
  config: Partial<DeepResearchConfig>
): Promise<DeepResearchInstance> {
  const deepResearch = new DeepResearch(config);
  const subQuestions = await deepResearch.generateSubQuestions();
  const initialSearch = await deepResearch.fireWebSearches(subQuestions);
  console.log('Init Results', initialSearch);

  const allResults = await deepResearch.performRecursiveResearch(initialSearch);

  console.log(`Total results after recursive research: ${allResults.length}`);

  // Generate final synthesis
  const finalSynthesis = await deepResearch.generateFinalSynthesis();
  console.log('Final Synthesis:', {
    summary: finalSynthesis.summary,
    keyThemes: finalSynthesis.keyThemes,
    insights: finalSynthesis.insights,
    confidence: finalSynthesis.confidence,
  });

  return deepResearch;
}

// Default export
export default createDeepResearch;
