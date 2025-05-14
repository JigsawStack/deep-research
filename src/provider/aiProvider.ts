import { generateText } from 'ai';
import { ProviderV1, LanguageModelV1 } from '@ai-sdk/provider';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepInfra } from '@ai-sdk/deepinfra';

/**
 * AIProvider acts as an abstract factory for different AI model providers
 * It unifies the interface for interacting with different provider types
 */
export class AIProvider {
  private providers: Map<string, ProviderV1> = new Map();
  private models: {
    default: LanguageModelV1;
    reasoning: LanguageModelV1;
    output: LanguageModelV1;
  };

  /**
   * Initialize the provider with API keys from config and optional custom models
   */
  constructor({
    openaiApiKey,
    geminiApiKey,
    deepInfraApiKey,
    defaultModel,
    reasoningModel,
    outputModel,
  }: {
    openaiApiKey: string;
    geminiApiKey: string;
    deepInfraApiKey: string;
    defaultModel?: LanguageModelV1;
    reasoningModel?: LanguageModelV1;
    outputModel?: LanguageModelV1;
  }) {
    // Check for required API keys
    if (!openaiApiKey || !geminiApiKey || !deepInfraApiKey) {
      throw new Error(
        'Missing required API keys. Please provide openaiApiKey, geminiApiKey, and deepInfraApiKey.'
      );
    }

    // Initialize providers
    const openai = createOpenAI({
      apiKey: openaiApiKey,
    });

    const gemini = createGoogleGenerativeAI({
      apiKey: geminiApiKey,
    });

    const deepinfra = createDeepInfra({
      apiKey: deepInfraApiKey,
    });

    // Store providers
    this.providers.set('openai', openai);
    this.providers.set('gemini', gemini);
    this.providers.set('deepinfra', deepinfra);

    // Set default models
    this.models = {
      default: defaultModel || openai.languageModel('gpt-4o'),
      reasoning:
        reasoningModel || deepinfra.languageModel('deepseek-ai/DeepSeek-R1'),
      output: outputModel || gemini.languageModel('gemini-2.0-flash'),
    };
  }

  /**
   * Get the default model
   */
  getDefaultModel(): LanguageModelV1 {
    return this.models.default;
  }

  /**
   * Get the reasoning model
   */
  getReasoningModel(): LanguageModelV1 {
    return this.models.reasoning;
  }

  /**
   * Get the output model
   */
  getOutputModel(): LanguageModelV1 {
    return this.models.output;
  }

  /**
   * Set the default model
   */
  setDefaultModel(model: LanguageModelV1): void {
    this.models.default = model;
  }

  /**
   * Set the reasoning model
   */
  setReasoningModel(model: LanguageModelV1): void {
    this.models.reasoning = model;
  }

  /**
   * Set the output model
   */
  setOutputModel(model: LanguageModelV1): void {
    this.models.output = model;
  }

  /**
   * Add a direct model
   */
  addDirectModel(type: string, model: LanguageModelV1): void {
    if (type === 'default') {
      this.setDefaultModel(model);
    } else if (type === 'reasoning') {
      this.setReasoningModel(model);
    } else if (type === 'output') {
      this.setOutputModel(model);
    }
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: string): ProviderV1 | undefined {
    return this.providers.get(name);
  }

  /**
   * Generate text using a specified model
   */
  async generateText(
    prompt: string,
    model: LanguageModelV1 = this.models.default
  ): Promise<string> {
    try {
      const result = await generateText({
        model,
        prompt,
      });
      return result.text;
    } catch (error) {
      throw new Error(
        `Error generating text: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

export default AIProvider;
