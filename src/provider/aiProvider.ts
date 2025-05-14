import { generateText } from 'ai';
import { GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { DeepInfraProvider } from '@ai-sdk/deepinfra';
import { OpenAIProvider as OpenAISDKProvider } from '@ai-sdk/openai';
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
  private directModels: Map<string, LanguageModelV1> = new Map();
  private modelToProviderMap: Record<string, string> = {
    gpt: 'openai',
    gemini: 'gemini',
    deepseek: 'deepinfra',
    mistral: 'deepinfra',
    llama: 'deepinfra',
  };

  /**
   * Initialize the provider with optional provider instances
   */
  constructor({
    gemini,
    openai,
    deepseek,
    ...otherProviders
  }: {
    gemini?: GoogleGenerativeAIProvider;
    openai?: OpenAISDKProvider;
    deepseek?: DeepInfraProvider;
    [key: string]: any;
  } = {}) {
    if (gemini) this.providers.set('gemini', gemini);
    if (openai) this.providers.set('openai', openai);
    if (deepseek) this.providers.set('deepseek', deepseek);

    // Handle any additional providers
    Object.entries(otherProviders).forEach(([key, provider]) => {
      if (provider) this.providers.set(key, provider);
    });

    // Initialize providers from environment variables if they don't exist
    this.initializeProvidersFromEnv();
  }

  /**
   * Initialize providers from environment variables
   */
  private initializeProvidersFromEnv(): void {
    // Initialize OpenAI provider if not already set
    if (!this.providers.has('openai') && process.env.OPENAI_API_KEY) {
      try {
        const openai = createOpenAI({
          apiKey: process.env.OPENAI_API_KEY,
        });
        this.providers.set('openai', openai);
        console.log('OpenAI provider initialized from environment variable');
      } catch (error) {
        console.warn('Failed to initialize OpenAI provider:', error);
      }
    }

    // Initialize Gemini provider if not already set
    if (!this.providers.has('gemini') && process.env.GEMINI_API_KEY) {
      try {
        const gemini = createGoogleGenerativeAI({
          apiKey: process.env.GEMINI_API_KEY,
        });
        this.providers.set('gemini', gemini);
        console.log('Gemini provider initialized from environment variable');
      } catch (error) {
        console.warn('Failed to initialize Gemini provider:', error);
      }
    }

    // Initialize DeepInfra provider if not already set
    if (!this.providers.has('deepinfra') && process.env.DEEPINFRA_API_KEY) {
      try {
        const deepinfra = createDeepInfra({
          apiKey: process.env.DEEPINFRA_API_KEY,
        });
        this.providers.set('deepinfra', deepinfra);
        console.log('DeepInfra provider initialized from environment variable');
      } catch (error) {
        console.warn('Failed to initialize DeepInfra provider:', error);
      }
    }
  }

  /**
   * Add or replace a provider
   */
  addProvider(name: string, provider: ProviderV1): void {
    this.providers.set(name, provider);
  }

  /**
   * Add a direct model with a specific identifier
   * This is for cases where the user provides a model instance directly
   */
  addDirectProvider(id: string, model: LanguageModelV1): void {
    this.directModels.set(id, model);
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: string): ProviderV1 | undefined {
    return this.providers.get(name);
  }

  /**
   * Map a model name to its provider
   */
  private getProviderNameForModel(modelName: string): string {
    // First check if the model name starts with a known provider prefix
    const [prefix] = modelName.split('-');

    // Check if we have a direct mapping for this prefix
    if (this.modelToProviderMap[prefix]) {
      return this.modelToProviderMap[prefix];
    }

    // Try to infer the provider from the model name
    if (modelName.startsWith('gpt')) return 'openai';
    if (modelName.startsWith('gemini')) return 'gemini';
    if (
      modelName.startsWith('deepseek') ||
      modelName.startsWith('mistral') ||
      modelName.startsWith('llama')
    )
      return 'deepinfra';

    // Default to OpenAI if we can't determine the provider
    return 'openai';
  }

  /**
   * Generate text using the specified model or provider
   * The model can be:
   * 1. A direct LanguageModelV1 instance
   * 2. A string ID for a stored direct model
   * 3. A string in provider-model format (e.g., 'gemini-2.0-flash')
   */
  async generateText(
    prompt: string,
    modelOrProvider: string | LanguageModelV1
  ): Promise<string> {
    try {
      // Case 1: Direct LanguageModelV1 instance
      if (typeof modelOrProvider !== 'string') {
        // If it's a direct model instance, use it directly
        const result = await generateText({
          model: modelOrProvider,
          prompt,
        });
        return result.text;
      }

      // Case 2: Check if it's a direct model ID we've stored
      if (this.directModels.has(modelOrProvider)) {
        const model = this.directModels.get(modelOrProvider);
        if (!model) {
          throw new Error(`Direct model '${modelOrProvider}' not found`);
        }
        const result = await generateText({
          model, // This is already a LanguageModelV1
          prompt,
        });
        return result.text;
      }

      // Case 3: String model name - determine the provider
      const providerName = this.getProviderNameForModel(modelOrProvider);
      const provider = this.providers.get(providerName);

      if (!provider) {
        throw new Error(
          `Provider '${providerName}' not found for model '${modelOrProvider}'. Please add it using addProvider method or set the appropriate API key in environment variables.`
        );
      }

      // Use the languageModel method to get the LanguageModelV1 instance
      const model = provider.languageModel(modelOrProvider);

      const result = await generateText({
        model, // Now this is a LanguageModelV1
        prompt,
      });

      return result.text;
    } catch (error) {
      throw new Error(
        `Error generating text with ${String(modelOrProvider)}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

export default AIProvider;
