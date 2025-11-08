import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { LanguageModelV1, ProviderV1 } from "@ai-sdk/provider";

/**
 * AIProvider acts as an abstract factory for different AI model providers
 * It unifies the interface for interacting with different provider types
 */

export type ModelType = "default" | "reasoning" | "output";

export class AIProvider {
  private static instance: AIProvider;
  private providers: Map<string, ProviderV1> = new Map();
  private models: {
    default: LanguageModelV1;
    reasoning: LanguageModelV1;
    output: LanguageModelV1;
  };

  /**
   * Initialize the provider with API keys from config and optional custom models
   */
  private constructor({
    OPENAI_API_KEY,
    DEEPINFRA_API_KEY,
    defaultModel,
    reasoningModel,
    outputModel,
  }: {
    OPENAI_API_KEY?: string;
    DEEPINFRA_API_KEY?: string;
    defaultModel?: LanguageModelV1;
    reasoningModel?: LanguageModelV1;
    outputModel?: LanguageModelV1;
  }) {
    // Set default models
    this.models = {
      default: defaultModel || createOpenAI({ apiKey: OPENAI_API_KEY! }).languageModel("gpt-5-mini"),
      reasoning: reasoningModel || createDeepInfra({ apiKey: DEEPINFRA_API_KEY! }).languageModel("zai-org/GLM-4.6"),
      output: outputModel || createOpenAI({ apiKey: OPENAI_API_KEY! }).languageModel("gpt-5-mini"),
    };
  }

  /**
   * Get singleton instance of AIProvider
   */
  public static getInstance({
    OPENAI_API_KEY,
    DEEPINFRA_API_KEY,
    defaultModel,
    reasoningModel,
    outputModel,
  }: {
    OPENAI_API_KEY?: string;
    DEEPINFRA_API_KEY?: string;
    defaultModel?: LanguageModelV1;
    reasoningModel?: LanguageModelV1;
    outputModel?: LanguageModelV1;
  }): AIProvider {
    if (!AIProvider.instance) {
      AIProvider.instance = new AIProvider({
        OPENAI_API_KEY,
        DEEPINFRA_API_KEY,
        defaultModel,
        reasoningModel,
        outputModel,
      });
    }
    return AIProvider.instance;
  }

  getModel(key: ModelType) {
    return this.models[key];
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: string): ProviderV1 | undefined {
    return this.providers.get(name);
  }
}

export default AIProvider;
