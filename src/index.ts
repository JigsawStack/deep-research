import { DeepResearchConfig, DeepResearchInstance } from './types';
import { FollowupQuestionGenerator } from './generators/followupQuestionGenerator';
import { Synthesizer } from './synthesis/synthesizer';

import {
  DEFAULT_CONFIG,
  DEFAULT_DEPTH_CONFIG,
  DEFAULT_BREADTH_CONFIG,
  DEFAULT_SYNTHESIS_CONFIG,
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
    return this.questionGenerator.generateSubQuestions(this.config.prompt, {
      ...DEFAULT_BREADTH_CONFIG,
      ...this.config.breadth,
    });
  }

  public async performRecursiveResearch(
    initialResults: WebSearchResult[],
    currentDepth: number = 1,
    parentSynthesis?: SynthesisOutput
  ): Promise<SynthesisOutput> {
    // If we've reached the max depth level, return final synthesis
    if (
      currentDepth >= (this.config.depth?.level ?? DEFAULT_DEPTH_CONFIG.level)
    ) {
      return this.synthesizer.generateComprehensiveSynthesis(
        {
          mainPrompt: this.config.prompt,
          results: initialResults,
          currentDepth,
          parentSynthesis,
        },
        this.config.synthesis?.maxOutputTokens
      );
    }

    console.log(`Performing research at depth level: ${currentDepth}`);

    // Check if we already have sufficient information to generate a final synthesis
    const hasSufficientInfo = await this.synthesizer.hasSufficientInformation(
      {
        mainPrompt: this.config.prompt,
        results: initialResults,
        currentDepth,
        parentSynthesis,
      },
      this.config.depth?.confidenceThreshold ||
        DEFAULT_DEPTH_CONFIG.confidenceThreshold
    );

    if (hasSufficientInfo) {
      console.log(
        `Sufficient information found at depth ${currentDepth}. Generating final synthesis.`
      );
      return this.synthesizer.generateComprehensiveSynthesis(
        {
          mainPrompt: this.config.prompt,
          results: initialResults,
          currentDepth,
          parentSynthesis,
        },
        this.config.synthesis?.maxOutputTokens
      );
    }

    // Otherwise, continue with the recursive process
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
      analysis: synthesis.analysis.substring(0, 100) + '...',
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

        try {
          // Fire web searches for the follow-up questions
          const followupResults = await this.fireWebSearches(subQuestions);

          // Recursively process deeper results with the current synthesis
          const finalSynthesis = await this.performRecursiveResearch(
            followupResults,
            currentDepth + 1,
            synthesis
          );

          // We got a final synthesis from a deeper level, return it
          return finalSynthesis;
        } catch (error) {
          console.error(
            `Error processing follow-up at depth ${currentDepth}:`,
            error
          );
          // If we encounter an error, we can still use what we have
          return this.synthesizer.generateComprehensiveSynthesis(
            {
              mainPrompt: this.config.prompt,
              results: allResults,
              currentDepth,
              parentSynthesis: synthesis,
            },
            this.config.synthesis?.maxOutputTokens
          );
        }
      }
    }

    // If we get here, we've completed this depth but haven't triggered early termination
    // Generate a comprehensive synthesis with what we have
    return this.synthesizer.generateComprehensiveSynthesis(
      {
        mainPrompt: this.config.prompt,
        results: allResults,
        currentDepth,
        parentSynthesis: synthesis,
      },
      this.config.synthesis?.maxOutputTokens
    );
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

    // Use the synthesizer's generateFinalSynthesis method
    return this.synthesizer.generateFinalSynthesis({
      mainPrompt: this.config.prompt,
      allSyntheses: allSyntheses,
      maxOutputTokens: this.config.synthesis?.maxOutputTokens,
    });
  }
}

export async function createDeepResearch(
  config: Partial<DeepResearchConfig>
): Promise<DeepResearchInstance> {
  const deepResearch = new DeepResearch(config);
  const subQuestions = await deepResearch.generateSubQuestions();
  const initialSearch = await deepResearch.fireWebSearches(subQuestions);
  console.log('Init Results', initialSearch);

  const finalSynthesis = await deepResearch.performRecursiveResearch(
    initialSearch
  );

  console.log('Final Synthesis:', {
    analysis: finalSynthesis.analysis,
    keyThemes: finalSynthesis.keyThemes,
    insights: finalSynthesis.insights,
    confidence: finalSynthesis.confidence,
  });

  return deepResearch;
}

// Default export
export default createDeepResearch;
