import { generateText } from 'ai';
import { GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { DeepInfraProvider } from '@ai-sdk/deepinfra';
import { OpenAIProvider as OpenAISDKProvider } from '@ai-sdk/openai';
import { ProviderV1, LanguageModelV1 } from '@ai-sdk/provider';
/**
 * AIProvider acts as an abstract factory for different AI model providers
 * It unifies the interface for interacting with different provider types
 */
export class AIProvider {
  private providers: Map<string, ProviderV1> = new Map();
  private directModels: Map<string, LanguageModelV1> = new Map();

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

      // Case 3: String in provider-model format
      // Parse the model string to identify the provider
      const [providerName] = modelOrProvider.split('-');
      const provider = this.providers.get(providerName);
      if (!provider) {
        throw new Error(
          `Provider '${providerName}' not found. Please add it using addProvider method.`
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
