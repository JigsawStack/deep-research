import { generateText } from 'ai';
import { GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { DeepInfraProvider } from '@ai-sdk/deepinfra';
import { OpenAIProvider as OpenAISDKProvider } from '@ai-sdk/openai';

/**
 * AIProvider acts as an abstract factory for different AI model providers
 * It unifies the interface for interacting with different provider types
 */
export class AIProvider {
  private providers: Map<string, any> = new Map();
  private directProviders: Map<string, any> = new Map();

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
   * Add a named provider that will be used with string-based model names
   */
  addProvider(name: string, provider: any): void {
    this.providers.set(name, provider);
  }

  /**
   * Add a direct provider instance that will be referenced by a key
   */
  addDirectProvider(key: string, provider: any): void {
    this.directProviders.set(key, provider);
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: string): any {
    return this.providers.get(name);
  }

  /**
   * Get a direct provider by key
   */
  getDirectProvider(key: string): any {
    return this.directProviders.get(key);
  }

  /**
   * Generate text using the specified model or provider
   * The model can be:
   * 1. A string model name with provider prefix, e.g., 'gemini-2.0-flash'
   * 2. A key referencing a direct provider instance
   */
  async generateText(
    prompt: string,
    modelOrProvider: string | any
  ): Promise<string> {
    // Case 1: Direct provider instance was passed
    if (typeof modelOrProvider !== 'string') {
      try {
        const result = await generateText({
          model: modelOrProvider,
          prompt,
        });
        return result.text;
      } catch (error) {
        throw new Error(
          `Error generating text with direct provider: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Case 2: Check if it's a key for a direct provider we have stored
    if (this.directProviders.has(modelOrProvider)) {
      const provider = this.directProviders.get(modelOrProvider);
      try {
        const result = await generateText({
          model: provider,
          prompt,
        });
        return result.text;
      } catch (error) {
        throw new Error(
          `Error generating text with provider key ${modelOrProvider}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Case 3: String model name with provider prefix
    const [providerName, ...modelParts] = modelOrProvider.split('-');
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(
        `Provider '${providerName}' not found for model ${modelOrProvider}. Please add it using addProvider method.`
      );
    }

    try {
      const result = await generateText({
        model: provider(modelOrProvider),
        prompt,
      });
      return result.text;
    } catch (error) {
      throw new Error(
        `Error generating text with model ${modelOrProvider}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

export default AIProvider;
