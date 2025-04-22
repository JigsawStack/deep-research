import { DeepResearchConfig, DeepResearchInstance } from './types';
import { DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_BREADTH_CONFIG } from './config/defaults';
import { SubQuestionGenerator } from './generators/subQuestionGenerator';
import { SubQuestionGeneratorResult } from './types/generators';
import { WebSearchResult } from './types';
import 'dotenv/config';
import { JigsawProvider } from './provider/jigsaw';

export class DeepResearch implements DeepResearchInstance {
  public config: DeepResearchConfig;
  private questionGenerator: SubQuestionGenerator;

  constructor(config: Partial<DeepResearchConfig>) {
    this.config = this.validateAndMergeConfig(config);
    this.questionGenerator = new SubQuestionGenerator();
  }

  private validateAndMergeConfig(config: Partial<DeepResearchConfig>): DeepResearchConfig {
    if (!config.prompt || !Array.isArray(config.prompt)) {
      throw new Error('Prompt must be provided as an array');
    }

    return {
      prompt: config.prompt,
      depth: {
        ...DEFAULT_DEPTH_CONFIG,
        ...config.depth
      },
      breadth: {
        ...DEFAULT_BREADTH_CONFIG,
        ...config.breadth
      },
      format: config.format || DEFAULT_CONFIG.format,
      models: {
        ...DEFAULT_CONFIG.models,
        ...config.models
      }
    };
  }

  public async fireWebSearches(subQuestions: SubQuestionGeneratorResult): Promise<WebSearchResult[]> {
    const jigsaw = JigsawProvider.getInstance();
    const results = await jigsaw.fireWebSearches(subQuestions);
    return results;
  }

  public async generateSubQuestions(): Promise<SubQuestionGeneratorResult> {
    return this.questionGenerator.generateSubQuestions(
      this.config.prompt,
      {
        ...DEFAULT_BREADTH_CONFIG,
        ...this.config.breadth
      }
    );
  }
}

export async function createDeepResearch(config: Partial<DeepResearchConfig>): Promise<DeepResearchInstance> {
  const deepResearch = new DeepResearch(config);
  const subQuestions = await deepResearch.generateSubQuestions();
  const results = await deepResearch.fireWebSearches(subQuestions);
  console.log("Results", results);
  return deepResearch;
}

// Default export
export default createDeepResearch;
