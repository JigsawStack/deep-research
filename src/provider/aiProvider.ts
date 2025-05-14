import { generateText } from 'ai';
import { GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { DeepInfraProvider } from '@ai-sdk/deepinfra';
import { OpenAIProvider as OpenAISDKProvider } from '@ai-sdk/openai';
import { ProviderV1 } from '@ai-sdk/provider';
/**
 * AIProvider acts as an abstract factory for different AI model providers
 * It unifies the interface for interacting with different provider types
 */
export class AIProvider {
  private providers: Map<string, ProviderV1> = new Map();
  private directProviders: Map<string, ProviderV1> = new Map();

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
  addProvider(name: string, provider: any): void {
    this.providers.set(name, provider);
  }

  /**
   * Add a direct provider with a specific identifier
   * This is for cases where the user provides a provider instance directly
   */
  addDirectProvider(id: string, provider: any): void {
    this.directProviders.set(id, provider);
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: string): any {
    return this.providers.get(name);
  }

  /**
   * Generate text using the specified model or provider
   * The model can be:
   * 1. A string like 'gemini-2.0-flash' (provider-model format)
   * 2. A direct reference to a provider instance (stored with a unique ID)
   */
  async generateText(
    prompt: string,
    modelOrProvider: string | any
  ): Promise<string> {
    try {
      // Case 1: Direct provider instance reference
      if (typeof modelOrProvider !== 'string') {
        // If it's a direct provider instance, use it directly
        const result = await generateText({
          model: modelOrProvider,
          prompt,
        });
        return result.text;
      }

      // Case 2: Check if it's a direct provider ID we've stored
      if (this.directProviders.has(modelOrProvider)) {
        const provider = this.directProviders.get(modelOrProvider);
        const result = await generateText({
          model: provider,
          prompt,
        });
        return result.text;
      }

      // Case 3: String in provider-model format
      // Parse the model string to identify the provider
      const [providerName, ...modelParts] = modelOrProvider.split('-');
      const provider = this.providers.get(providerName);

      if (!provider) {
        throw new Error(
          `Provider '${providerName}' not found. Please add it using addProvider method.`
        );
      }

      const result = await generateText({
        model: provider(modelOrProvider),
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
