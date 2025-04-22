import { DeepResearchConfig, DeepResearchInstance } from './types';
import { DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_BREADTH_CONFIG } from './config/defaults';
import { SubQuestionGenerator } from './generators/subQuestionGenerator';
import { SubQuestionGeneratorResult } from './types/generators';
import { WebSearchResult } from './types';
import 'dotenv/config';
import { JigsawProvider } from './provider/jigsaw';
import DeepSeekProvider from './provider/deepseek';

interface SearchResult {
  question: string;
  answer: string;
}

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

  public async synthesizeResults(results: WebSearchResult[]): Promise<string> {
    const mainQuestion = this.config.prompt.join(' ');
    const formattedResults = results.map(result => ({
      question: result.question.question,
      answer: {
        overview: result.searchResults.ai_overview,
        content: result.searchResults.results[0]?.content,
        title: result.searchResults.results[0]?.title
      }
    }));

    const prompt = `
You are a research assistant helping to synthesize insights from multiple sub-questions.

Main Question:
"${mainQuestion}"

Sub-Question Answers:
${formattedResults.map((item, index) => {
      const answerDetails = [];
      if (item.answer.overview) answerDetails.push(`Overview: ${item.answer.overview}`);
      if (item.answer.content) answerDetails.push(`Content: ${item.answer.content}`);
      if (item.answer.title) answerDetails.push(`Title: ${item.answer.title}`);
      
      return `Q${index + 1}: ${item.question}\nA${index + 1}:\n${answerDetails.join('\n')}`
    }).join('\n\n')}

Instructions:
- Use the above answers to reason deeply about the main question.
- Draw conclusions and link implications across sub-questions.
- Highlight key themes, tradeoffs, and insights.
- Structure the answer clearly using markdown (headings, bullets, bold points).
- DO NOT simply copy and paste each sub-answer; instead, synthesize them into a holistic response.
- Maintain a neutral, academic tone.

Output should be in Markdown.`;

    const deepseek = DeepSeekProvider.getInstance({
      apiKey: process.env.DEEPSEEK_API_KEY || ''
    });
    return await deepseek.generateText(prompt, 'deepseek-ai/DeepSeek-R1');
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
  const synthesizedResults = await deepResearch.synthesizeResults(results);

  console.log("Synthesized Results", synthesizedResults);

  return deepResearch;
}

// Default export
export default createDeepResearch;
